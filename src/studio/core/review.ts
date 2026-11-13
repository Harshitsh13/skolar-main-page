import { approvalBlockers, getArticle, NotFoundError, ConflictError, openEditorialWarnings, runChecks, updateArticle } from "./articles";
import { applyImprovement, proposeImprovement, type ImproveIssue } from "./improve";
import { getSettings } from "./settings";
import { addToDay, logActivity } from "./ops";
import type { EditorialWarning, StudioArticle } from "./types";
import type { CallContext } from "./ai";
import { nowIso } from "./util";

/**
 * Editorial decisions: approval and AI improvements.
 *
 *   Save draft → (optional) checks → (optional) AI suggestions → approve → publish/schedule
 *
 * - Technical problems block approval for every article.
 * - AI-generated drafts keep the research/verification gate: blocking editorial
 *   warnings and the quality gate must be resolved before approval.
 * - Manually written articles: editorial warnings never block. The editor
 *   approves after acknowledging them; the warnings stay on the record and no
 *   claim status changes.
 */

export class ApprovalBlockedError extends Error {
  constructor(
    message: string,
    readonly blockers: string[],
  ) {
    super(message);
  }
}

export class WarningsNeedAcknowledgementError extends Error {
  constructor(readonly warnings: EditorialWarning[]) {
    super(`${warnings.length} editorial warning(s) are open. Review them, then confirm to approve anyway.`);
  }
}

export async function approveArticle(id: string, opts: { acknowledgeWarnings?: boolean; expectedVersion?: number } = {}): Promise<StudioArticle> {
  const a = await getArticle(id);
  if (!a) throw new NotFoundError("Article not found.");
  if (!["draft", "needs_review", "rejected"].includes(a.status)) throw new ApprovalBlockedError(`Cannot approve an article that is ${a.status}.`, []);
  if (opts.expectedVersion !== undefined && a.version !== opts.expectedVersion) {
    throw new ConflictError("This article was changed elsewhere (another tab or the worker). Reload to see the latest version.");
  }
  const checks = runChecks(a, await getSettings());
  const checked = { ...a, ...checks } as StudioArticle;
  // Approval depends only on the article — never on whether a publishing destination is configured.
  const blockers = approvalBlockers(checked);
  if (blockers.length) {
    throw new ApprovalBlockedError(`${a.origin === "ai" ? "This AI-generated draft cannot be approved yet" : "Fix these technical problems before approving"}: ${blockers.join(" ")}`, blockers);
  }
  const open = openEditorialWarnings(checked);
  if (a.origin === "manual" && open.length && !opts.acknowledgeWarnings) throw new WarningsNeedAcknowledgementError(open);
  const now = nowIso();
  const ack = a.origin === "manual" && open.length ? { at: now, count: open.length, codes: [...new Set(open.map((w) => w.code))] } : undefined;
  // Warnings and claim statuses are stored exactly as checked — approving never marks anything verified.
  const saved = await updateArticle(
    a.id,
    { status: "approved", claims: checks.claims, warnings: checks.warnings, qualityGate: checks.qualityGate, review: { ...a.review, approvedAt: now, approvedWithWarnings: ack } },
    { expectedVersion: opts.expectedVersion },
  );
  await addToDay("approvedIds", a.id);
  await logActivity("admin", "article.approved", `Approved: ${a.title}${ack ? ` (with ${ack.count} open editorial warning(s) reviewed by the editor: ${ack.codes.join(", ")})` : ""}`, a.id);
  return saved;
}

/* ───────────── AI improvements (never applied without the editor) ───────────── */

/** Default issue list for "Improve with AI": open editorial warnings + uncited, unlabelled statements. */
export function defaultIssues(a: StudioArticle): ImproveIssue[] {
  const warn = openEditorialWarnings(a).map((w) => ({ code: w.code, message: w.message, excerpt: w.excerpt }));
  const claims = a.claims.filter((c) => c.status === "unverified" && !c.labelled).map((c) => ({ code: "uncited_statement", message: "Factual statement without a citation.", excerpt: c.text }));
  return [...warn, ...claims].slice(0, 40);
}

