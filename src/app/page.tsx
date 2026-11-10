import { getArticles, getDestinations } from "@/lib/content";
import { SiteHeader } from "@/components/sections/SiteHeader";
import { FinderSection } from "@/components/sections/FinderSection";
import { InsightsSection } from "@/components/sections/InsightsSection";
import { ServicesSection } from "@/components/sections/ServicesSection";
import { GroupSection } from "@/components/sections/GroupSection";
import { ContactSection } from "@/components/sections/ContactSection";
import { SiteFooter } from "@/components/sections/SiteFooter";
import { RevealObserver } from "@/components/ui/Reveal";
import { siteConfig } from "@/config/site";

/** Content is refreshed every 5 minutes, or immediately via /api/revalidate. */
export const revalidate = 300;

export default async function HomePage() {
  const [articles, destinations] = await Promise.all([getArticles(6), getDestinations()]);

  const platforms = destinations.items.map((d) => ({
    id: d.id,
    title: d.title,
    countryName: d.countryName,
    url: d.url,
    imageUrl: d.imageUrl,
  }));

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: "SKOLAR",
    url: siteConfig.url,
    logo: `${siteConfig.url}/brand/skolar-logo-on-light.png`,
    ...(siteConfig.social.length && { sameAs: siteConfig.social.map((s) => s.href) }),
  };

  return (
    <>
      <SiteHeader />
      <main>
        <FinderSection platforms={platforms} />
        <InsightsSection content={articles} />
        <ServicesSection />
        <GroupSection content={destinations} />
        <ContactSection />
      </main>
      <SiteFooter destinations={destinations.items} />
      <RevealObserver />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
