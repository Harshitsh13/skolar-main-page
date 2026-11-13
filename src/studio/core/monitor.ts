import { z } from "zod";
import { COL, getStore } from "./store";
import type { CategoryKey, SourceChange, StudioSource } from "./types";
import { fetchPage, FetchBlockedError, NetworkError } from "./fetcher";
import { chatJson } from "./ai";
import { addTopic } from "./topics";
import { listArticles } from "./articles";
import { logActivity, notify } from "./ops";
import { getSettings } from "./settings";
import { newId, nowIso, sha256, similarity, truncate } from "./util";

type SourceRow = StudioSource & Record<string, unknown>;

/**
 * Official-source monitoring. Each check fetches the page (politely), hashes
 * its readable text, and compares the list of links with the previous
 * snapshot to spot new notices. Changes are assessed (AI if available) and,
 * if meaningful, turned into a topic suggestion — never directly into an article.
 */

export function sourcesDue(sources: StudioSource[], now = Date.now()): StudioSource[] {
  return sources.filter((s) => s.monitor && (!s.nextCheckAt || Date.parse(s.nextCheckAt) <= now));
}

const assessSchema = {
  type: "object",
  additionalProperties: false,
  required: ["meaningful", "summary", "academic_year", "action", "topic_title", "category"],
  properties: {
    meaningful: { type: "boolean" },
    summary: { type: "string" },
    academic_year: { type: ["string", "null"] },
    action: { type: "string", enum: ["new_article", "update_article", "ignore"] },
    topic_title: { type: "string" },
    category: { type: "string", enum: ["scholarship", "admissions", "programmes", "university_guide", "visa", "student_life", "other"] },
  },
};
const assessZ = z.object({
  meaningful: z.boolean(),
  summary: z.string(),
  academic_year: z.string().nullable(),
  action: z.enum(["new_article", "update_article", "ignore"]),
  topic_title: z.string(),
  category: z.enum(["scholarship", "admissions", "programmes", "university_guide", "visa", "student_life", "other"]),
});

const NOTICE_HINT = /(bando|bandi|avviso|avvisi|graduatori|scadenz|borsa|borse|benefici|call|notice|deadline|admission|ammission|application|iscrizion|immatricolazion|scholarship|tuition|tasse|20\d{2}\s?[/-]\s?(20)?\d{2})/i;

