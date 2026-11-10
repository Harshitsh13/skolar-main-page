import { z } from "zod";
import { EDUCATION_LEVELS, GRADE_FORMATS, GRADE_RANGES, SUBJECTS, ABOUT_MAX_CHARS, MAX_COUNTRIES, MAX_SUBJECTS } from "@/config/finder";
import type { EducationLevel, GradeFormat } from "@/config/finder";

const levelIds = EDUCATION_LEVELS.map((l) => l.id) as [EducationLevel, ...EducationLevel[]];
const formatIds = GRADE_FORMATS.map((f) => f.id) as [GradeFormat, ...GradeFormat[]];
const rangeIds = Object.values(GRADE_RANGES).flat().map((r) => r.id);
const subjectIds = SUBJECTS.map((s) => s.id);

/* ───────────────────────── Student answers ───────────────────────── */

export const answersSchema = z
  .object({
    education: z.object({
      level: z.enum(levelIds),
      otherText: z.string().trim().max(120).optional(),
    }),
    grade: z.object({
      format: z.enum(formatIds),
      choice: z.union([z.enum(rangeIds as [string, ...string[]]), z.literal("manual")]),
      manualValue: z.string().trim().max(60).optional(),
    }),
    subjects: z.object({
      ids: z.array(z.enum(subjectIds as [string, ...string[]])).max(MAX_SUBJECTS),
      otherText: z.string().trim().max(120).optional(),
    }),
    destinations: z.object({
      countries: z.array(z.string().trim().min(1).max(60)).max(MAX_COUNTRIES),
      openToSuggestions: z.boolean(),
      otherText: z.string().trim().max(120).optional(),
    }),
    about: z.string().trim().max(ABOUT_MAX_CHARS).optional(),
  })
  .refine((a) => a.grade.choice !== "manual" || Boolean(a.grade.manualValue), {
    message: "Enter your grade",
    path: ["grade", "manualValue"],
  })
  .refine((a) => a.subjects.ids.length > 0 || Boolean(a.subjects.otherText), {
    message: "Choose at least one subject",
    path: ["subjects"],
  })
  .refine(
    (a) => a.destinations.countries.length > 0 || a.destinations.openToSuggestions || Boolean(a.destinations.otherText),
    { message: "Choose a destination", path: ["destinations"] },
  );

export type FinderAnswers = z.infer<typeof answersSchema>;

/* ───────────────────────── AI result ───────────────────────── */

export const resultSchema = z.object({
  profileSummary: z.string(),
  profileHighlights: z.array(z.object({ label: z.string(), value: z.string() })),
  pathways: z.array(
    z.object({
      title: z.string(),
      studyLevel: z.string(),
      destination: z.string(),
      rationale: z.string(),
      whatToCheck: z.array(z.string()),
    }),
  ),
  universityExamples: z.array(
    z.object({
      name: z.string(),
      country: z.string(),
      why: z.string(),
      status: z.enum(["skolar_listed", "to_verify"]),
    }),
  ),
  considerations: z.array(z.string()),
  missingInformation: z.array(z.object({ question: z.string(), why: z.string() })),
  nextSteps: z.array(z.string()),
  relatedPlatformIds: z.array(z.string()),
  counsellorBrief: z.string(),
});

export type FinderResult = z.infer<typeof resultSchema>;

export interface FinderResponse {
  result: FinderResult;
  /** Short reference a counsellor can use to look the assessment up (when stored). */
  ref: string | null;
  generatedAt: string;
}

/**
 * JSON Schema sent to Grok (strict structured output). Kept by hand rather
 * than generated so the model sees the descriptions.
 */
const s = (description: string) => ({ type: "string", description });
const arr = (items: object, description: string, maxItems: number) => ({ type: "array", items, description, maxItems });

export const resultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "profileSummary",
    "profileHighlights",
    "pathways",
    "universityExamples",
    "considerations",
    "missingInformation",
    "nextSteps",
    "relatedPlatformIds",
    "counsellorBrief",
  ],
  properties: {
    profileSummary: s("2–3 sentences summarising the student's academic profile and goals, in second person."),
    profileHighlights: arr(
      {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: { label: s("Short label, e.g. 'Highest qualification'"), value: s("Short value") },
      },
      "3–5 key facts drawn only from the answers.",
      5,
    ),
    pathways: arr(
      {
        type: "object",
        additionalProperties: false,
        required: ["title", "studyLevel", "destination", "rationale", "whatToCheck"],
        properties: {
          title: s("Name of the study pathway, e.g. 'Bachelor's in Computer Engineering (taught in English)'"),
          studyLevel: s("e.g. Foundation year, Bachelor's, Master's, Single-cycle degree"),
          destination: s("Country or 'Several countries'"),
          rationale: s("Why this pathway fits the answers, 1–2 sentences."),
          whatToCheck: arr({ type: "string" }, "2–3 specific things to verify for this pathway.", 4),
        },
      },
      "2–4 realistic study pathways.",
      4,
    ),
    universityExamples: arr(
      {
        type: "object",
        additionalProperties: false,
        required: ["name", "country", "why", "status"],
        properties: {
          name: s("Official institution name. Only institutions you are certain exist."),
          country: s("Country"),
          why: s("One sentence on why it may be worth exploring. No fees, rankings or cut-offs."),
          status: { type: "string", enum: ["skolar_listed", "to_verify"] },
        },
      },
      "0–6 example institutions to explore. Empty if unsure.",
      6,
    ),
    considerations: arr({ type: "string" }, "2–5 important considerations, e.g. language, recognition, timelines, budget.", 5),
    missingInformation: arr(
      {
        type: "object",
        additionalProperties: false,
        required: ["question", "why"],
        properties: { question: s("A question a counsellor would ask"), why: s("Why it matters") },
      },
      "0–5 pieces of missing information.",
      5,
    ),
    nextSteps: arr({ type: "string" }, "3–5 concrete next steps, in order.", 5),
    relatedPlatformIds: arr({ type: "string" }, "IDs of relevant SKOLAR platforms from the provided list only.", 4),
    counsellorBrief: s("Neutral 2–3 sentence summary for a counsellor (max 350 characters). No names or contact details."),
  },
} as const;
