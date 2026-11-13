# SKOLAR Studio

SKOLAR Studio is the admin panel at **`/admin`** on the SKOLAR website. It researches,
drafts, reviews, schedules and publishes SKOLAR Insights articles. Blog automation is
the first live module. Carousel Studio, Reel Studio, Crawler & Monitoring and Website
Builder show as **Coming soon** and do nothing yet.

Nothing is published without an administrator's approval.

---

## 1. How it fits together

```
 Browser ──► /admin (Next.js, password session) ──► /api/studio/* (auth + same-origin check on every call)
                                                         │
                                Studio database ◄────────┤   Firestore (production) or .studio-data/ (local)
                                                         │
 Worker (Windows laptop → MacBook) ──────────────────────┘   research jobs · source monitoring · scheduled publishing
        │                                  │
        ├─► Groq (+ other providers, with fallback)
        └─► official websites (robots.txt respected)

 Publish ──► content/insights/<slug>.md  (GitHub commit → existing Vercel deploy)
         └─► Firestore siteArticles      (homepage Insights listing, live immediately)
 Public article page: /insights/<slug>   (mobile-first, sources, table of contents, CTA)
```

| Piece | Where |
|---|---|
| Admin UI | `src/app/admin/*`, `src/studio/ui/*` |
| API (one router) | `src/app/api/studio/[...path]/route.ts` → `src/studio/server/api.ts` |
| Core (shared by server and worker, no Next.js imports) | `src/studio/core/*` |
| Worker entry | `scripts/studio-worker.mts` → `src/studio/core/worker.ts` |
| Startup installers | `scripts/worker/install-windows.ps1`, `scripts/worker/install-macos.sh` |
| Published articles | `content/insights/*.md`, rendered by `src/app/insights/[slug]/page.tsx` |
| Tests | `tests/*.test.mts` (`npm test`) |

### The research pipeline

Every article goes through 12 stages. Each stage saves a checkpoint, so a crash, a
shutdown or a lost connection resumes at the stage that was running. It never starts
again from the beginning.

| # | Stage | What happens |
|---|---|---|
| 1 | plan | Search intent, audience, research questions, academic year. Duplicate check against all articles and topics. |
| 2 | sources | Official sources from the registry (universities, scholarship bodies, government, portals). Search results are added when a search provider is configured. Results are only leads. |
| 3 | collect | Pages are opened and read (three per step). Relevant same-site pages one link deeper are followed. Failures are recorded as failures. |
| 4 | extract | The AI pulls out facts, and each one must include a **verbatim quote**. A quote that isn't found in the page text is thrown away. |
| 5 | organise | Sources get numbers. Conflicting facts and unanswered questions are flagged. |
| 6 | outline | Built on the category's required structure (comparison, scholarship, cost, …). |
| 7 | write | Written section by section. Every specific fact must cite a fact ID, and those IDs become `[[n]]` citations. |
| 8 | verify | The body is fixed so claim checks run on the final text. |
| 9 | review | AI editorial review. Its issues are kept only if they quote the article exactly. |
| 10 | seo | SEO title, meta description, excerpt, slug, tags. |
| 11 | links | Related SKOLAR articles. |
| 12 | finalize | Claim verification + safety rules + quality gate → saved as a draft. |

**Claim statuses:** Verified · Partially verified · Needs review · Conflicting information · Unverified · Outdated.

**Safety rules** run on AI and manual articles alike (`src/studio/core/safety.ts`). They
block approval when an article promises admission, a visa, a scholarship or a job,
claims a SKOLAR partnership, includes money amounts that aren't sourced or labelled as
estimates, cites a source that doesn't exist, or leaves out the academic year on a
time-sensitive article. They warn about rankings, testimonials, first-person stories,
earlier academic years and deadlines that have passed.

**Quality gate.** A draft only counts toward the daily target if it has enough words,
at least two usable sources, no blocking warnings, and most of its factual claims
supported. A draft that fails is saved as *Needs review* and doesn't count, so the
system never pads the target with filler.

---

## 2. Running it

```bash
npm install
npm run dev                 # website + Studio on http://localhost:3000/admin
npm run studio:worker       # background worker (keep running)
npm test                    # 21 tests (unit + integration with mocked services)
```

Sign in at `/admin` with `ADMIN_PASSWORD`. In production the built-in development
default is **disabled**, so `ADMIN_PASSWORD` must be set.

### First steps in Studio
1. **Countries & Universities** → *Load Italy starter set*. This adds official
   homepages only, with no facts. Review the records and add programmes and notice pages.
2. **Research & Sources**: add the most useful official pages, such as scholarship
   notice pages (*bandi*) and international admissions pages. A specific page works
   better than a homepage.
