import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getInsight, listFileInsights, type Insight } from "@/lib/insights";
import { getArticles } from "@/lib/content";
import { renderArticleMarkdown } from "@/studio/core/markdown";
import { formatDate } from "@/lib/format";
import { siteConfig } from "@/config/site";
import { SubPage } from "@/components/sections/SubPage";
import { WhatsAppLink } from "@/components/ui/WhatsAppLink";
import { ArrowLeft, ArrowUpRight, WhatsApp } from "@/components/ui/Icons";

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await listFileInsights()).map((i) => ({ slug: i.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const a = await getInsight(slug);
  if (!a) return { title: "Article not found" };
  return {
    title: a.seoTitle,
    description: a.metaDescription,
    alternates: { canonical: `/insights/${a.slug}` },
    openGraph: {
      type: "article",
      title: a.seoTitle,
      description: a.metaDescription,
      publishedTime: a.publishedAt,
      modifiedTime: a.updatedAt,
      images: a.coverImage ? [{ url: a.coverImage.url, alt: a.coverImage.alt }] : undefined,
    },
    // Lets SKOLAR Studio verify that exactly this version is live after publishing.
    other: a.contentKey ? { "skolar-content-key": a.contentKey } : undefined,
  };
}

const SOURCE_TYPE: Record<string, string> = {
  official_university: "Official university",
  government: "Government",
  scholarship_authority: "Scholarship authority",
  application_portal: "Official portal",
  publication: "Publication",
  other: "Other",
};

export default async function InsightPage({ params }: Props) {
  const { slug } = await params;
  const a = await getInsight(slug);
  if (!a) notFound();
  // The excerpt already introduces the article: drop a leading "Introduction" heading (keep its text).
  const { html, toc } = renderArticleMarkdown(a.body.replace(/^\s*##\s+introduction\s*\n+/i, ""));
  const related = await relatedArticles(a);
  const timeSensitive = Boolean(a.academicYear);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.metaDescription,
    datePublished: a.publishedAt,
    dateModified: a.updatedAt,
    image: a.coverImage ? [a.coverImage.url.startsWith("/") ? `${siteConfig.url}${a.coverImage.url}` : a.coverImage.url] : undefined,
    publisher: { "@type": "Organization", name: "SKOLAR", url: siteConfig.url },
    mainEntityOfPage: `${siteConfig.url}/insights/${a.slug}`,
    citation: a.sources.map((s) => s.url),
  };

  return (
    <SubPage>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <article className="container-x">
        <div className="mx-auto max-w-[44rem] lg:max-w-none">
          <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-[0.82rem] text-ink-faint">
            <Link href="/insights" className="inline-flex min-h-11 items-center gap-1.5 hover:text-navy-900">
              <ArrowLeft size={14} /> Insights
            </Link>
            <span aria-hidden>/</span>
            <span className="font-semibold uppercase tracking-[0.12em] text-gold-600">{a.categoryLabel}</span>
          </nav>

          <header className="lg:mx-auto lg:max-w-[50rem]">
            <h1 className="display text-[2.15rem] leading-[1.06] text-navy-900 sm:text-[3rem] lg:text-[3.6rem]">{a.title}</h1>
            {a.excerpt && <p className="mt-5 text-[1.08rem] leading-relaxed text-ink-soft sm:text-[1.2rem]">{a.excerpt}</p>}
            <p className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.82rem] text-ink-faint">
              <time dateTime={a.publishedAt}>{formatDate(a.publishedAt)}</time>
              <span aria-hidden>·</span>
              <span>{a.readingMinutes} min read</span>
              {a.academicYear && (
                <>
                  <span aria-hidden>·</span>
                  <span className="rounded-full bg-gold-100 px-2.5 py-0.5 font-semibold text-gold-600">Academic year {a.academicYear}</span>
                </>
              )}
            </p>
          </header>

          {a.coverImage && (
            <figure className="mt-8 lg:mx-auto lg:max-w-[60rem]">
              <div className="relative aspect-[16/10] overflow-hidden rounded-[18px] bg-stone">
                <Image src={a.coverImage.url} alt={a.coverImage.alt} fill priority sizes="(min-width: 1024px) 60rem, 100vw" className="object-cover" />
              </div>
              {(a.coverImage.caption || a.coverImage.credit) && (
                <figcaption className="mt-2.5 text-[0.78rem] leading-snug text-ink-faint">
                  {a.coverImage.caption}
                  {a.coverImage.credit && (
                    <>
                      {a.coverImage.caption ? " · " : ""}
                      {a.coverImage.sourceUrl ? (
                        <a href={a.coverImage.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                          {a.coverImage.credit}
                        </a>
                      ) : (
                        a.coverImage.credit
                      )}
                      {a.coverImage.license ? ` (${a.coverImage.license})` : ""}
                    </>
                  )}
                </figcaption>
              )}
            </figure>
          )}

          <div className="mt-10 lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-14 xl:mx-auto xl:max-w-[64rem]">
            <div className="min-w-0">
              {toc.length >= 3 && (
                <details className="mb-8 rounded-2xl border border-navy-900/10 bg-white/60 lg:hidden">
                  <summary className="flex min-h-12 cursor-pointer items-center px-4 text-[0.92rem] font-semibold text-navy-900">On this page</summary>
                  <TocList toc={toc} />
                </details>
              )}

              {timeSensitive && (
                <aside className="mb-8 rounded-2xl border border-gold-300 bg-gold-100/60 p-4 text-[0.9rem] leading-relaxed text-navy-900">
                  <strong>Academic year {a.academicYear}.</strong> Checked against official sources
                  {a.lastVerified ? ` on ${formatDate(a.lastVerified)}` : ""}. Requirements, fees and dates change every year — always confirm on
                  the official websites listed under Sources before you apply.
                </aside>
              )}

              <div className="article-body" dangerouslySetInnerHTML={{ __html: html }} />

              {a.cta && (
                <aside className="mt-12 rounded-[20px] bg-navy-900 p-6 text-paper sm:p-8">
                  <p className="eyebrow text-gold-300">SKOLAR</p>
                  <p className="display mt-3 text-[1.5rem] leading-snug sm:text-[1.8rem]">{a.cta.text}</p>
                  <WhatsAppLink message={`Hi SKOLAR, I just read "${a.title}" and would like to talk about my plans.`} className="btn btn-gold mt-6 w-full sm:w-auto">
                    <WhatsApp size={18} /> {a.cta.label}
                  </WhatsAppLink>
                  <p className="mt-4 text-[0.78rem] text-paper/60">SKOLAR does not guarantee admission, scholarships or visas.</p>
                </aside>
              )}

              {a.sources.length > 0 && (
                <section aria-labelledby="sources" className="mt-12 border-t border-navy-900/10 pt-8">
                  <h2 id="sources" className="display text-[1.6rem] text-navy-900">
                    Sources
                  </h2>
                  <ol className="mt-5 space-y-4">
                    {a.sources.map((s) => (
                      <li key={s.n} id={`source-${s.n}`} className="flex scroll-mt-24 gap-3 text-[0.9rem] leading-snug">
                        <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-stone text-[0.72rem] font-semibold text-navy-900">{s.n}</span>
                        <span className="min-w-0">
                          <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-words font-medium text-navy-900 underline decoration-navy-900/25 underline-offset-2 hover:decoration-navy-900">
                            {s.title}
                          </a>
                          <span className="mt-1 block text-[0.78rem] text-ink-faint">
                            {SOURCE_TYPE[s.type] ?? "Source"}
                            {s.publisher ? ` · ${s.publisher}` : ""}
                            {s.academicYear ? ` · ${s.academicYear}` : ""}
                            {s.accessedAt ? ` · accessed ${formatDate(s.accessedAt)}` : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>

            {toc.length >= 3 && (
              <aside className="hidden lg:block">
                <div className="sticky top-28">
                  <p className="eyebrow text-ink-faint">On this page</p>
                  <TocList toc={toc} />
                </div>
              </aside>
            )}
          </div>
        </div>
      </article>

      {related.length > 0 && (
        <section aria-labelledby="related" className="container-x mt-20">
          <h2 id="related" className="display border-t border-navy-900 pt-6 text-[1.8rem] text-navy-900">
            Keep reading
          </h2>
          <ul className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <li key={r.url}>
                <Link href={r.url} className="group block">
                  <div className="img-zoom relative aspect-[4/3] overflow-hidden rounded-[18px] bg-stone">
                    <Image src={r.coverImageUrl} alt={r.coverImageAlt ?? ""} fill sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw" className="object-cover" />
                  </div>
                  <p className="mt-4 text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-gold-600">{r.category}</p>
                  <h3 className="display mt-2 flex items-start gap-2 text-[1.35rem] leading-[1.15] text-navy-900">
                    <span className="u-link">{r.title}</span>
                    <ArrowUpRight size={16} className="link-arrow link-arrow-diag mt-1 shrink-0" />
                  </h3>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </SubPage>
  );
}

function TocList({ toc }: { toc: Array<{ id: string; text: string; level: number }> }) {
  return (
    <ol className="space-y-1 px-4 pb-4 pt-1 text-[0.88rem] lg:mt-3 lg:px-0">
      {toc.map((t) => (
        <li key={t.id} className={t.level === 3 ? "pl-4" : ""}>
          <a href={`#${t.id}`} className="block py-1.5 leading-snug text-ink-soft hover:text-navy-900">
            {t.text}
          </a>
        </li>
      ))}
    </ol>
  );
}

async function relatedArticles(a: Insight) {
  const { items, source } = await getArticles(30);
  if (source === "sample") return [];
  const others = items.filter((x) => x.url !== `/insights/${a.slug}`);
  const picked = a.relatedSlugs.map((s) => others.find((x) => x.url === `/insights/${s}`)).filter((x): x is NonNullable<typeof x> => Boolean(x));
  for (const x of others) {
    if (picked.length >= 3) break;
    if (!picked.includes(x) && x.category === a.categoryLabel) picked.push(x);
  }
  for (const x of others) {
    if (picked.length >= 3) break;
    if (!picked.includes(x)) picked.push(x);
  }
  return picked.slice(0, 3);
}
