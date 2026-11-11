import type { FinderAnswers, UniversityRecommendation } from "@/lib/finder-schema";
import { describeAnswers } from "@/lib/finder-describe";

/**
 * The pre-filled WhatsApp message. Details are included by default on the
 * counsellor hand-off so the counsellor receives the student's profile,
 * shortlisted courses, and summary, while remaining editable before sending.
 */
export function buildWhatsAppMessage({
  answers,
  includeDetails,
  brief,
  recommendations,
  focusRecommendation,
  reference,
}: {
  answers: FinderAnswers;
  includeDetails: boolean;
  brief?: string;
  recommendations?: UniversityRecommendation[];
  focusRecommendation?: UniversityRecommendation;
  reference?: string | null;
}): string {
  const intro = focusRecommendation
    ? `Hi SKOLAR, I'd like to discuss ${focusRecommendation.courseTitle} at ${focusRecommendation.universityName} (${focusRecommendation.country}) with a counsellor.`
    : "Hi SKOLAR, I've just used the University Finder on your website and I want to discuss this with a counsellor.";
  if (!includeDetails) return intro;

  const lines = describeAnswers(answers).map((l) => `• ${l.label}: ${l.value}`);
  const parts = [intro, "", "My profile:", ...lines];

  if (!focusRecommendation && recommendations && recommendations.length > 0) {
    const topPicks = recommendations
      .slice(0, 4)
      .map((u) => `• ${u.universityName} (${u.country}) — ${u.courseTitle} [${u.entryRoute}]`);
    parts.push("", "Options from my report:", ...topPicks);
  }

  if (brief) parts.push("", `Summary: ${brief}`);
  if (reference) parts.push("", `Reference: ${reference}`);
  return parts.join("\n");
}
