import Image from "next/image";
import type { ContentResult, Destination } from "@/lib/types";
import { ArrowUpRight } from "@/components/ui/Icons";
import { SampleBadge } from "@/components/ui/SampleBadge";
import { DestinationRail } from "./DestinationRail";

const host = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
};

function DestinationCard({ d, large }: { d: Destination; large: boolean }) {
  // A country with its own page on this site links there; otherwise to its external platform.
  const internal = Boolean(d.pageUrl) || d.url.startsWith("/");
  const href = d.pageUrl ?? d.url;
  return (
    <a
      href={href}
      {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
      className="group relative flex h-full flex-col overflow-hidden rounded-[24px] bg-navy-800 text-paper ring-1 ring-white/10"
      aria-label={internal ? `${d.title}: about studying in ${d.countryName ?? ""} with SKOLAR` : `${d.title}: opens the ${d.countryName ?? ""} SKOLAR platform in a new tab`}
    >
      <div className={`img-zoom relative w-full overflow-hidden ${large ? "aspect-[4/3.6] sm:aspect-[16/12]" : "aspect-[4/4.2]"}`}>
        <Image
          src={d.imageUrl}
          alt={d.imageAlt ?? ""}
          fill
          sizes={large ? "(min-width: 1024px) 46vw, (min-width: 640px) 50vw, 90vw" : "(min-width: 1024px) 30vw, 80vw"}
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-navy-800 via-navy-800/20 to-navy-950/30" />
        {/* Consistent SKOLAR lockup across every destination */}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-5 sm:p-6">
          <span className="rounded-full bg-navy-950/55 px-3 py-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.16em] backdrop-blur-md">
            {d.flag && <span aria-hidden className="mr-1.5">{d.flag}</span>}SKOLAR <span className="text-gold-300">{d.countryName ? `· ${d.countryName}` : ""}</span>
          </span>
          {d.isSample && <SampleBadge>Sample</SampleBadge>}
        </div>
      </div>
      <div className="relative -mt-16 flex flex-1 flex-col p-6 pt-0 sm:p-8 sm:pt-0">
        {d.category && <p className="eyebrow text-gold-300">{d.category}</p>}
        <h3 className={`display mt-3 ${large ? "text-[1.9rem] sm:text-[2.3rem]" : "text-[1.7rem]"} leading-[1.08]`}>{d.title}</h3>
        <p className="mb-7 mt-3 max-w-lg text-[0.97rem] leading-relaxed text-paper/65">{d.description}</p>
        <div className="mt-auto flex items-center justify-between gap-4 border-t border-white/10 pt-5">
          <span className="text-[0.95rem] font-semibold">{d.ctaLabel || "Explore Platform"}</span>
          <span className="flex items-center gap-3 text-[0.8rem] text-paper/45">
            <span className="hidden sm:inline">{internal ? "skolar" : host(d.url)}</span>
            <span className="grid h-10 w-10 place-items-center rounded-full bg-paper text-navy-900 transition-colors duration-300 group-hover:bg-gold-400">
              <ArrowUpRight size={18} className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </span>
          </span>
        </div>
      </div>
    </a>
  );
}

/** Section 04: the SKOLAR Group. Destination platforms are managed from the SKOLAR Control Center. */
export function GroupSection({ content }: { content: ContentResult<Destination> }) {
  const items = content.items;
  const few = items.length <= 2;

  return (
    <section id="skolar-group" data-header-tone="dark" className="grain relative overflow-hidden bg-navy-900 py-20 text-paper sm:py-24 lg:py-32">
      <div className="container-x">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-7" data-reveal>
            <p className="eyebrow flex flex-wrap items-center gap-3 text-gold-300">
              <span className="h-px w-8 bg-gold-500" /> The SKOLAR Group
            </p>
            <h2 className="display mt-5 text-[2.4rem] sm:text-[3rem] lg:text-[3.5rem]">
              One SKOLAR. A dedicated platform for each destination.
            </h2>
          </div>
          <p className="max-w-md text-[1.02rem] leading-relaxed text-paper/65 lg:col-span-5 lg:justify-self-end" data-reveal>
            Each SKOLAR platform focuses on one country: its universities, admissions and student life, with the same SKOLAR
            guidance behind it.
          </p>
        </div>

        <div className="mt-12 lg:mt-16">
          {items.length === 0 ? (
            <p className="rounded-[24px] border border-dashed border-white/15 p-10 text-center text-paper/60">
              SKOLAR destination platforms will appear here.
            </p>
          ) : few ? (
            <div className={`grid gap-5 ${items.length === 2 ? "md:grid-cols-2" : "max-w-3xl"}`}>
              {items.map((d, i) => (
                <div key={d.id} data-reveal style={{ ["--reveal-delay" as string]: `${i * 120}ms` } as React.CSSProperties}>
                  <DestinationCard d={d} large />
                </div>
              ))}
            </div>
          ) : (
            <DestinationRail count={items.length}>
              {items.map((d) => (
                <div key={d.id} className="w-[82vw] max-w-[420px] shrink-0 snap-start sm:w-[46vw] lg:w-[calc((100%-2.5rem)/3)]">
                  <DestinationCard d={d} large={false} />
                </div>
              ))}
            </DestinationRail>
          )}
        </div>
      </div>
    </section>
  );
}
