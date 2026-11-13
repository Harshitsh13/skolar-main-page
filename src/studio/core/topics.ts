import { z } from "zod";
import { COL, getStore } from "./store";
import type { CategoryKey, StudioTopic } from "./types";
import { chatJson, NoProviderAvailableError } from "./ai";
import { findDuplicates } from "./articles";
import { listRegions, listScholarships, listUniversities, getCountry } from "./entities";
import { collectDemand, phraseAsTopic, SIGNAL_LABEL, type DemandSignal, type SignalKind } from "./demand";
import { academicYearFor, nextIntakeAcademicYear } from "./time";
import { CATEGORY_KEYS, STRATEGIES } from "./strategies";
import { logActivity } from "./ops";
import { newId, nowIso, similarity, truncate } from "./util";

type TopicRow = StudioTopic & Record<string, unknown>;

export async function listTopics(): Promise<StudioTopic[]> {
  const rows = await getStore().list<TopicRow>(COL.topics);
  return rows.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
}

export interface TopicInput {
  title: string;
  category: CategoryKey;
  countryId: string;
  entityIds?: string[];
  rationale?: string;
  intent?: string;
  score?: number;
  origin: StudioTopic["origin"];
  sourceUrl?: string;
  status?: StudioTopic["status"];
  signals?: DemandSignal[];
  relevance?: StudioTopic["relevance"];
}

/** Adds a topic unless it duplicates an existing article or topic. */
export async function addTopic(input: TopicInput, opts?: { allowDuplicate?: boolean }): Promise<{ topic: StudioTopic | null; duplicate?: StudioTopic["duplicateOf"] }> {
  const dups = await findDuplicates(input.title, { threshold: 0.55 });
  const top = dups[0];
  const duplicateOf = top ? { kind: top.kind, id: top.id, title: top.title, similarity: Math.round(top.similarity * 100) / 100 } : undefined;
  if (top && !opts?.allowDuplicate) return { topic: null, duplicate: duplicateOf };
  const now = nowIso();
  const topic: StudioTopic = {
    id: newId("top"),
    title: truncate(input.title.trim(), 160),
    category: input.category,
    countryId: input.countryId,
    entityIds: input.entityIds ?? [],
    rationale: truncate(input.rationale ?? "", 400),
    intent: input.intent,
    score: input.score ?? 50,
    origin: input.origin,
    sourceUrl: input.sourceUrl,
    status: input.status ?? "suggested",
    duplicateOf,
    signals: input.signals?.length ? input.signals : [{ kind: input.origin === "manual" ? "manual" : input.origin === "source_change" ? "official_update" : "editorial", source: input.origin === "manual" ? "SKOLAR Studio admin" : input.origin === "source_change" ? "Official source monitoring" : "SKOLAR registry", detail: input.rationale ?? "", url: input.sourceUrl, collectedAt: now }],
    relevance: input.relevance,
    createdAt: now,
    updatedAt: now,
  };
  await getStore().set(COL.topics, topic.id, topic as unknown as Record<string, unknown>);
  return { topic, duplicate: duplicateOf };
}

export async function updateTopic(id: string, patch: Partial<StudioTopic>) {
  return getStore().transact<TopicRow>(COL.topics, id, (t) => (t ? ({ ...t, ...patch, id, updatedAt: nowIso() } as TopicRow) : undefined));
}

/* ───────────── Discovery ───────────── */

interface Candidate {
  title: string;
  category: CategoryKey;
  entityIds: string[];
  rationale: string;
  origin: StudioTopic["origin"];
  score: number;
  signals: DemandSignal[];
}

const editorial = (detail: string): DemandSignal[] => [{ kind: "editorial", source: "SKOLAR registry & editorial list", detail, collectedAt: nowIso() }];

/** Evergreen questions Indian students ask (used as topic seeds, not as facts). */
const EVERGREEN: Array<[CategoryKey, string]> = [
  ["trending", "Can Indian students study in Italy without IELTS?"],
  ["trending", "Is Italy affordable for Indian students?"],
  ["admissions", "What happens after you get admission to an Italian university?"],
  ["admissions", "How to choose an Italian university as an Indian student"],
  ["admissions", "Universitaly pre-enrolment explained step by step"],
  ["visa", "Italy student visa documents checklist for Indian students"],
  ["programmes", "English-taught Bachelor's programmes in Italy: how to find them"],
  ["student_life", "Opening a bank account in Italy as an international student"],
  ["student_life", "Getting an Italian SIM card as a new student"],
  ["student_life", "Finding student accommodation in Italy"],
  ["practical", "Applying for the Italian residence permit for study"],
  ["comparison", "Public vs private universities in Italy for international students"],
  ["scholarship", "How regional scholarships work in Italy"],
  ["scholarship", "Documents usually needed for Italian regional scholarship applications"],
];

