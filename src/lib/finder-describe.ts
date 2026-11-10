import { EDUCATION_LEVELS, GRADE_FORMATS, GRADE_RANGES, SUBJECTS } from "@/config/finder";
import type { FinderAnswers } from "./finder-schema";

/** Human-readable lines describing the student's answers. Shared by the prompt, the UI recap and WhatsApp. */
export function describeAnswers(a: FinderAnswers): { label: string; value: string }[] {
  const level = EDUCATION_LEVELS.find((l) => l.id === a.education.level)?.label ?? a.education.level;
  const format = GRADE_FORMATS.find((f) => f.id === a.grade.format)?.label ?? a.grade.format;
  const range = GRADE_RANGES[a.grade.format].find((r) => r.id === a.grade.choice)?.label;
  const subjects = a.subjects.ids.map((id) => SUBJECTS.find((s) => s.id === id)?.label ?? id);
  if (a.subjects.otherText) subjects.push(a.subjects.otherText);
  const places = [...a.destinations.countries];
  if (a.destinations.otherText) places.push(a.destinations.otherText);
  if (a.destinations.openToSuggestions) places.push("Open to suggestions");

  return [
    {
      label: "Highest education",
      value: a.education.level === "other" && a.education.otherText ? `Other: ${a.education.otherText}` : level,
    },
    {
      label: "Result",
      value: a.grade.choice === "manual" ? `${a.grade.manualValue} (${format})` : `${range} (${format})`,
    },
    { label: "Wants to study", value: subjects.join(", ") || "Not specified" },
    { label: "Preferred destination", value: places.join(", ") || "Not specified" },
  ];
}
