import { COL, getStore } from "./store";
import type { StudioSource } from "./types";
import { listScholarships, listSources, listUniversities } from "./entities";
import { decodeEntities, fetchPage, fetchText, FetchBlockedError, hostOf, NetworkError, sitemapsFor } from "./fetcher";
import { searchProviderName, webSearch } from "./search";
import { logActivity } from "./ops";
import { recordIntegrationCheck } from "./integrations";
import { errorMessage, nowIso, sha256, slugify, truncate } from "./util";

/**
 * Official page discovery ("search/source discovery").
 *
 * For every institution in the registry (universities, scholarship bodies,
 * official sources), find the pages that matter to international students —
 * admissions, fees, scholarships, programmes, international office, housing,
 * student services, visa and official notices — from:
 *   - the site's own sitemap (declared in robots.txt), or
 *   - links on the official homepage when there is no sitemap,
 *   - plus web search results restricted to the official domain, when a
 *     search provider is configured.
 * robots.txt is honoured. Discovered pages wait for an administrator to verify
 * them; verified pages join the source registry and feed research.
 */

export type PageCategory = "admissions" | "fees" | "scholarships" | "courses" | "international" | "housing" | "services" | "visa" | "notices";

export interface DiscoveredPage {
  id: string;
  url: string;
  title: string;
  category: PageCategory;
  institution: { kind: "university" | "scholarship" | "source"; id: string; name: string };
  countryId: string;
  regionId?: string;
  via: "sitemap" | "links" | "search";
  discoveredAt: string;
  lastSeenAt: string;
  status: "pending" | "verified" | "rejected";
  sourceId?: string;
}

export const PAGE_CATEGORY_LABEL: Record<PageCategory, string> = {
  admissions: "Admissions",
  fees: "Fees & tuition",
  scholarships: "Scholarships & aid",
  courses: "Programmes",
  international: "International office",
  housing: "Housing",
  services: "Student services",
  visa: "Visa & permits",
  notices: "Official notices",
};

// Matched against the URL path and link text split into words, so names such as
// "Bandini" or "Borsari" never match "bandi"/"borsa". Stems end in \w* on purpose.
const RULES: Array<[PageCategory, RegExp]> = [
  ["visa", /\b(visa|visas|visto|visti|permesso di soggiorno|residence permit)\b/],
  ["scholarships", /\b(borsa|borse|borse di studio|scholarships?|benefici|diritto allo studio|dsu|graduatori\w*|esoner\w*|fee waivers?|exemptions?)\b/],
  ["fees", /\b(tasse|contribuzion\w*|contributi|tuition|fees?|isee)\b/],
  ["admissions", /\b(ammission\w*|admissions?|immatricolazion\w*|iscrizion\w*|enrol\w*|how to apply|apply|pre enrol\w*|preiscrizion\w*|test di ingresso|imat)\b/],
  ["international", /\b(international|internazionale|foreign|stranier\w*|incoming|erasmus|welcome|titolo estero|mobility|mobilita)\b/],
  ["housing", /\b(alloggi\w*|housing|residenz\w*|accommodation|posti letto|dormitor\w*)\b/],
  ["courses", /\b(corsi di laurea|offerta formativa|degree programmes?|bachelor\w*|masters?|laurea|lauree|courses?|programmes?)\b/],
  ["services", /\b(servizi agli studenti|student services|mensa|canteen|tutorato|disabilit\w*|counsel\w*|orientamento)\b/],
  ["notices", /\b(bandi|bando|avvisi|avviso|notices?|announcements?)\b/],
];

const NOISE = /\.(jpg|jpeg|png|gif|svg|zip|docx?|xlsx?|pptx?|mp4|mp3)$|\/(wp-content|tag|author|feed|print|login|cart|search)\/|\/(sitoweb|people|persone|docenti|rubrica|staff|personale|concorsi-personale|bandi-di-gara|gare|appalti|amministrazione-trasparente|albo|news|notizie|eventi|events)(\/|$)/i;

