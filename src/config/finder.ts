/**
 * SKOLAR AI University Finder — question configuration.
 * Edit labels/options here; the questionnaire UI, the API validation and the
 * AI prompt all read from this file.
 */

export type EducationLevel = "class10" | "class12" | "diploma" | "bachelors" | "masters" | "other";
export type GradeFormat = "percentage" | "cgpa10" | "gpa4" | "other";

export const EDUCATION_LEVELS: { id: EducationLevel; label: string; hint: string }[] = [
  { id: "class10", label: "Class 10", hint: "Secondary school" },
  { id: "class12", label: "Class 12", hint: "Higher secondary / high school" },
  { id: "diploma", label: "Diploma", hint: "Polytechnic or vocational diploma" },
  { id: "bachelors", label: "Bachelor's degree", hint: "Undergraduate degree" },
  { id: "masters", label: "Master's degree", hint: "Postgraduate degree" },
  { id: "other", label: "Other", hint: "Tell us what you completed" },
];

export const GRADE_FORMATS: { id: GradeFormat; label: string; short: string }[] = [
  { id: "percentage", label: "Percentage", short: "%" },
  { id: "cgpa10", label: "CGPA (out of 10)", short: "CGPA" },
  { id: "gpa4", label: "GPA (out of 4)", short: "GPA" },
  { id: "other", label: "Other system", short: "Other" },
];

export const GRADE_RANGES: Record<GradeFormat, { id: string; label: string; detail: string }[]> = {
  percentage: [
    { id: "pct-85", label: "85% and above", detail: "Strong result" },
    { id: "pct-70", label: "70% – 84%", detail: "Good result" },
    { id: "pct-below70", label: "Below 70%", detail: "We'll look at all options" },
  ],
  cgpa10: [
    { id: "cgpa-85", label: "8.5 – 10", detail: "On a 10-point scale" },
    { id: "cgpa-70", label: "7.0 – 8.4", detail: "On a 10-point scale" },
    { id: "cgpa-below70", label: "Below 7.0", detail: "On a 10-point scale" },
  ],
  gpa4: [
    { id: "gpa-35", label: "3.5 – 4.0", detail: "On a 4-point scale" },
    { id: "gpa-30", label: "3.0 – 3.4", detail: "On a 4-point scale" },
    { id: "gpa-below30", label: "Below 3.0", detail: "On a 4-point scale" },
  ],
  other: [
    { id: "oth-top", label: "Top grades", detail: "e.g. A / First class / Distinction" },
    { id: "oth-good", label: "Good grades", detail: "e.g. B / Second class upper" },
    { id: "oth-pass", label: "Pass grades", detail: "e.g. C / Pass" },
  ],
};

/** Which grading format to suggest first for each education level. */
export const DEFAULT_GRADE_FORMAT: Record<EducationLevel, GradeFormat> = {
  class10: "percentage",
  class12: "percentage",
  diploma: "percentage",
  bachelors: "cgpa10",
  masters: "cgpa10",
  other: "percentage",
};

/** Question 2 wording adapts to the education level chosen in question 1. */
export function gradeQuestionContext(level: EducationLevel | null): string {
  switch (level) {
    case "class10":
      return "Your overall Class 10 result.";
    case "class12":
      return "Your overall Class 12 result (or your expected result if you're still waiting).";
    case "diploma":
      return "Your overall diploma result.";
    case "bachelors":
      return "Your bachelor's result: percentage, CGPA or the grade on your transcript.";
    case "masters":
      return "Your master's result: percentage, CGPA or the grade on your transcript.";
    default:
      return "Your most recent overall result, in whatever format your institution uses.";
  }
}

export const SUBJECTS: { id: string; label: string }[] = [
  { id: "medicine", label: "Medicine & Health Sciences" },
  { id: "engineering", label: "Engineering" },
  { id: "computing", label: "Computer Science & Data" },
  { id: "business", label: "Business & Management" },
  { id: "economics", label: "Economics & Finance" },
  { id: "law", label: "Law & Political Science" },
  { id: "architecture", label: "Architecture & Design" },
  { id: "sciences", label: "Natural Sciences" },
  { id: "humanities", label: "Humanities & Social Sciences" },
  { id: "arts", label: "Arts, Media & Communication" },
  { id: "hospitality", label: "Hospitality & Tourism" },
  { id: "undecided", label: "Not sure yet" },
];

/**
 * Destinations a student can choose from. Countries that have a published
 * SKOLAR platform (siteDestinations in Firestore) are merged in automatically,
 * so adding a platform in the admin also adds it here.
 */
export const FINDER_COUNTRIES: string[] = [
  "Italy",
  "Mongolia",
  "Germany",
  "France",
  "Ireland",
  "Netherlands",
  "Spain",
  "United Kingdom",
  "Canada",
  "Australia",
  "United States",
];

export const MAX_SUBJECTS = 3;
export const MAX_COUNTRIES = 3;
export const ABOUT_MAX_CHARS = 1200;

export const ABOUT_PROMPTS = [
  "The career I'm aiming for is…",
  "My budget for tuition and living costs is around…",
  "I'm hoping to start in…",
  "My English test status is…",
  "Something important about my situation is…",
];
