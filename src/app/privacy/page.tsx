import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/sections/LegalPlaceholder";

export const metadata: Metadata = { title: "Privacy Policy", robots: { index: false } };

export default function PrivacyPage() {
  return <LegalPlaceholder title="Privacy Policy" />;
}
