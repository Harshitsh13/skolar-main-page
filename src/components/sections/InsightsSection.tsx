import Image from "next/image";
import type { Article, ContentResult } from "@/lib/types";
import { formatDate, isExternal } from "@/lib/format";
import { ArrowRight, ArrowUpRight } from "@/components/ui/Icons";
import { SampleBadge } from "@/components/ui/SampleBadge";

function Meta({ a }: { a: Article }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.78rem] text-ink-faint">
      <span className="font-semibold uppercase tracking-[0.12em] text-gold-600">{a.category}</span>
      <span aria-hidden>·</span>
      <time dateTime={a.publishedAt}>{formatDate(a.publishedAt)}</time>
      {a.readingMinutes ? (
        <>
          <span aria-hidden>·</span>
          <span>{a.readingMinutes} min read</span>
        </>
      ) : null}
    </p>
  );
}

export function articleLinkProps(a: Article) {
  return isExternal(a.url) ? { href: a.url, target: "_blank", rel: "noopener noreferrer" } : { href: a.url };
}

const delay = (ms: number) => ({ ["--reveal-delay" as string]: `${ms}ms` }) as React.CSSProperties;

/** Section 02: latest articles, laid out like the front page of a magazine. */
export function InsightsSection({ content }: { content: ContentResult<Article> }) {
  const [lead, second, third, ...rest] = content.items;

  return (
    <section id="insights" data-header-tone="light" className="relative bg-paper py-20 sm:py-24 lg:py-32">
      <div className="container-x">
        {/* Masthead */}
        <div className="flex flex-col gap-6 border-b border-navy-900 pb-6 md:flex-row md:items-end md:justify-between" data-reveal>
          <div>
            <p className="eyebrow flex flex-wrap items-center gap-3 text-ink-soft">
              Latest from SKOLAR {content.source === "sample" && <SampleBadge />}
            </p>
            <h2 className="display mt-4 text-[3rem] leading-none text-navy-900 sm:text-[4rem] lg:text-[5.2rem]">Insights</h2>
          </div>
          <div className="flex flex-col gap-4 md:items-end">
            <p className="max-w-xs text-[0.95rem] leading-relaxed text-ink-soft md:text-right">
              Practical guides on choosing, applying to and preparing for university abroad.
            </p>
            <a href="/insights" className="group inline-flex items-center gap-2 text-[0.92rem] font-semibold text-navy-900">
              <span className="u-link">View All Insights</span> <ArrowRight size={16} className="link-arrow" />
            </a>
          </div>
        </div>

        {!lead ? (
          <div className="grid place-items-center py-24 text-center" data-reveal>
            <p className="display text-[1.8rem] text-navy-900">The first SKOLAR Insights are on their way.</p>
            <p className="mt-3 max-w-md text-ink-soft">Meanwhile, the University Finder above can help you explore your options.</p>
          </div>
        ) : (
          <div className="mt-10 grid gap-x-10 gap-y-12 lg:mt-12 lg:grid-cols-12">
            {/* Lead story */}
            <a {...articleLinkProps(lead)} className="group lg:col-span-7" data-reveal>
              <div className="img-zoom relative aspect-[4/3] overflow-hidden rounded-[20px] bg-stone sm:aspect-[16/11]">
                <Image src={lead.coverImageUrl} alt={lead.coverImageAlt ?? ""} fill sizes="(min-width: 1024px) 56vw, 100vw" className="object-cover" />
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-[1fr_auto] md:gap-10">
                <div>
                  <Meta a={lead} />
                  <h3 className="display mt-3 text-[2rem] leading-[1.08] text-navy-900 sm:text-[2.5rem]">
                    <span className="u-link">{lead.title}</span>
                  </h3>
                  <p className="mt-4 max-w-xl text-[1.02rem] leading-relaxed text-ink-soft">{lead.excerpt}</p>
                </div>
                <span className="hidden h-12 w-12 place-items-center rounded-full border border-navy-900/15 text-navy-900 transition-colors duration-300 group-hover:border-navy-900 group-hover:bg-navy-900 group-hover:text-paper md:grid">
                  <ArrowUpRight size={18} />
                </span>
              </div>
            </a>

            {/* Secondary stories: one image-led, one type-led */}
            <div className="flex flex-col gap-10 lg:col-span-5 lg:border-l lg:border-navy-900/10 lg:pl-10">
              {second && (
                <a {...articleLinkProps(second)} className="group grid gap-5 sm:grid-cols-[1fr_1.1fr] lg:grid-cols-1" data-reveal style={delay(120)}>
                  <div className="img-zoom relative aspect-[4/3] overflow-hidden rounded-[18px] bg-stone lg:aspect-[16/10]">
                    <Image
                      src={second.coverImageUrl}
                      alt={second.coverImageAlt ?? ""}
                      fill
                      sizes="(min-width: 1024px) 34vw, (min-width: 640px) 45vw, 100vw"
                      className="object-cover"
                    />
                  </div>
                  <div>
                    <Meta a={second} />
                    <h3 className="display mt-2.5 text-[1.5rem] leading-[1.15] text-navy-900 sm:text-[1.65rem]">
                      <span className="u-link">{second.title}</span>
                    </h3>
                    <p className="mt-2.5 line-clamp-2 text-[0.95rem] leading-relaxed text-ink-soft">{second.excerpt}</p>
                  </div>
                </a>
              )}
              {third && (
                <a
                  {...articleLinkProps(third)}
                  className="group relative flex gap-5 rounded-[18px] bg-stone/70 p-5 transition-colors duration-300 hover:bg-stone sm:p-6"
                  data-reveal
                  style={delay(220)}
                >
                  <div className="min-w-0 flex-1">
                    <Meta a={third} />
                    <h3 className="display mt-2.5 text-[1.35rem] leading-[1.18] text-navy-900">
                      <span className="u-link">{third.title}</span>
                    </h3>
                  </div>
                  <div className="img-zoom relative h-24 w-24 shrink-0 overflow-hidden rounded-xl sm:h-28 sm:w-28">
                    <Image src={third.coverImageUrl} alt={third.coverImageAlt ?? ""} fill sizes="112px" className="object-cover" />
                  </div>
                </a>
              )}
            </div>

            {/* Further reading: a quiet typographic index */}
            {rest.length > 0 && (
              <div className="lg:col-span-12" data-reveal>
                <p className="eyebrow mb-1 text-ink-faint">Also in Insights</p>
                <ul className="grid border-t border-navy-900/10 md:grid-cols-2 md:gap-x-10">
                  {rest.slice(0, 4).map((a, i) => (
                    <li key={a.id} className="border-b border-navy-900/10">
                      <a {...articleLinkProps(a)} className="group flex items-baseline gap-5 py-5">
                        <span className="display text-[1.1rem] tabular-nums text-gold-600">{String(i + 4).padStart(2, "0")}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[1.05rem] font-medium leading-snug text-navy-900">
                            <span className="u-link">{a.title}</span>
                          </span>
                          <span className="mt-1 block text-[0.8rem] text-ink-faint">
                            {a.category} · {formatDate(a.publishedAt)}
                          </span>
                        </span>
                        <ArrowRight size={16} className="link-arrow shrink-0 text-ink-faint" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