/** Editing an approved/scheduled article sends it back for approval. */
export function editAfterApproval(a: StudioArticle): Partial<StudioArticle> {
  if (!["approved", "scheduled"].includes(a.status)) return {};
  return {
    status: "draft",
    ...(a.status === "scheduled" && a.schedule
      ? { schedule: { ...a.schedule, at: "", history: [...a.schedule.history, { at: nowIso(), from: a.schedule.at, to: null, reason: "Edited after approval — needs re-approval" }] } }
      : {}),
  };
}

export async function requestImprovement(id: string, opts: { issues?: ImproveIssue[]; instruction?: string; expectedVersion: number }, ctx: CallContext = {}): Promise<StudioArticle> {
  const a = await getArticle(id);
  if (!a) throw new NotFoundError("Article not found.");
  if (["researching", "publishing"].includes(a.status)) throw new ApprovalBlockedError(`The article is ${a.status}; try again when it finishes.`, []);
  if (a.version !== opts.expectedVersion) throw new ConflictError("Save or reload the article first — the AI must work from the saved version.");
  const issues = opts.issues?.length ? opts.issues : defaultIssues(a);
  const proposal = await proposeImprovement(a, { issues, instruction: opts.instruction }, ctx);
  // Stored beside the article; the article text itself is untouched.
  const saved = await updateArticle(a.id, { improvement: { ...proposal, baseVersion: a.version + 1 } }, { expectedVersion: a.version });
  await logActivity("admin", "article.improve_proposed", `AI suggested changes to ${proposal.sections.filter((s) => s.changed).length} section(s) of “${a.title}” (not applied)`, a.id);
  return saved;
}

export async function applyStoredImprovement(id: string, opts: { proposalId: string; sections?: number[]; expectedVersion: number }): Promise<StudioArticle> {
  const a = await getArticle(id);
  if (!a) throw new NotFoundError("Article not found.");
  if (a.version !== opts.expectedVersion) throw new ConflictError("This article was changed elsewhere. Reload before applying.");
  const r = applyImprovement(a, opts.proposalId, opts.sections);
  const checks = runChecks({ ...a, body: r.body }, await getSettings());
  const revisions = [...(a.revisions ?? []), { at: nowIso(), version: a.version, reason: `Before applying AI suggestion (${r.applied.length} section(s))`, body: a.body }].slice(-5);
  const saved = await updateArticle(
    a.id,
    { body: r.body, claims: checks.claims, warnings: checks.warnings, qualityGate: checks.qualityGate, improvement: undefined, revisions, ...editAfterApproval(a) },
    { expectedVersion: opts.expectedVersion },
  );
  await logActivity("admin", "article.improve_applied", `Applied AI suggestion to ${r.applied.length} section(s) of “${a.title}” (previous text kept in revisions)`, a.id);
  return saved;
}

export async function discardImprovement(id: string): Promise<StudioArticle> {
  const a = await getArticle(id);
  if (!a) throw new NotFoundError("Article not found.");
  return updateArticle(a.id, { improvement: undefined });
}

export async function restoreRevision(id: string, opts: { index: number; expectedVersion: number }): Promise<StudioArticle> {
  const a = await getArticle(id);
  if (!a) throw new NotFoundError("Article not found.");
  const rev = a.revisions?.[opts.index];
  if (!rev) throw new NotFoundError("That earlier version no longer exists.");
  const checks = runChecks({ ...a, body: rev.body }, await getSettings());
  const revisions = [...(a.revisions ?? []).filter((_, i) => i !== opts.index), { at: nowIso(), version: a.version, reason: "Before restoring an earlier version", body: a.body }].slice(-5);
  const saved = await updateArticle(a.id, { body: rev.body, claims: checks.claims, warnings: checks.warnings, qualityGate: checks.qualityGate, revisions, ...editAfterApproval(a) }, { expectedVersion: opts.expectedVersion });
  await logActivity("admin", "article.revision_restored", `Restored the text from ${rev.at} in “${a.title}”`, a.id);
  return saved;
}