3. **Integrations**: check what is connected.
4. **Blog Automation** → *Find new topics*, or *Research a topic now*.
5. **Settings**: switch Automation on and set the daily target.

---

## 3. The worker on Windows (now)

Install it once from the project folder. No admin rights are needed for the default
*at log-on* trigger:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\worker\install-windows.ps1
Start-ScheduledTask -TaskName "SKOLAR Studio Worker"      # start now without logging out
```

* `-Trigger AtStartup` starts it at boot instead (run PowerShell as administrator).
* `-Uninstall` removes the task.
* The task starts one minute after log-on and restarts every five minutes if it crashes.
  The worker refuses to run twice: it uses a PID lock file plus a lease in the database,
  so two computers sharing Firestore never both run.
* Logs: `.studio-data/logs/worker-YYYY-MM-DD.log`. Live state: the Overview page.

What the worker does in a loop:
1. Network check. When offline it waits and nothing is lost.
2. Publishes scheduled articles that are due, then refreshes the deployment status.
3. Checks a few official sources whose interval has elapsed.
4. If automation is on and today's completed drafts plus jobs in progress are below the
   target: picks a topic (approved first, then official-source changes, then the best
   suggestion, rotating categories) or discovers new ones, and creates a job. A topic
   can never create two jobs.
5. Runs one step of the next job and saves the checkpoint.

Jobs an admin starts with *Research now* also run when automation is off.

## 4. Moving to the founder's MacBook

The core uses no platform-specific code or hard-coded paths. To move:

1. Copy or clone the project to any folder on the Mac. Run `npm install`.
2. Copy `.env.local`.
3. **Data**:
   * If you use Firestore (recommended once `FIREBASE_SERVICE_ACCOUNT_JSON` is set),
     there is nothing to copy. Both machines see the same data.
   * If you are still in local mode, copy the `.studio-data/` folder (it is not in git).
4. On Windows, stop and remove the task: `install-windows.ps1 -Uninstall`.
5. On the Mac: `bash scripts/worker/install-macos.sh`. This installs a LaunchAgent that
   starts at login and restarts after a crash. Remove it with `--uninstall`.
6. Optional: `STUDIO_DATA_DIR` and `STUDIO_PROJECT_ROOT` override the folders.

## 5. Configuring "five drafts a day"

*Settings → Daily automation* (or the controls on *Blog Automation*):

* **Drafts per day**: default 5, counted per local calendar day in the publishing
  timezone (default Asia/Kolkata). Only drafts that pass the quality gate count, and
  each article counts once.
* **Pick topics automatically**: when off, only topics you approve are researched.
* Advanced: *Max jobs started per day* (default 12) stops a failing pipeline from using
  up API quota. Also *max retries*, *minimum sources* and *minimum words*.

If the computer starts late, the worker keeps going until the target is met. If the
target can't be met (no topics, API limits, the job cap), the reason appears on the
Overview and in Reports and a notification is sent.

**API budget note.** One draft takes roughly 20–30 AI calls (planning, extraction per
page, one call per section, review, SEO). Groq's free tier has daily token limits that
may not cover five drafts a day. When a limit is hit, jobs wait (status *Waiting for
API*) and continue later, and Overview shows *API limit reached*. Add a second provider
under *Integrations* for fallback, using only accounts you are entitled to use.

## 6. Approving and publishing safely

The workflow is: **Write → Save draft → (optional) checks → (optional) AI improvements →
Preview → Approve → Publish now or Schedule.** Approval and publishing are separate steps.

1. **Review Queue** → open a draft. Read it in **Preview**.
2. **Sources & checks.** Add sources one by one or with **Paste source list** (one per
   line, e.g. `[1] Page title — https://…`). Every source needs a title and a full
   http(s) URL; the text cites them as `[[1]]`, `[[2]]`… (one number per marker). A
   citation also covers the uncited sentences directly before it in the same paragraph,
   and table rows / list items inherit the citation of the paragraph that introduces
   them. Nothing is saved while a source is invalid — the error names the source.
3. Warnings come in two kinds:
   * **Technical — must fix** (blocks approval and publishing for every article): missing
     title/slug/excerpt, empty body, a malformed source, a `[[n]]` with no matching
     source, malformed citation markers, leftover research markers; for publishing also
     the featured image and its alt text, and a configured publishing destination.
   * **Editorial** (advice): uncited statements, unlabelled money amounts, promises,
     rankings, SEO/readability, etc. For **AI-generated** drafts the existing research
     gate is unchanged — blocking editorial warnings and the quality gate must be resolved
     before approval. For **manually written** articles the editor decides: *Approve with
     warnings…* lists them and requires a confirmation. The warnings stay on the
     article's record (and on its publish record); nothing is ever marked verified.
