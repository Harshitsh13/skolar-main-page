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

export const ENTRY_ROUTES = [
  "Direct Entry",
  "Foundation + Degree",
  "International Year One",
  "Postgraduate",
  "Diploma / Pathway",
] as const;

export const FIT_TIERS = ["Strong Match", "Good Match", "Foundation Route", "Aspirational"] as const;

export const resultSchema = z.object({
  profileSummary: z.string(),
  profileHighlights: z.array(z.object({ label: z.string(), value: z.string() })),
  universityRecommendations: z.array(
    z.object({
      universityName: z.string(),
      country: z.string(),
      courseTitle: z.string(),
      entryRoute: z.enum(ENTRY_ROUTES),
      fitTier: z.enum(FIT_TIERS),
      whyItFits: z.string(),
      requirementsToCheck: z.array(z.string()),
      status: z.enum(["skolar_listed", "to_verify"]),
    }),
  ),
  pathways: z.array(
    z.object({
      title: z.string(),
      studyLevel: z.string(),
      destination: z.string(),
      rationale: z.string(),
      whatToCheck: z.array(z.string()),
    }),
  ),
  considerations: z.array(z.string()),
  missingInformation: z.array(z.object({ question: z.string(), why: z.string() })),
  nextSteps: z.array(z.string()),
  relatedPlatformIds: z.array(z.string()),
  counsellorBrief: z.string(),
});

export type FinderResult = z.infer<typeof resultSchema>;
export type UniversityRecommendation = FinderResult["universityRecommendations"][number];

export interface FinderResponse {
  result: FinderResult;
  /** Short reference a counsellor can use to look the assessment up (when stored). */
  ref: string | null;
  generatedAt: string;
}

/**
 * JSON Schema sent to the AI model (strict structured output). Kept by hand
 * rather than generated so the model sees the descriptions.
 */
const s = (description: string) => ({ type: "string", description });
const arr = (items: object, description: string, maxItems: number) => ({ type: "array", items, description, maxItems });

export const resultJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "profileSummary",
    "profileHighlights",
    "universityRecommendations",
    "pathways",
    "considerations",
    "missingInformation",
    "nextSteps",
    "relatedPlatformIds",
    "counsellorBrief",
  ],
  properties: {
    profileSummary: s(
      "2–3 sentences in second person giving an honest, realistic view of how the student's grades and qualification position them in their target destinations.",
    ),
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
    universityRecommendations: arr(
      {
        type: "object",
        additionalProperties: false,
        required: [
          "universityName",
          "country",
          "courseTitle",
          "entryRoute",
          "fitTier",
          "whyItFits",
          "requirementsToCheck",
          "status",
        ],
        properties: {
          universityName: s(
            "Official name of a real university realistically aligned with the student's grade band and entry route.",
          ),
          country: s("Country"),
          courseTitle: s(
            "Specific degree or pathway course title, e.g. 'BA (Hons) History & Politics' or 'International Foundation Year in Humanities -> BA Sociology'.",
          ),
          entryRoute: { type: "string", enum: [...ENTRY_ROUTES] },
          fitTier: { type: "string", enum: [...FIT_TIERS] },
          whyItFits: s(
            "1–2 specific sentences explaining why this university and course fit the student's grades, subjects, and goals. No fake fees or cut-offs.",
          ),
          requirementsToCheck: arr(
            { type: "string" },
            "2–3 concrete admission items to verify (e.g. English test, portfolio, foundation progression, credential evaluation).",
            3,
          ),
          status: { type: "string", enum: ["skolar_listed", "to_verify"] },
        },
      },
      "4–6 realistic university + course matches calibrated to the student's grade band.",
      6,
    ),
    pathways: arr(
      {
        type: "object",
        additionalProperties: false,
        required: ["title", "studyLevel", "destination", "rationale", "whatToCheck"],
        properties: {
          title: s("Name of the study pathway, e.g. 'International Foundation Year + BA Degree'"),
          studyLevel: s("e.g. Foundation year then Bachelor's, Direct Bachelor's, Master's"),
          destination: s("Country or 'Several countries'"),
          rationale: s("Why this route works for the student's qualification and grade level, 1–2 sentences."),
          whatToCheck: arr({ type: "string" }, "2–3 specific things to verify for this pathway.", 3),
        },
      },
      "2–3 realistic study pathways comparing direct vs foundation/bridging routes where relevant.",
      3,
    ),
    considerations: arr({ type: "string" }, "3–5 practical considerations (language, qualification recognition, finances, timelines).", 5),
    missingInformation: arr(
      {
        type: "object",
        additionalProperties: false,
        required: ["question", "why"],
        properties: {
          question: s("A focused question a SKOLAR counsellor will ask to narrow their shortlist"),
          why: s("Why knowing this unlocks better course/scholarship matches"),
        },
      },
      "3–4 key pieces of missing information.",
      4,
    ),
    nextSteps: arr({ type: "string" }, "4–5 concrete, action-oriented next steps including counsellor review.", 5),
    relatedPlatformIds: arr({ type: "string" }, "IDs of relevant SKOLAR platforms from the provided list only.", 4),
    counsellorBrief: s("Neutral 2–3 sentence summary for a SKOLAR counsellor (max 350 characters). No names or contact details."),
  },
} as const;
