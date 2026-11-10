import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import { getDestinations } from "@/lib/content";

/** Shell for the few secondary pages (Insights archive, legal). */
export async function SubPage({ children }: { children: React.ReactNode }) {
  const destinations = await getDestinations();
  return (
    <>
      <SiteHeader initialTone="light" homeHref="/" />
      <main data-header-tone="light" className="min-h-[70vh] bg-paper pb-24 pt-32 lg:pt-40">
        {children}
      </main>
      <SiteFooter destinations={destinations.source === "firestore" ? destinations.items : []} />
    </>
  );
}
