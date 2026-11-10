import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/sections/LegalPlaceholder";

export const metadata: Metadata = { title: "Terms & Conditions", robots: { index: false } };

export default function TermsPage() {
  return <LegalPlaceholder title="Terms and Conditions" />;
}