export async function checkSource(id: string): Promise<{ status: StudioSource["lastStatus"]; message: string; change?: SourceChange }> {
  const store = getStore();
  const src = await store.get<SourceRow>(COL.sources, id);
  if (!src) throw new Error("Source not found.");
  const now = nowIso();
  const freq = Math.max(1, src.frequencyHours || (await getSettings()).monitoring.defaultFrequencyHours);

  let page;
  try {
    page = await fetchPage(src.url);
  } catch (err) {
    const blocked = err instanceof FetchBlockedError;
    const failures = (src.consecutiveFailures ?? 0) + 1;
    // Back off: 1h, 2h, 4h … capped at the normal frequency (blocked sources wait the full period).
    const retryH = blocked ? freq : Math.min(freq, 2 ** (failures - 1));
    const message = err instanceof Error ? err.message : String(err);
    await store.set(
      COL.sources,
      id,
      {
        lastCheckedAt: now,
        lastStatus: blocked ? "blocked" : "error",
        lastError: truncate(message, 300),
        consecutiveFailures: failures,
        nextCheckAt: new Date(Date.now() + retryH * 3600_000).toISOString(),
        updatedAt: now,
      },
      { merge: true },
    );
    if (failures === 3) {
      await notify({ kind: "info", level: "warning", title: `Source unreachable: ${src.name}`, body: message, href: "/admin/research" }, { dedupeKey: `src-fail-${id}` });
    }
    if (err instanceof NetworkError) throw err;
    return { status: blocked ? "blocked" : "error", message };
  }

  const text = page.isPdf ? page.finalUrl : page.text;
  const hash = sha256(text.replace(/\s+/g, " ").replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "")); // ignore clocks
  const prevSnap = await store.get<{ links: Array<{ text: string; url: string }>; hash: string } & Record<string, unknown>>(COL.pages, `mon-${id}`);
  await store.set(COL.pages, `mon-${id}`, { url: src.url, hash, links: page.links.slice(0, 300), title: page.title, text: page.text.slice(0, 40_000), fetchedAt: now });

  const first = !src.contentHash;
  const changed = !first && src.contentHash !== hash;
  const prevUrls = new Set((prevSnap?.links ?? []).map((l) => l.url));
  const newLinks = first ? [] : page.links.filter((l) => !prevUrls.has(l.url) && NOTICE_HINT.test(`${l.text} ${l.url}`)).slice(0, 15);

  const base = {
    lastCheckedAt: now,
    lastSuccessAt: now,
    lastStatus: (changed ? "changed" : "ok") as StudioSource["lastStatus"],
    lastError: "",
    consecutiveFailures: 0,
    contentHash: hash,
    linkCount: page.links.length,
    nextCheckAt: new Date(Date.now() + freq * 3600_000).toISOString(),
    updatedAt: now,
    ...(changed ? { lastChangeAt: now } : {}),
  };
  await store.set(COL.sources, id, base, { merge: true });

  if (first) return { status: "ok", message: "Baseline snapshot saved. Future checks will detect changes." };
  if (!changed) return { status: "ok", message: "No change since the last check." };
  if (!newLinks.length) {
    return { status: "changed", message: "Page text changed, but no new notice links were found (likely a minor update)." };
  }

  // Assess significance
  const change: SourceChange = {
    id: newId("chg"),
    sourceId: id,
    sourceName: src.name,
    url: src.url,
    detectedAt: now,
    newLinks,
    summary: `New links: ${newLinks.map((l) => l.text || l.url).join(" · ")}`.slice(0, 600),
    meaningful: null,
    action: "pending",
  };
  try {
    const a = await chatJson(
      {
        system:
          "You assess changes on official education websites (universities, scholarship bodies, government) for SKOLAR's editorial team. Decide if the new items are meaningful for international students (e.g. a new scholarship call, new deadlines, new admission notice). Ignore events, news about research, staff, tenders. Never invent details beyond the link texts. Return JSON only.",
        user: `Source: ${src.name} (${src.url})\nNew links:\n${newLinks.map((l) => `- ${l.text} — ${l.url}`).join("\n")}\n\nIf meaningful, propose a precise article topic title.`,
        json: { name: "change", schema: assessSchema },
        maxTokens: 1200,
        reasoning: "low",
      },
      (v) => assessZ.parse(v),
      { stage: "monitor" },
    );
    change.meaningful = a.meaningful;
    change.summary = truncate(a.summary, 500);
    change.academicYear = a.academic_year;
    change.action = a.meaningful ? a.action : "ignore";
    if (a.meaningful && a.action !== "ignore") {
      const articles = await listArticles();
      const related = articles.map((x) => ({ x, s: similarity(a.topic_title, x.title) })).sort((p, q) => q.s - p.s)[0];
      if (related && related.s >= 0.5) {
        change.action = "update_article";
        change.relatedArticleId = related.x.id;
      }
      if (change.action === "new_article") {
        const t = await addTopic({
          title: a.topic_title,
          category: a.category as CategoryKey,
          countryId: src.countryId,
          entityIds: [src.universityId, src.scholarshipId].filter((x): x is string => Boolean(x)),
          rationale: `Detected on ${src.name}: ${truncate(a.summary, 200)}`,
          origin: "source_change",
          sourceUrl: newLinks[0]?.url ?? src.url,
          score: 80,
          signals: [{ kind: "official_update", source: src.name, detail: truncate(a.summary, 300), url: newLinks[0]?.url ?? src.url, collectedAt: now }],
        });
        change.topicId = t.topic?.id;
      }
    }
  } catch (err) {
    change.summary += ` (Not assessed automatically: ${err instanceof Error ? err.message : err})`;
  }
  await store.set(COL.sourceChanges, change.id, change as unknown as Record<string, unknown>);
  if (change.meaningful !== false) {
    await notify({
      kind: "source_change",
      level: "info",
      title: `Official source changed: ${src.name}`,
      body: change.action === "update_article" ? "An existing article may need updating." : change.summary,
      href: change.relatedArticleId ? `/admin/articles/${change.relatedArticleId}` : "/admin/research",
    });
  }
  await logActivity("worker", "source.changed", `${src.name}: ${change.summary}`, id);
  return { status: "changed", message: change.summary, change };
}

export async function listChanges(limit = 30): Promise<SourceChange[]> {
  return getStore().list<SourceChange & Record<string, unknown>>(COL.sourceChanges, { orderBy: { field: "detectedAt", direction: "desc" }, limit });
}
