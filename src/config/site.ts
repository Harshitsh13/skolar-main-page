/**
 * Site-wide configuration. Every contact detail comes from environment
 * variables — nothing is hardcoded, so nothing can be invented. Anything left
 * blank simply doesn't render.
 */
const env = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export const siteConfig = {
  name: "SKOLAR",
  url: env(process.env.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000",
  description:
    "Explore universities that match your academic profile with the SKOLAR AI University Finder, read practical study-abroad guidance, and talk to a SKOLAR counsellor.",
  whatsappNumber: env(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER)?.replace(/\D/g, "") ?? null,
  contact: {
    email: env(process.env.NEXT_PUBLIC_CONTACT_EMAIL),
    phone: env(process.env.NEXT_PUBLIC_CONTACT_PHONE),
    address: env(process.env.NEXT_PUBLIC_CONTACT_ADDRESS),
  },
  social: [
    { label: "Instagram", href: env(process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM) },
    { label: "LinkedIn", href: env(process.env.NEXT_PUBLIC_SOCIAL_LINKEDIN) },
    { label: "Facebook", href: env(process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK) },
    { label: "YouTube", href: env(process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE) },
  ].filter((s): s is { label: string; href: string } => Boolean(s.href)),
  showSampleContent:
    process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_SHOW_SAMPLE_CONTENT === "true",
} as const;

export const navLinks = [
  { href: "#finder", label: "University Finder" },
  { href: "#insights", label: "Insights" },
  { href: "#what-we-do", label: "What We Do" },
  { href: "#skolar-group", label: "SKOLAR Group" },
  { href: "#contact", label: "Contact" },
] as const;

/** Builds a wa.me click-to-chat link, or null when no official number is configured. */
export function whatsappLink(message?: string): string | null {
  if (!siteConfig.whatsappNumber) return null;
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${siteConfig.whatsappNumber}${text}`;
}

export const DEFAULT_WHATSAPP_MESSAGE =
  "Hi SKOLAR, I'd like to talk to a counsellor about studying abroad.";