function words(s: string): string {
  return ` ${s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
}

export function classify(url: string, text = ""): PageCategory | null {
  if (NOISE.test(url)) return null;
  let path = url;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    /* keep raw */
  }
  const hay = `${words(path)} ${words(text)}`;
  for (const [cat, re] of RULES) if (re.test(hay)) return cat;
  return null;
}

const normUrl = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").replace(/^http:/, "https:");

interface Target {
  kind: DiscoveredPage["institution"]["kind"];
  id: string;
  name: string;
  url: string;
  countryId: string;
  regionId?: string;
}

async function targets(): Promise<Target[]> {
  const out: Target[] = [];
  for (const u of await listUniversities()) if (u.researchEnabled && u.website) out.push({ kind: "university", id: u.id, name: u.name, url: u.website, countryId: u.countryId, regionId: u.regionId });
  for (const s of await listScholarships()) if (s.website) out.push({ kind: "scholarship", id: s.id, name: s.organisation || s.name, url: s.website, countryId: s.countryId, regionId: s.regionId });
  const hosts = new Set(out.map((t) => hostOf(t.url)));
  for (const s of await listSources()) {
    if (hosts.has(hostOf(s.url)) || !["government", "application_portal", "consulate"].includes(s.category)) continue;
    out.push({ kind: "source", id: s.id, name: s.name, url: s.url, countryId: s.countryId, regionId: s.regionId });
    hosts.add(hostOf(s.url));
  }
  return out;
}

async function fromSitemap(t: Target): Promise<Array<{ url: string; title: string }>> {
  const origin = new URL(t.url).origin;
  const queue = await sitemapsFor(origin);
  const urls: string[] = [];
  const seen = new Set<string>();
  while (queue.length && seen.size < 6) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    let xml: string;
    try {
      xml = await fetchText(sm);
    } catch {
      continue;
    }
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1]));
    if (/<sitemapindex/i.test(xml)) {
      // prefer sub-sitemaps likely to hold pages (not news/images), English first
      const low = (u: string) => Number(/news|notizie|image|video|people|persone|sitoweb|docenti|staff|rubrica/i.test(u));
      const ranked = locs.sort((a, b) => low(a) - low(b) || Number(!/\ben\b|english/i.test(a)) - Number(!/\ben\b|english/i.test(b)));
      queue.push(...ranked.slice(0, 5));
    } else urls.push(...locs);
    if (urls.length > 20_000) break;
  }
  return urls.filter((u) => hostOf(u) === hostOf(t.url)).map((u) => ({ url: u, title: "" }));
}

async function fromLinks(t: Target): Promise<Array<{ url: string; title: string }>> {
  const page = await fetchPage(t.url);
  const host = hostOf(page.finalUrl);
  return page.links.filter((l) => hostOf(l.url) === host).map((l) => ({ url: l.url, title: l.text }));
}

async function fromSearch(t: Target): Promise<Array<{ url: string; title: string }>> {
  if (!searchProviderName()) return [];
  const host = hostOf(t.url);
  const r = await webSearch(`site:${host} international students admission scholarship fees`, { num: 10 });
  return r.results.filter((x) => hostOf(x.url) === host).map((x) => ({ url: x.url, title: x.title }));
}

export interface DiscoveryRun {
  at: string;
  institutions: number;
  found: number;
  added: number;
  errors: Array<{ institution: string; message: string }>;
}

/** Discovers official pages for every registry institution (or one). */
export async function discoverOfficialPages(opts: { institutionId?: string; perInstitution?: number; report?: (m: string) => void } = {}): Promise<DiscoveryRun> {
  const store = getStore();
  const existing = new Map((await store.list<DiscoveredPage & Record<string, unknown>>(COL.discovered)).map((d) => [d.id, d]));
  const registry = new Set((await listSources()).map((s) => normUrl(s.url)));
  const list = (await targets()).filter((t) => !opts.institutionId || t.id === opts.institutionId);
  const run: DiscoveryRun = { at: nowIso(), institutions: list.length, found: 0, added: 0, errors: [] };
  const per = opts.perInstitution ?? 30;

  for (const t of list) {
    opts.report?.(`Discovering pages on ${hostOf(t.url)} (${t.name})`);
    let candidates: Array<{ url: string; title: string; via: DiscoveredPage["via"] }> = [];
    try {
      const sm = await fromSitemap(t);
      if (sm.length) candidates = sm.map((c) => ({ ...c, via: "sitemap" as const }));
    } catch (err) {
      run.errors.push({ institution: t.name, message: `sitemap: ${errorMessage(err)}` });
    }
    if (!candidates.length) {
      try {
        candidates = (await fromLinks(t)).map((c) => ({ ...c, via: "links" as const }));
      } catch (err) {
        run.errors.push({ institution: t.name, message: err instanceof FetchBlockedError ? `not allowed: ${err.message}` : errorMessage(err) });
        if (err instanceof NetworkError) continue;
      }
    }
    try {
      candidates.push(...(await fromSearch(t)).map((c) => ({ ...c, via: "search" as const })));
    } catch (err) {
      run.errors.push({ institution: t.name, message: `search: ${errorMessage(err)}` });
    }

    const pick = (list: typeof candidates) => {
      const out = new Map<string, { url: string; title: string; via: DiscoveredPage["via"]; category: PageCategory }>();
      for (const c of list) {
        const url = normUrl(c.url);
        if (!/^https:\/\//.test(url) || registry.has(url)) continue;
        const category = classify(url, c.title);
        if (category && !out.has(url)) out.set(url, { ...c, url, category });
      }
      return out;
    };
    let picked = pick(candidates);
    // A sitemap with nothing student-facing (e.g. only staff pages): use the homepage links instead.
    if (!picked.size && candidates.some((c) => c.via === "sitemap")) {
      try {
        picked = pick((await fromLinks(t)).map((c) => ({ ...c, via: "links" as const })));
      } catch (err) {
        run.errors.push({ institution: t.name, message: errorMessage(err) });
      }
    }
    // Balance categories so one section of a big sitemap cannot crowd out the rest.
    const byCat = new Map<PageCategory, Array<{ url: string; title: string; via: DiscoveredPage["via"]; category: PageCategory }>>();
    // Student-facing pages first: research/PhD/archived sections last, then shorter (higher-level) URLs.
    const rank = (u: string) => (/\/(ricerca|research|dottorat|phd|archivio|archive)\b/i.test(u) ? 1 : 0);
    for (const p of [...picked.values()].sort((a, b) => rank(a.url) - rank(b.url) || a.url.length - b.url.length)) byCat.set(p.category, [...(byCat.get(p.category) ?? []), p]);
    const chosen: typeof candidates & Array<{ category: PageCategory }> = [];
    while (chosen.length < per && [...byCat.values()].some((l) => l.length)) {
      for (const l of byCat.values()) {
        const next = l.shift();
        if (next && chosen.length < per) chosen.push(next as never);
      }
    }
    run.found += chosen.length;
    for (const p of chosen) {
      const id = `pg_${sha256(p.url).slice(0, 24)}`;
      const now = nowIso();
      const prev = existing.get(id);
      const title = p.title?.trim() || truncate(decodeURIComponent(p.url.split("/").filter(Boolean).pop() ?? p.url).replace(/[-_]+/g, " "), 120);
      if (prev) {
        await store.set(COL.discovered, id, { lastSeenAt: now }, { merge: true });
        continue;
      }
      const doc: DiscoveredPage = {
        id,
        url: p.url,
        title,
        category: p.category,
        institution: { kind: t.kind, id: t.id, name: t.name },
        countryId: t.countryId,
        regionId: t.regionId,
        via: p.via,
        discoveredAt: now,
        lastSeenAt: now,
        status: "pending",
      };
      if (await store.create(COL.discovered, id, doc as unknown as Record<string, unknown>)) run.added++;
    }
  }
  await recordIntegrationCheck("discovery", run.institutions > 0 && run.errors.length < run.institutions, run.institutions === 0 ? "No institutions in the registry." : `${run.added} new page(s) from ${run.institutions} institution(s)${run.errors.length ? `, ${run.errors.length} error(s)` : ""}`, run.errors.map((e) => `${e.institution}: ${e.message}`).join("; ") || undefined);
  await store.set(COL.integrations, "discovery-last-run", run as unknown as Record<string, unknown>);
  await logActivity("system", "discovery.run", `Official page discovery: ${run.added} new page(s), ${run.errors.length} error(s)`);
  return run;
}

export async function listDiscovered(): Promise<DiscoveredPage[]> {
  return (await getStore().list<DiscoveredPage & Record<string, unknown>>(COL.discovered)).sort((a, b) => b.discoveredAt.localeCompare(a.discoveredAt));
}

/** Verifying a page adds it to the source registry (monitored for changes). */
export async function verifyDiscovered(id: string): Promise<StudioSource> {
  const store = getStore();
  const d = await store.get<DiscoveredPage & Record<string, unknown>>(COL.discovered, id);
  if (!d) throw new Error("Discovered page not found.");
  const now = nowIso();
  const sid = `src-${slugify(hostOf(d.url) + new URL(d.url).pathname, 70)}`;
  const category: StudioSource["category"] = d.institution.kind === "university" ? "university" : d.institution.kind === "scholarship" ? "scholarship" : d.category === "visa" ? "consulate" : "government";
  const src: StudioSource = {
    id: sid,
    name: `${d.institution.name} — ${PAGE_CATEGORY_LABEL[d.category]}`,
    url: d.url,
    countryId: d.countryId,
    regionId: d.regionId,
    universityId: d.institution.kind === "university" ? d.institution.id : undefined,
    scholarshipId: d.institution.kind === "scholarship" ? d.institution.id : undefined,
    category,
    monitor: ["scholarships", "admissions", "notices", "fees"].includes(d.category),
    frequencyHours: 24,
    consecutiveFailures: 0,
    createdAt: now,
    updatedAt: now,
  };
  await store.create(COL.sources, sid, src as unknown as Record<string, unknown>);
  await store.set(COL.discovered, id, { status: "verified", sourceId: sid }, { merge: true });
  await logActivity("admin", "discovery.verified", `Verified official page: ${d.url}`, sid);
  return src;
}

export async function rejectDiscovered(id: string): Promise<void> {
  await getStore().set(COL.discovered, id, { status: "rejected" }, { merge: true });
}

/** Pages to use in research for an institution: verified first, then pending (still official-domain pages). */
export async function discoveredFor(institutionIds: string[]): Promise<DiscoveredPage[]> {
  const all = await listDiscovered();
  return all
    .filter((d) => institutionIds.includes(d.institution.id) && d.status !== "rejected")
    .sort((a, b) => Number(b.status === "verified") - Number(a.status === "verified"));
}
