import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublishedCountry, listPublishedCountries } from "@/lib/countries";
import { getArticles } from "@/lib/content";
import { renderArticleMarkdown } from "@/studio/core/markdown";
import { SubPage } from "@/components/sections/SubPage";
import { WhatsAppLink } from "@/components/ui/WhatsAppLink";
import { ArrowLeft, ArrowUpRight, WhatsApp } from "@/components/ui/Icons";

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await listPublishedCountries()).filter((c) => c.active).map((c) => ({ slug: c.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const c = await getPublishedCountry(slug);
  if (!c) return { title: "Country not found" };
  return {
    title: `Study in ${c.name}`,
    description: c.shortDescription,
    alternates: { canonical: `/countries/${c.slug}` },
    openGraph: { title: `Study in ${c.name} with SKOLAR`, description: c.shortDescription, images: c.image ? [{ url: c.image.url, alt: c.image.alt }] : undefined },
    other: { "skolar-content-key": c.contentKey },
  };
}

export default async function CountryPage({ params }: Props) {
  const { slug } = await params;
  const c = await getPublishedCountry(slug);
  if (!c) notFound();
  const { html } = renderArticleMarkdown(c.introContent);
  const { items, source } = await getArticles(30);
  const related = source === "sample" ? [] : items.filter((a) => a.title.toLowerCase().includes(c.name.toLowerCase())).slice(0, 3);

  return (
    <SubPage>
      <article className="container-x">
        <nav aria-label="Breadcrumb" className="mb-6 text-[0.82rem] text-ink-faint">
          <Link href="/#skolar-group" className="inline-flex min-h-11 items-center gap-1.5 hover:text-navy-900">
            <ArrowLeft size={14} /> SKOLAR Group
          </Link>
        </nav>
        <header className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-end">
          <div>
            <p className="eyebrow text-gold-600">
              {c.flag ? <span aria-hidden className="mr-2">{c.flag}</span> : null}
              {c.focus ?? "Study abroad"}
            </p>
            <h1 className="display mt-4 text-[2.4rem] leading-[1.04] text-navy-900 sm:text-[3.4rem]">{c.cardTitle}</h1>
            <p className="mt-5 max-w-xl text-[1.08rem] leading-relaxed text-ink-soft">{c.shortDescription}</p>
            {c.platformUrl && (
              <a href={c.platformUrl} target="_blank" rel="noopener noreferrer" className="btn btn-navy mt-7">
                Visit SKOLAR {c.name} <ArrowUpRight size={16} />
              </a>
            )}
          </div>
          {c.image && (
            <figure>
              <div className="relative aspect-[4/3] overflow-hidden rounded-[20px] bg-stone">
                <Image src={c.image.url} alt={c.image.alt} fill priority sizes="(min-width: 1024px) 40vw, 100vw" className="object-cover" />
              </div>
              {c.image.credit && <figcaption className="mt-2 text-[0.75rem] text-ink-faint">{c.image.credit}{c.image.license ? ` (${c.image.license})` : ""}</figcaption>}
            </figure>
          )}
        </header>

        <div className="mt-14 grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            {c.introContent ? <div className="article-body" dangerouslySetInnerHTML={{ __html: html }} /> : null}

            {c.universities.length > 0 && (
              <section className="mt-12">
                <h2 className="display text-[1.7rem] text-navy-900">Universities</h2>
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {c.universities.map((u) => (
                    <li key={u.name}>
                      <a href={u.website} target="_blank" rel="noopener noreferrer" className="group flex h-full items-start justify-between gap-3 rounded-2xl border border-navy-900/10 bg-white p-4 hover:border-navy-900/30">
                        <span>
                          <span className="block font-semibold text-navy-900">{u.name}</span>
                          {u.city && <span className="text-[0.82rem] text-ink-faint">{u.city}</span>}
                        </span>
                        <ArrowUpRight size={16} className="mt-1 shrink-0 text-ink-faint" />
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[0.78rem] text-ink-faint">Links go to each university&apos;s official website. Listing a university does not imply a partnership with SKOLAR.</p>
              </section>
            )}

            {c.scholarships.length > 0 && (
              <section className="mt-12">
                <h2 className="display text-[1.7rem] text-navy-900">Regional scholarship bodies</h2>
                <ul className="mt-5 space-y-2">
                  {c.scholarships.map((s) => (
                    <li key={s.name}>
                      <a href={s.website} target="_blank" rel="noopener noreferrer" className="text-navy-900 underline decoration-navy-900/25 underline-offset-2">{s.organisation}</a>
                      <span className="text-[0.85rem] text-ink-faint"> — {s.name}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="space-y-6">
            {c.regions.length > 0 && (
              <div className="rounded-2xl bg-white p-5 ring-1 ring-navy-900/[0.07]">
                <p className="eyebrow text-ink-faint">Regions & cities</p>
                <ul className="mt-3 space-y-2 text-[0.9rem]">
                  {c.regions.map((r) => (
                    <li key={r.name}>
                      <strong className="text-navy-900">{r.name}</strong>
                      {r.cities.length > 0 && <span className="text-ink-soft"> · {r.cities.join(", ")}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {c.links.length > 0 && (
              <div className="rounded-2xl bg-white p-5 ring-1 ring-navy-900/[0.07]">
                <p className="eyebrow text-ink-faint">Useful links</p>
                <ul className="mt-3 space-y-2 text-[0.9rem]">
                  {c.links.map((l) => (
                    <li key={l.url}>
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="text-navy-900 underline decoration-navy-900/25 underline-offset-2">{l.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="rounded-2xl bg-navy-900 p-5 text-paper">
              <p className="display text-[1.3rem] leading-snug">Thinking about studying in {c.name}?</p>
              <WhatsAppLink message={`Hi SKOLAR, I'd like to talk about studying in ${c.name}.`} className="btn btn-gold mt-4 w-full">
                <WhatsApp size={18} /> Talk to SKOLAR
              </WhatsAppLink>
            </div>
          </aside>
        </div>

        {related.length > 0 && (
          <section className="mt-16 border-t border-navy-900 pt-6">
            <h2 className="display text-[1.7rem] text-navy-900">Insights about {c.name}</h2>
            <ul className="mt-6 grid gap-6 sm:grid-cols-3">
              {related.map((a) => (
                <li key={a.url}>
                  <Link href={a.url} className="group block">
                    <div className="img-zoom relative aspect-[4/3] overflow-hidden rounded-[16px] bg-stone">
                      <Image src={a.coverImageUrl} alt={a.coverImageAlt ?? ""} fill sizes="(min-width: 640px) 30vw, 100vw" className="object-cover" />
                    </div>
                    <p className="display mt-3 text-[1.2rem] leading-snug text-navy-900"><span className="u-link">{a.title}</span></p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </SubPage>
  );
}
