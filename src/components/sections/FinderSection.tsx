import { Finder, type PlatformLink } from "@/components/finder/Finder";

/** Section 01: the University Finder, which is the first thing every visitor sees. */
export function FinderSection({ platforms }: { platforms: PlatformLink[] }) {
  return (
    <section
      id="finder"
      data-header-tone="dark"
      aria-label="SKOLAR AI University Finder"
      className="grain relative isolate overflow-hidden bg-navy-900 pb-16 pt-28 sm:pt-32 lg:pb-24 lg:pt-36"
    >
      {/* Horizon arc from the SKOLAR mark: a quiet nod, not decoration */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -bottom-[38vw] left-1/2 -z-10 w-[160vw] max-w-none -translate-x-1/2 text-white lg:-bottom-[30vw] lg:w-[120vw]"
        viewBox="0 0 1600 800"
        fill="none"
      >
        <ellipse cx="800" cy="800" rx="790" ry="560" stroke="currentColor" strokeOpacity="0.07" />
        <ellipse cx="800" cy="800" rx="640" ry="452" stroke="currentColor" strokeOpacity="0.045" />
        <ellipse
          cx="800"
          cy="800"
          rx="790"
          ry="560"
          stroke="var(--color-gold-500)"
          strokeOpacity="0.35"
          strokeDasharray="1 9"
          strokeLinecap="round"
          transform="rotate(-4 800 800)"
        />
      </svg>
      <div className="pointer-events-none absolute -left-40 -top-40 -z-10 h-[520px] w-[520px] rounded-full bg-gold-500/[0.06] blur-3xl" aria-hidden />
      <div className="container-x">
        <Finder platforms={platforms} />
      </div>
    </section>
  );
}
