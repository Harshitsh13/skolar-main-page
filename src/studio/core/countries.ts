import fs from "node:fs/promises";
import path from "node:path";
import { COL, getStore } from "./store";
import type { CountryPublishState, StudioCountry } from "./types";
import { studioEnv } from "./env";
import { listRegions, listScholarships, listUniversities } from "./entities";
import { githubPutFile, publishTargets, type Revalidator, httpRevalidate } from "./publish";
import { deploymentFor } from "./deploy";
import { logActivity } from "./ops";
import { defaultDestinations } from "../../content/samples";
import { errorMessage, nowIso, sha256, slugify } from "./util";

type Row = StudioCountry & Record<string, unknown>;

/**
 * One country system: the Studio country record is the source of truth for
 * the public website. Publishing writes content/countries/<slug>.json (GitHub
 * commit → deployment, or a local file) and, with Firestore, the existing
 * `siteDestinations` record the homepage already reads.
 */

export interface PublicCountry {
  id: string;
  contentKey: string;
  slug: string;
  name: string;
  code: string;
  flag: string | null;
  active: boolean;
  cardTitle: string;
  shortDescription: string;
  focus: string | null;
  image: { url: string; alt: string; credit?: string; license?: string } | null;
  introContent: string;
  links: Array<{ label: string; url: string }>;
  platformUrl: string | null;
  ctaLabel: string | null;
  order: number;
  regions: Array<{ name: string; cities: string[] }>;
  universities: Array<{ name: string; city: string | null; website: string }>;
  scholarships: Array<{ name: string; organisation: string; website: string }>;
  updatedAt: string;
}

