import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

/** Countries published from SKOLAR Studio (content/countries/<slug>.json). */
export interface PublishedCountry {
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

const DIR = () => path.join(process.cwd(), "content", "countries");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function valid(c: Partial<PublishedCountry>): c is PublishedCountry {
  return Boolean(c && typeof c.slug === "string" && SLUG.test(c.slug) && c.name && c.code && typeof c.active === "boolean");
}

/** All published country files, including deactivated ones (they suppress defaults). */
export async function listPublishedCountries(): Promise<PublishedCountry[]> {
  let names: string[];
  try {
    names = await fs.readdir(DIR());
  } catch {
    return [];
  }
  const out: PublishedCountry[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const c = JSON.parse(await fs.readFile(path.join(DIR(), n), "utf8")) as Partial<PublishedCountry>;
      if (valid(c)) out.push({ ...c, links: c.links ?? [], regions: c.regions ?? [], universities: c.universities ?? [], scholarships: c.scholarships ?? [] });
    } catch {
      /* skip malformed file */
    }
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export async function getPublishedCountry(slug: string): Promise<PublishedCountry | null> {
  if (!SLUG.test(slug)) return null;
  const all = await listPublishedCountries();
  return all.find((c) => c.slug === slug && c.active) ?? null;
}