export async function templateCandidates(countryId: string): Promise<Candidate[]> {
  const country = await getCountry(countryId);
  const ay = nextIntakeAcademicYear(new Date(), country.academicYearStartMonth);
  const cur = academicYearFor(new Date(), country.academicYearStartMonth);
  const unis = (await listUniversities()).filter((u) => u.countryId === countryId && u.researchEnabled);
  const schs = (await listScholarships()).filter((s) => s.countryId === countryId);
  const regions = (await listRegions()).filter((r) => r.countryId === countryId);
  const out: Candidate[] = [];
  for (const u of unis) {
    out.push({ title: `${u.name}: complete guide for international students (${ay})`, category: "university_guide", entityIds: [u.id], rationale: "University in the registry without a guide yet.", origin: "template", score: 70, signals: editorial(`${u.name} is in the registry without a guide`) });
    out.push({ title: `English-taught programmes at the ${u.name.replace(/^University of /, "University of ")} (${ay})`, category: "programmes", entityIds: [u.id], rationale: "Programme guide for a registry university.", origin: "template", score: 62, signals: editorial(`Programme guide for ${u.name}`) });
  }
  for (let i = 0; i < unis.length; i++) {
    for (let j = i + 1; j < unis.length; j++) {
      out.push({ title: `${unis[i].name} vs ${unis[j].name}: which suits you?`, category: "comparison", entityIds: [unis[i].id, unis[j].id], rationale: "Comparison between registry universities.", origin: "template", score: 66, signals: editorial(`Both universities are in the registry`) });
    }
  }
  for (const s of schs) {
    out.push({ title: `${s.name}: complete guide (${s.academicYear ?? cur})`, category: "scholarship", entityIds: [s.id], rationale: "Scholarship body in the registry.", origin: "template", score: 72, signals: editorial(`${s.organisation} is in the registry`) });
  }
  for (const r of regions) {
    for (const c of r.cities.slice(0, 3)) {
      out.push({ title: `Monthly cost of living for students in ${c}`, category: "cost_of_living", entityIds: [], rationale: `City in ${r.name}.`, origin: "template", score: 55, signals: editorial(`${c} (${r.name}) is a registry city`) });
      out.push({ title: `${c} for international students: a city guide`, category: "city_guide", entityIds: [], rationale: `City in ${r.name}.`, origin: "template", score: 48, signals: editorial(`${c} (${r.name}) is a registry city`) });
    }
  }
  for (const [category, title] of EVERGREEN) out.push({ title, category, entityIds: [], rationale: "Common question from prospective students.", origin: "template", score: 50, signals: editorial("Common question in SKOLAR counselling (editorial list, not search data)") });
  return out;
}

async function searchCandidates(): Promise<{ items: Candidate[]; notes: string[] }> {
  const { candidates, notes } = await collectDemand();
  const items: Candidate[] = candidates
    .filter((c) => c.signal.kind !== "search_result" || /\b(italy|italian|universit|scholarship|visa)\b/i.test(c.title))
    .map((c) => ({
      title: phraseAsTopic(c.signal.kind === "search_result" ? c.title.replace(/\s[|–-]\s.*$/, "") : c.title),
      category: "trending" as CategoryKey,
      entityIds: [],
      rationale: `${SIGNAL_LABEL[c.signal.kind as SignalKind]} (${c.signal.source})`,
      origin: "search" as const,
      score: c.signal.kind === "related_query" ? 68 : 60,
      signals: [c.signal],
    }));
  return { items, notes };
}

const rankSchema = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "title", "score", "rationale"],
        properties: { index: { type: "integer" }, title: { type: "string" }, score: { type: "integer" }, rationale: { type: "string" } },
      },
    },
  },
};
const rankZ = z.object({ picks: z.array(z.object({ index: z.number().int(), title: z.string(), score: z.number().int(), rationale: z.string() })) });

/**
 * Builds topic suggestions from the registry, evergreen student questions and
 * (if configured) search-demand data, removes duplicates, optionally lets the
 * AI rank them, and saves the best as "suggested" topics.
 */
