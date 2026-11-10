import Image from "next/image";
import type { Metadata } from "next";
import { getArticles } from "@/lib/content";
import { formatDate } from "@/lib/format";
import { SubPage } from "@/components/sections/SubPage";
import { SampleBadge } from "@/components/ui/SampleBadge";
import { articleLinkProps } from "@/components/sections/InsightsSection";

export const revalidate = 300;
export const metadata: Metadata = {
  title: "Insights",
  description: "Practical guides from SKOLAR on choosing, applying to and preparing for university abroad.",
};

export default async function InsightsIndex() {
  const { items, source } = await getArticles(60);

  return (
    <SubPage>
      <div className="container-x">
        <header className="border-b border-navy-900 pb-6">
          <p className="eyebrow flex items-center gap-3 text-ink-soft">
            SKOLAR {source === "sample" && <SampleBadge />}
          </p>
          <h1 className="display mt-4 text-[3.2rem] leading-none text-navy-900 sm:text-[5rem]">Insights</h1>
          <p className="mt-5 max-w-lg text-ink-soft">
            Practical guides on choosing, applying to and preparing for university abroad.
          </p>
        </header>

        {items.length === 0 ? (
          <p className="display py-24 text-center text-[1.8rem] text-navy-900">The first SKOLAR Insights are on their way.</p>
        ) : (
          <ul className="mt-12 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => (
              <li key={a.id}>
                <a {...articleLinkProps(a)} className="group block">
                  <div className="img-zoom relative aspect-[4/3] overflow-hidden rounded-[18px] bg-stone">
                    <Image src={a.coverImageUrl} alt={a.coverImageAlt ?? ""} fill sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw" className="object-cover" />
                  </div>
                  <p className="mt-5 text-[0.78rem] text-ink-faint">
                    <span className="font-semibold uppercase tracking-[0.12em] text-gold-600">{a.category}</span> ·{" "}
                    {formatDate(a.publishedAt)}
                    {a.readingMinutes ? ` · ${a.readingMinutes} min read` : ""}
                  </p>
                  <h2 className="display mt-2.5 text-[1.5rem] leading-[1.15] text-navy-900">
                    <span className="u-link">{a.title}</span>
                  </h2>
                  <p className="mt-2.5 line-clamp-3 text-[0.95rem] leading-relaxed text-ink-soft">{a.excerpt}</p>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SubPage>
  );
}
