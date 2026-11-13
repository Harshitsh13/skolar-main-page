import { COL, getStore } from "./store";
import type { StudioCountry, StudioRegion, StudioScholarship, StudioSource, StudioUniversity } from "./types";
import { hostOf } from "./fetcher";
import { nowIso, slugify } from "./util";

export async function listCountries() {
  return (await getStore().list<StudioCountry & Record<string, unknown>>(COL.countries)).sort((a, b) => a.name.localeCompare(b.name));
}
export async function listRegions() {
  return (await getStore().list<StudioRegion & Record<string, unknown>>(COL.regions)).sort((a, b) => a.name.localeCompare(b.name));
}
export async function listUniversities() {
  return (await getStore().list<StudioUniversity & Record<string, unknown>>(COL.universities)).sort((a, b) => a.name.localeCompare(b.name));
}
export async function listScholarships() {
  return (await getStore().list<StudioScholarship & Record<string, unknown>>(COL.scholarships)).sort((a, b) => a.name.localeCompare(b.name));
}
export async function listSources() {
  return (await getStore().list<StudioSource & Record<string, unknown>>(COL.sources)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCountry(id: string): Promise<StudioCountry> {
  const c = await getStore().get<StudioCountry & Record<string, unknown>>(COL.countries, id);
  return (
    c ?? {
      id,
      name: id === "it" ? "Italy" : id.toUpperCase(),
      code: id.toUpperCase(),
      active: true,
      currency: "EUR",
      academicYearStartMonth: 9,
      academicYearFormat: "YYYY/YYYY",
      extraCategories: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
  );
}

/** Every official domain known to the registry (for source-type classification). */
export async function officialDomains(): Promise<Map<string, "official_university" | "scholarship_authority" | "government" | "application_portal">> {
  const map = new Map<string, "official_university" | "scholarship_authority" | "government" | "application_portal">();
  for (const u of await listUniversities()) {
    for (const d of [hostOf(u.website), ...u.officialDomains]) if (d) map.set(d.replace(/^www\./, ""), "official_university");
  }
  for (const s of await listScholarships()) {
    for (const url of [s.website, s.portalUrl ?? ""]) {
      const d = hostOf(url);
      if (d) map.set(d, "scholarship_authority");
    }
  }
  for (const s of await listSources()) {
    const d = hostOf(s.url);
    if (!d || map.has(d)) continue;
    if (s.category === "government" || s.category === "consulate") map.set(d, "government");
    else if (s.category === "application_portal") map.set(d, "application_portal");
    else if (s.category === "scholarship") map.set(d, "scholarship_authority");
    else if (s.category === "university") map.set(d, "official_university");
  }
  return map;
}

/* ───────────── Italy starter set ─────────────
 * Official homepages only — no facts. Loaded on request from the Countries
 * page; every record is editable and should be confirmed by an administrator.
 */

export async function seedItaly(): Promise<{ created: number }> {
  const store = getStore();
  const now = nowIso();
  let created = 0;
  const put = async (col: string, id: string, data: Record<string, unknown>) => {
    if (await store.create(col, id, { ...data, createdAt: now, updatedAt: now })) created++;
  };

  await put(COL.countries, "it", {
    name: "Italy",
    code: "IT",
    active: true,
    currency: "EUR",
    academicYearStartMonth: 9,
    academicYearFormat: "YYYY/YYYY",
    extraCategories: [],
  });

  const regions: Array<[string, string, string[]]> = [
    ["sicily", "Sicily", ["Messina", "Palermo", "Catania"]],
    ["emilia-romagna", "Emilia-Romagna", ["Bologna"]],
    ["tuscany", "Tuscany", ["Florence", "Pisa", "Siena"]],
    ["piedmont", "Piedmont", ["Turin"]],
  ];
  for (const [id, name, cities] of regions) await put(COL.regions, `it-${id}`, { countryId: "it", name, cities, resources: [] });

  const unis: Array<[string, string, string, string, string]> = [
    ["unime", "University of Messina", "it-sicily", "Messina", "https://www.unime.it"],
    ["unibo", "University of Bologna", "it-emilia-romagna", "Bologna", "https://www.unibo.it"],
    ["unipa", "University of Palermo", "it-sicily", "Palermo", "https://www.unipa.it"],
  ];
  for (const [id, name, regionId, city, website] of unis) {
    await put(COL.universities, id, {
      countryId: "it",
      regionId,
      name,
      city,
      website,
      officialDomains: [hostOf(website)],
      campuses: [],
      departments: [],
      courses: [],
      scholarshipIds: [],
      researchEnabled: true,
      notes: "Starter record — confirm details.",
    });
  }

  const sch: Array<[string, string, string, string, string, string[]]> = [
    ["ersu-messina", "ERSU Messina regional study grant", "ERSU Messina", "it-sicily", "https://www.ersumessina.it", ["unime"]],
    ["dsu-toscana", "DSU Toscana regional study grant", "Azienda Regionale DSU Toscana", "it-tuscany", "https://www.dsu.toscana.it", []],
    ["edisu-piemonte", "EDISU Piemonte regional study grant", "EDISU Piemonte", "it-piedmont", "https://www.edisu.piemonte.it", []],
    ["ergo-emilia-romagna", "ER.GO regional study grant", "ER.GO", "it-emilia-romagna", "https://www.er-go.it", ["unibo"]],
  ];
  for (const [id, name, organisation, regionId, website, universityIds] of sch) {
    await put(COL.scholarships, id, { countryId: "it", regionId, name, organisation, website, universityIds, monitor: true, notes: "Starter record — confirm details." });
  }

  const sources: Array<[string, string, StudioSource["category"], Partial<StudioSource>]> = [
    ["Universitaly", "https://www.universitaly.it", "application_portal", {}],
    ["Ministry of University and Research (MUR)", "https://www.mur.gov.it", "government", {}],
    ["Visa for Italy (Ministry of Foreign Affairs)", "https://vistoperitalia.esteri.it", "government", {}],
    ["University of Messina", "https://www.unime.it", "university", { universityId: "unime", regionId: "it-sicily" }],
    ["University of Bologna", "https://www.unibo.it", "university", { universityId: "unibo", regionId: "it-emilia-romagna" }],
    ["University of Palermo", "https://www.unipa.it", "university", { universityId: "unipa", regionId: "it-sicily" }],
    ["ERSU Messina", "https://www.ersumessina.it", "scholarship", { scholarshipId: "ersu-messina", regionId: "it-sicily" }],
    ["DSU Toscana", "https://www.dsu.toscana.it", "scholarship", { scholarshipId: "dsu-toscana", regionId: "it-tuscany" }],
    ["EDISU Piemonte", "https://www.edisu.piemonte.it", "scholarship", { scholarshipId: "edisu-piemonte", regionId: "it-piedmont" }],
    ["ER.GO Emilia-Romagna", "https://www.er-go.it", "scholarship", { scholarshipId: "ergo-emilia-romagna", regionId: "it-emilia-romagna" }],
  ];
  for (const [name, url, category, extra] of sources) {
    await put(COL.sources, `src-${slugify(hostOf(url))}`, {
      name,
      url,
      countryId: "it",
      category,
      monitor: true,
      frequencyHours: 24,
      consecutiveFailures: 0,
      ...extra,
    });
  }
  return { created };
}
