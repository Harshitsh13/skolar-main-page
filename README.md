# SKOLAR: main brand website

The public SKOLAR website: one page, in this order:

1. **SKOLAR AI University Finder**: 5-question assessment → Grok analysis → personalised report → WhatsApp counsellor hand-off
2. **Insights**: latest articles in an editorial layout (from Firestore)
3. **What SKOLAR does**: services told as a three-phase route (`src/content/services.ts`)
4. **The SKOLAR Group**: destination platform cards (from Firestore, managed in the Control Center)
5. **Contact** + footer

Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · Motion · Zod. Deploy on Vercel.

## SKOLAR Studio (admin panel at `/admin`)

AI research → cited drafts → review → schedule → publish for SKOLAR Insights, plus a
background worker for five drafts a day. Full guide: **[docs/STUDIO.md](docs/STUDIO.md)**.

```bash
npm run studio:worker   # background worker (Windows: scripts/worker/install-windows.ps1)
npm test                # Studio test suite
```

## Run it

```bash
npm install
cp .env.example .env.local   # fill in what you have
npm run dev                  # http://localhost:3000
npm run build                # production build
```

In development, clearly-labelled **sample** articles and destination cards are shown
while Firestore has no published content. In production they are never shown unless
`NEXT_PUBLIC_SHOW_SAMPLE_CONTENT=true`.

## Configuration (`.env.example`)

| Variable | Needed for |
|---|---|
| `XAI_API_KEY`, `XAI_MODEL` | University Finder analysis (server-only). Without it the finder says it isn't connected and offers the counsellor. It never shows fake results. |
| `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY` | Reading published destinations & articles |
| `FIREBASE_SERVICE_ACCOUNT_JSON`, `FINDER_STORE_ASSESSMENTS` | Optional: saving finder assessments for counsellors |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Every WhatsApp button. Until it is set, they point to the contact section. |
| `NEXT_PUBLIC_CONTACT_*`, `NEXT_PUBLIC_SOCIAL_*` | Footer/contact details. Blank = not shown. |
| `REVALIDATE_SECRET` | Instant refresh after publishing (`POST /api/revalidate`) |

## How the pieces fit

```
src/
  app/
    page.tsx                 the homepage (ISR, 5 min)
    api/finder/route.ts      validates answers → Grok (strict JSON schema) → re-checks claims → optional save
    api/revalidate/route.ts  cache refresh hook for the Control Center
    insights/                full article index ("View All Insights")
    privacy/, terms/         placeholders: real legal text needed before launch
  config/
    site.ts                  contact, WhatsApp, nav: all from env
    finder.ts                questions, grade formats, subjects, countries (edit here)
  content/
    services.ts              "What SKOLAR does" copy (every entry is marked unconfirmed)
    samples.ts               dev-only sample content
    credits.ts               photo credits (CC licences, shown in footer)
  lib/
    content.ts               Firestore → typed Destination/Article (+ sample fallback)
    firestore-rest.ts        server-only Firestore REST reader (no Firebase SDK in the browser)
    finder-schema.ts         answer validation + AI result schema
    finder-prompt.ts         system prompt + grounding (server-only)
    grok.ts                  xAI client (server-only)
  components/
    finder/                  questionnaire, loading, report, WhatsApp message builder
    sections/                page sections, header, footer
integration/control-center/  how to add the "Website" module to the existing admin
```

### How the finder stays honest

- The model receives only the student's answers plus **published** SKOLAR platform
  data. Sample cards never ground the AI.
- Strict structured output; the server re-validates it with Zod.
- A university is labelled "Listed by SKOLAR" only if the server finds it in an
  admin-verified `institutions` list. Everything else is "To verify".
- No fees, deadlines, cut-offs or guarantees; the report says it is exploratory.
- The student's free text is treated as data, never as instructions.
- WhatsApp sharing is opt-in; the message can be previewed and is sent by the student.

### Analytics hook

The finder emits `window` events named `skolar:finder` (`start`, `step`, `submit`,
`complete`, `whatsapp`) so any analytics tool can be attached later without touching it.

## Before launch

- [ ] Official WhatsApp number, contact details and social links in env
- [ ] `XAI_API_KEY` in Vercel (server env)
- [ ] Control Center "Website" module + Firestore rules (see `integration/control-center/README.md`)
- [ ] Confirm the services copy in `src/content/services.ts`
- [ ] Privacy Policy and Terms (the finder processes the student's answers)
- [ ] Confirm the platform URLs (sample data uses the Control Center defaults: skolar.it, skolar.it/mongolia)
- [ ] Add a Vercel Firewall rate-limit rule for `/api/finder`
