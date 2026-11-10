import type { FinderAnswers } from "@/lib/finder-schema";
import { describeAnswers } from "@/lib/finder-describe";

/**
 * The pre-filled WhatsApp message. Details are only included when the student
 * opts in, and they review and send it themselves in WhatsApp.
 */
export function buildWhatsAppMessage({
  answers,
  includeDetails,
  brief,
  reference,
}: {
  answers: FinderAnswers;
  includeDetails: boolean;
  brief?: string;
  reference?: string | null;
}): string {
  const intro =
    "Hi SKOLAR, I've just used the University Finder on your website and I want to discuss this with a counsellor.";
  if (!includeDetails) return intro;

  const lines = describeAnswers(answers).map((l) => `• ${l.label}: ${l.value}`);
  const parts = [intro, "", "My answers:", ...lines];
  if (brief) parts.push("", `Summary: ${brief}`);
  if (reference) parts.push("", `Reference: ${reference}`);
  return parts.join("\n");
}