export function countryProblems(c: Partial<StudioCountry>, all: StudioCountry[]): string[] {
  const out: string[] = [];
  if (!c.name?.trim()) out.push("Name is required.");
  const slug = c.slug?.trim() || slugify(c.name ?? "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) out.push("Slug must use lowercase letters, numbers and hyphens.");
  if (all.some((x) => x.id !== c.id && (x.slug || slugify(x.name)) === slug)) out.push(`Slug "${slug}" is already used by another country.`);
  if (c.active) {
    if (!c.cardTitle?.trim()) out.push("Card title is required for an active country.");
    if (!c.shortDescription?.trim()) out.push("Short description is required for an active country.");
    if (!c.image?.url) out.push("Display image is required for an active country.");
    else if (!c.image.alt?.trim()) out.push("Display image needs alt text.");
    if (!c.platformUrl && !c.introContent?.trim()) out.push("Add introductory content or a platform URL so the card links somewhere.");
  }
  if (c.platformUrl && !/^https:\/\//.test(c.platformUrl)) out.push("Platform URL must start with https://");
  for (const l of c.links ?? []) if (!/^https?:\/\//.test(l.url)) out.push(`Link "${l.label}" needs a full URL.`);
  return out;
}

export async function buildPublicCountry(c: StudioCountry): Promise<PublicCountry> {
  const regions = (await listRegions()).filter((r) => r.countryId === c.id);
  const unis = (await listUniversities()).filter((u) => u.countryId === c.id);
  const schs = (await listScholarships()).filter((s) => s.countryId === c.id);
  const body: Omit<PublicCountry, "contentKey" | "updatedAt"> = {
    id: c.id,
    slug: c.slug || slugify(c.name),
    name: c.name,
    code: c.code,
    flag: c.flag || null,
    active: c.active,
    cardTitle: c.cardTitle || `Study in ${c.name}`,
    shortDescription: c.shortDescription || "",
    focus: c.focus || null,
    image: c.image ?? null,
    introContent: c.introContent || "",
    links: c.links ?? [],
    platformUrl: c.platformUrl || null,
    ctaLabel: c.ctaLabel || null,
    order: c.order ?? 999,
    regions: regions.map((r) => ({ name: r.name, cities: r.cities })),
    universities: unis.map((u) => ({ name: u.name, city: u.city ?? null, website: u.website })),
    scholarships: schs.map((s) => ({ name: s.name, organisation: s.organisation, website: s.website })),
  };
  return { ...body, contentKey: sha256(JSON.stringify(body)).slice(0, 24), updatedAt: nowIso() };
}

function hist(cur: StudioCountry, message: string) {
  return [...(cur.publish?.history ?? []), { at: nowIso(), message }].slice(-30);
}

async function patchPublish(id: string, p: Partial<CountryPublishState>, message?: string) {
  await getStore().transact<Row>(COL.countries, id, (cur) =>
    cur ? ({ ...cur, publish: { ...(cur.publish ?? { state: "draft" }), ...p, history: message ? hist(cur, message) : cur.publish?.history }, updatedAt: nowIso() } as Row) : undefined,
  );
}

/** Publishes (or re-publishes / deactivates) a country on the public website. */
export async function publishCountry(id: string, revalidate: Revalidator = httpRevalidate): Promise<StudioCountry> {
  const store = getStore();
  const c = await store.get<Row>(COL.countries, id);
  if (!c) throw new Error("Country not found.");
  const problems = countryProblems(c, await store.list<Row>(COL.countries));
  if (problems.length) throw new Error(problems.join(" "));
  const pub = await buildPublicCountry(c);
  const json = `${JSON.stringify({ ...pub, updatedAt: c.publish?.contentKey === pub.contentKey ? c.publish.publishedAt ?? pub.updatedAt : pub.updatedAt }, null, 2)}\n`;
  const targets = publishTargets();
  const filePath = `${(targets.github?.dir ?? "content/insights").replace(/insights\/?$/, "countries")}/${pub.slug}.json`;
  try {
    if (targets.github) {
      const r = await githubPutFile(targets.github, filePath, json, `${c.active ? "Publish" : "Deactivate"} country: ${c.name}`);
      await patchPublish(id, { state: "deploying", contentKey: pub.contentKey, commitSha: r.commitSha ?? c.publish?.commitSha, committedAt: nowIso(), path: filePath, lastError: undefined }, r.unchanged ? "No change — already committed" : `Committed ${filePath}`);
    } else if (targets.localFiles) {
      const abs = path.join(studioEnv.projectRoot(), ...filePath.split("/"));
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, json, "utf8");
      await patchPublish(id, { state: "awaiting_push", contentKey: pub.contentKey, path: filePath, committedAt: nowIso(), lastError: undefined }, `Wrote ${filePath} locally — commit and push to deploy`);
    } else throw new Error("No publishing target: configure GITHUB_TOKEN and GITHUB_REPO.");
    if (targets.siteRecord) {
      await store.set(COL.siteDestinations, `studio-${c.id}`, {
        title: pub.cardTitle,
        description: pub.shortDescription,
        category: pub.focus ?? undefined,
        countryName: pub.name,
        countryCode: pub.code,
        imageUrl: pub.image?.url ?? "",
        imageAlt: pub.image?.alt ?? "",
        url: pub.platformUrl ?? `/countries/${pub.slug}`,
        ctaLabel: pub.ctaLabel ?? undefined,
        order: pub.order,
        published: pub.active,
        institutions: pub.universities.map((u) => u.name),
        source: "studio",
        updatedAt: nowIso(),
      });
    }
    await revalidate(["/", `/countries/${pub.slug}`]);
    await logActivity("admin", "country.published", `${c.active ? "Published" : "Deactivated"} country: ${c.name}`, id);
    return (await advanceCountry(id))!;
  } catch (err) {
    await patchPublish(id, { state: "failed", lastError: errorMessage(err) }, `Failed: ${errorMessage(err)}`);
    throw err;
  }
}

/** Confirms deployment + live page for a country (worker/cron/manual check). */
export async function advanceCountry(id: string): Promise<StudioCountry | null> {
  const store = getStore();
  const c = await store.get<Row>(COL.countries, id);
  const p = c?.publish;
  if (!c || !p || !["deploying", "verifying", "awaiting_push"].includes(p.state)) return c;
  if (p.state === "deploying" && p.commitSha) {
    const d = await deploymentFor(p.commitSha);
    if (d.state === "error" || d.state === "canceled") {
      await patchPublish(id, { state: "failed", lastError: d.message }, `Deployment ${d.state}`);
      return store.get<Row>(COL.countries, id);
    }
    if (d.state !== "ready" && d.provider !== "none") return c;
  }
  const slug = c.slug || slugify(c.name);
  try {
    const url = `${studioEnv.siteUrl()}/countries/${slug}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const html = res.ok ? await res.text() : "";
    const key = /<meta name="skolar-content-key" content="([a-f0-9]+)"/.exec(html)?.[1];
    const ok = c.active ? key === p.contentKey : res.status === 404 || key === p.contentKey;
    if (ok) await patchPublish(id, { state: "published", publishedAt: p.publishedAt ?? nowIso(), verifiedAt: nowIso(), lastError: undefined }, `Verified live at ${url}`);
    else await patchPublish(id, { state: p.state === "awaiting_push" ? "awaiting_push" : "verifying", lastError: res.ok ? "Live page shows an older version." : `${url} returned HTTP ${res.status}` });
  } catch (err) {
    await patchPublish(id, { lastError: errorMessage(err) });
  }
  return store.get<Row>(COL.countries, id);
}

/**
 * Imports the homepage's existing country cards (the built-in defaults) into
 * Studio, so the country system starts from what the site already shows.
 * Existing Studio records are only filled in, never overwritten.
 */
export async function importExistingCountries(): Promise<{ created: number; updated: number }> {
  const store = getStore();
  let created = 0;
  let updated = 0;
  for (const d of defaultDestinations) {
    const id = (d.countryCode ?? d.id).toLowerCase();
    const cur = await store.get<Row>(COL.countries, id);
    const fields: Partial<StudioCountry> = {
      slug: slugify(d.countryName ?? d.id),
      cardTitle: d.title,
      shortDescription: d.description,
      focus: d.category,
      image: { url: d.imageUrl, alt: d.imageAlt ?? "" },
      platformUrl: d.url,
      ctaLabel: d.ctaLabel,
      order: d.order,
    };
    if (!cur) {
      await store.set(COL.countries, id, {
        name: d.countryName ?? d.title,
        code: (d.countryCode ?? id).toUpperCase(),
        active: true,
        currency: id === "it" ? "EUR" : id === "mn" ? "MNT" : "EUR",
        academicYearStartMonth: 9,
        academicYearFormat: "YYYY/YYYY",
        extraCategories: [],
        ...fields,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      created++;
    } else {
      const fill = Object.fromEntries(Object.entries(fields).filter(([k]) => (cur as Record<string, unknown>)[k] === undefined || (cur as Record<string, unknown>)[k] === ""));
      if (Object.keys(fill).length) {
        await store.set(COL.countries, id, { ...fill, updatedAt: nowIso() }, { merge: true });
        updated++;
      }
    }
  }
  return { created, updated };
}

export async function advanceCountries(): Promise<void> {
  for (const c of await getStore().list<Row>(COL.countries)) {
    if (c.publish && ["deploying", "verifying", "awaiting_push"].includes(c.publish.state)) await advanceCountry(c.id).catch(() => undefined);
  }
}
