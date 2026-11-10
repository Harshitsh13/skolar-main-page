# Connecting the SKOLAR main website to the SKOLAR Control Center

The main website does **not** have its own admin. Everything it shows that changes
(destination cards and Insights articles) is managed from the existing
**SKOLAR Control Center** (`../backend`), stored in the same Firebase project
(`skolar-backend`) with images on Vercel Blob.

This folder holds ready-to-use code and exact steps. Nothing here has been applied
to the backend repository yet.

```
Control Center (admin)            Firestore (skolar-backend)          Main website
──────────────────────            ──────────────────────────          ────────────
"Website" module  ── write ──▶    siteDestinations  (published)  ◀── read (REST, public rules)
                  ── write ──▶    siteArticles      (published)  ◀── read
Students module   ◀── read ───    finderAssessments              ◀── write (Admin SDK, server)
Image upload      ── /api/blob?access=public ──▶ Vercel Blob (public URLs) ──▶ <Image> on site
```

---

## 1. Firestore

**Rules:** paste `firestore.rules.additions` into `backend/firestore.rules`.

**Index:** add the entry in `firestore.indexes.additions.json`, then deploy:

```
firebase deploy --only firestore:rules,firestore:indexes
```

**Permission:** add `site.manage` and `module.website` to `src/types/permissions.ts`:

```ts
// PermissionKey union
| 'module.website'
| 'site.manage'

// DEFAULT_ROLE_PERMISSIONS: add both to super_admin and admin
// ALL_PERMISSIONS:
{ key: 'module.website', label: 'Access Website Content', group: 'Module Access' },
{ key: 'site.manage',    label: 'Manage Website Destinations & Articles', group: 'Configuration' },
```

## 2. Public images on Vercel Blob

`backend/api/blob.ts` currently uploads everything with `access: 'private'`,
which is right for student documents. Website images must be **public**, or the
site cannot display them. Allow public access only under the `site/` prefix:

```ts
// in the POST branch of api/blob.ts
const wantsPublic = parsedUrl.searchParams.get('access') === 'public';
if (wantsPublic && !pathname.startsWith('site/')) {
  res.status(400).json({ error: 'Public uploads are only allowed under site/' });
  return;
}
const blob = await put(pathname, bodyBuffer, {
  access: wantsPublic ? 'public' : 'private',
  addRandomSuffix: true,
  contentType,
  token,
});
```

If the Blob store itself is configured as private-only, create a separate
**public** Blob store for website images and use its token for `site/` uploads.

The main website already allows `*.public.blob.vercel-storage.com` in `next.config.ts`.

## 3. Service

Copy `siteContentService.ts` to `backend/src/services/` and move its two
interfaces into `src/types/index.ts`. It uses the existing `firestoreUtils`
helpers, so caching and offline behaviour match the rest of the Control Center.

## 4. The "Website" module (UI)

Add a `website` section to `Sidebar.tsx` (`NavigationSection`, icon e.g.
`LayoutTemplate` from lucide-react, `moduleKey: 'website'`) and render a
`WebsiteContentView` in `App.tsx`, the same way `CountryList` is wired.

`WebsiteContentView` has two tabs (reuse `TabNav`):

**Destination cards**, modelled on `CountryList` + `CountryFormModal`:

| Field | Control | Notes |
|---|---|---|
| Image | file input → `uploadSiteImage(file, 'destinations')` | show preview; 4:3 or wider, ≥ 1600px |
| Title | `Input` | "Explore Higher Education in Italy" |
| Short description | textarea | 1–2 sentences |
| Education category | `CreatableSelect` (optional) | "Medicine", "Undergraduate · Postgraduate" |
| Country | `Select` from `getCountries()` | fills `countryName` + `countryCode` |
| Website URL | `Input type="url"` | must start with `https://` |
| Button label | `Input` (optional) | default "Explore Platform" |
| Verified institutions | tag list (optional) | used only to ground the AI finder |
| Published | toggle | `setSiteDestinationPublished` |

List view: image thumbnail, title, country, published badge, ↑/↓ buttons
calling `reorderSiteDestinations`, edit, delete (`ConfirmDialog`).

**Articles**: same pattern with `saveSiteArticle`: cover image, title,
excerpt, category, publish date, reading time (optional), article URL,
featured toggle, draft/published status.

## 5. Showing changes immediately (optional)

The website refreshes its content every 5 minutes on its own. To update it
instantly after saving, add a tiny serverless function to the Control Center
(the secret must stay server-side, never in a `VITE_` variable):

```ts
// backend/api/site-revalidate.ts
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();
  const r = await fetch(`${process.env.SITE_URL}/api/revalidate`, {
    method: 'POST',
    headers: { 'x-revalidate-secret': process.env.SITE_REVALIDATE_SECRET! },
  });
  res.status(r.status).json(await r.json());
}
```

Then call `fetch('/api/site-revalidate', { method: 'POST' })` after each save.
Set `SITE_REVALIDATE_SECRET` to the same value as the website's `REVALIDATE_SECRET`.

## 6. University Finder assessments (optional)

When the website has `FINDER_STORE_ASSESSMENTS=true` and a service account,
each analysis is saved to `finderAssessments/{ref}` (e.g. `SK-7KQ2MD`) with
the answers and the AI report. Contact details are never collected by the finder. When a student
shares their results on WhatsApp, the message includes this reference, so a
counsellor can open the full report. A simple read-only list in the
Students module is enough to start.
