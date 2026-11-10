import { SubPage } from "./SubPage";

/**
 * Placeholder for legal pages. The real text must come from SKOLAR. It is
 * deliberately not invented here. Replace this component's usage with the
 * approved policy content before launch.
 */
export function LegalPlaceholder({ title }: { title: string }) {
  return (
    <SubPage>
      <div className="container-x max-w-3xl">
        <p className="eyebrow text-ink-soft">SKOLAR</p>
        <h1 className="display mt-4 text-[2.8rem] text-navy-900 sm:text-[3.6rem]">{title}</h1>
        <div className="mt-10 rounded-2xl border border-dashed border-gold-500/60 bg-gold-100/50 p-6 text-navy-700">
          <p className="font-semibold">This page is being prepared.</p>
          <p className="mt-2 text-[0.95rem] leading-relaxed">
            SKOLAR&rsquo;s {title.toLowerCase()} will be published here. For questions in the meantime, please contact us
            through the options on the homepage.
          </p>
        </div>
      </div>
    </SubPage>
  );
}