export async function discoverTopics(opts: { countryId?: string; max?: number; useAi?: boolean } = {}) {
  const countryId = opts.countryId ?? "it";
  const max = opts.max ?? 10;
  const notes: string[] = [];
  const pool = await templateCandidates(countryId);
  const search = await searchCandidates();
  notes.push(...search.notes);
  pool.push(...search.items);

  // Remove duplicates against existing content and within the pool (merging their signals).
  const fresh: Candidate[] = [];
  for (const c of pool) {
    const same = fresh.find((f) => similarity(f.title, c.title) >= 0.6);
    if (same) {
      same.signals.push(...c.signals);
      continue;
    }
    const dups = await findDuplicates(c.title, { threshold: 0.55 });
    if (dups.length) continue;
    fresh.push(c);
  }
  if (!fresh.length) return { added: [] as StudioTopic[], notes: [...notes, "No new topics: everything in the registry is already covered or queued."] };

  // Balance categories so the queue does not fill with one type.
  const byCat = new Map<CategoryKey, Candidate[]>();
  for (const c of fresh.sort((a, b) => b.score - a.score)) byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]);
  const balanced: Candidate[] = [];
  while (balanced.length < Math.min(fresh.length, 30)) {
    let added = false;
    for (const k of CATEGORY_KEYS) {
      const next = byCat.get(k)?.shift();
      if (next) {
        balanced.push(next);
        added = true;
      }
    }
    if (!added) break;
  }

  let chosen = balanced.slice(0, max);
  if (opts.useAi !== false) {
    try {
      const out = await chatJson(
        {
          system:
            "You are the SKOLAR editor choosing which study-in-Italy articles to research next for Indian students. Prefer topics where official sources can give a trustworthy, useful answer. Do not invent new facts. You may lightly rephrase titles to be specific and natural (keep entity names exactly). Return JSON only.",
          user: `Candidates (with where each idea came from):\n${balanced.map((c, i) => `${i}. [${STRATEGIES[c.category].short}] ${c.title} — signals: ${c.signals.map((x) => SIGNAL_LABEL[x.kind as SignalKind]).join(", ")}`).join("\n")}\n\nPick the best ${max}. score = relevance 0-100 for an Indian student planning to study in Italy; rationale = one sentence explaining why it matters to that student.`,
          json: { name: "topic_picks", schema: rankSchema },
          maxTokens: 2500,
          reasoning: "low",
        },
        (v) => rankZ.parse(v),
        { stage: "discovery" },
      );
      const picked: Candidate[] = [];
      for (const p of out.picks) {
        const c = balanced[p.index];
        if (!c || picked.includes(c)) continue;
        // keep the AI rephrase only if it stays close to the original (no new subject)
        const title = similarity(p.title, c.title) >= 0.5 ? p.title : c.title;
        picked.push({ ...c, title, score: Math.max(0, Math.min(100, p.score)), rationale: truncate(p.rationale, 300), origin: c.origin === "template" ? "ai" : c.origin, relevanceBy: "AI editor (text model)" } as Candidate & { relevanceBy: string });
      }
      if (picked.length) chosen = picked.slice(0, max);
    } catch (err) {
      notes.push(err instanceof NoProviderAvailableError ? `AI ranking skipped: ${err.message}` : `AI ranking failed, used default order: ${err instanceof Error ? err.message : err}`);
    }
  }

  const added: StudioTopic[] = [];
  for (const c of chosen) {
    const rel = (c as Candidate & { relevanceBy?: string }).relevanceBy;
    const r = await addTopic({ ...c, countryId, relevance: rel ? { score: c.score, reason: c.rationale, assessedBy: rel } : undefined });
    if (r.topic) added.push(r.topic);
  }
  await logActivity("system", "topics.discovered", `${added.length} new topic suggestion(s)`);
  return { added, notes };
}

/** Next topic for automatic generation: admin-approved first, then source changes, then best suggestion, rotating categories. */
export async function pickTopicForAutomation(autoPick: boolean): Promise<StudioTopic | null> {
  const topics = await listTopics();
  const approved = topics.filter((t) => t.status === "approved");
  if (approved.length) return approved.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
  if (!autoPick) return null;
  const suggested = topics.filter((t) => t.status === "suggested" && !t.duplicateOf);
  if (!suggested.length) return null;
  const fromSources = suggested.filter((t) => t.origin === "source_change");
  if (fromSources.length) return fromSources[0];
  // rotate: prefer a category not used by the most recent topics
  const recent = topics.filter((t) => t.status === "used" || t.status === "in_progress").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4).map((t) => t.category);
  return suggested.find((t) => !recent.includes(t.category)) ?? suggested[0];
}