4. **Improve with AI** (or tick issues and **Fix selected issues**) creates a suggestion
   beside the article. **Compare versions** shows original vs suggested per section with
   flags for new numbers and added/removed citations. **Apply** the sections you choose
   (the previous text is kept under *Earlier versions*) or **Keep original**. A suggestion
   that cites a source number that does not exist cannot be applied.
5. **Featured image** (Image tab): upload your own (drag & drop; large images are resized
   in the browser to fit Vercel's 4.5 MB request limit), generate one, or pick a credited
   website photo. Every option stores the file in **Vercel Blob** and saves the URL on the
   article before it is shown; uploading does not require saving other edits first.
6. **Approve**, then **Schedule…** (next free slot or a pinned time) or **Publish now**
   (*Publish anyway* for a manual article with open warnings).
7. Publishing destination (shown in the Publishing panel; approval works without one):
   * **GitHub** (`GITHUB_TOKEN` + `GITHUB_REPO`): commits `content/insights/<slug>.md`;
     the Vercel deployment ships it.
   * **Firestore** (default on Vercel when GitHub is not set, needs `FIREBASE_PROJECT_ID`
     + `FIREBASE_WEB_API_KEY`): writes the same Markdown into `siteArticles/studio-<id>`
     (`content` field), which `/insights/[slug]` already reads — live without a redeploy.
   * **Local files** (development): writes `content/insights/<slug>.md`; commit and push.
   * Force one with `STUDIO_PUBLISH_TARGET=github|firestore|local`.
   * An article is marked **published only after the live page shows the exact version**
     (content key). Re-publishing unchanged content creates no new commit. A failed publish
     keeps the article approved and records the error.
   * Editing an approved or scheduled article sends it back for approval.

The **Publishing Calendar** shows the queue. Use ↑/↓ to swap slots. *Recalculate queue*
proposes moving articles into earlier free slots and shows the changes before applying
them. Pinned times never move, and every change is recorded in the article's schedule
history.

Production without the laptop: set `CRON_SECRET` and add a Vercel Cron job that calls
`GET /api/studio/cron` (header `Authorization: Bearer <CRON_SECRET>`). It publishes due
articles and is idempotent. Note that Vercel Hobby plans only allow daily crons.

---

## 7. Configuration reference

See `.env.example`. Key items:

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` | Studio sign-in (required in production) |
| `GROQ_API_KEY`, `GROQ_MODEL` | Default AI provider (created automatically) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firestore storage. Required on Vercel and for multi-machine use |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob (public store) — all Studio images. Firebase Storage is not used |
| `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH` | Publishing by Git commit (optional) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY` | Studio store via Firestore REST, and the Firestore publishing target |
| `STUDIO_PUBLISH_TARGET` | Optional: `github`, `firestore` or `local` |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | Optional AI image provider; without one, *Generate image* uses the SKOLAR renderer |
| `SERPER_API_KEY` / `BRAVE_SEARCH_API_KEY` / `GOOGLE_CSE_*` | Optional search discovery |
| `STUDIO_ENCRYPTION_KEY` | Encrypts provider keys pasted into Studio |
| `REVALIDATE_SECRET` | Worker refreshes the site right after scheduled publishing |
| `CRON_SECRET` | Optional Vercel Cron publishing endpoint |

### Firestore security rules

Studio collections (`studio*`) are read and written only by the server through the Admin
SDK (service account), which bypasses security rules. Browsers must never reach them.
Firestore denies everything that no rule allows, so **make sure no rule allows these
collections**. In particular, do not use a catch-all such as `match /{document=**} { allow read, write: if ... }`.
`siteArticles` keeps its existing rule (public read where `status == "published"`).

The homepage query on `siteArticles` (`status == "published"`, ordered by
`publishedAt`) needs a composite index. Firestore currently reports it as missing, and
the build log prints a link to create it. This was already the case before Studio.

### Known limits (honest list)
* **Google Trends**: not integrated. There is no official public API. Search-demand
  signals come from the search provider's "People also ask" and related searches
  (Serper or Brave).
* **PDF notices** (many *bandi* are PDFs) are detected and listed but not parsed. Open
  them and verify by hand.
* **Image generation** without `OPENAI_API_KEY`/`GEMINI_API_KEY` produces designed SKOLAR brand graphics (code-rendered), not AI pictures.
* **Local mode** (no service account) is a single-computer setup. Use Firestore for
  production and for the MacBook move.
