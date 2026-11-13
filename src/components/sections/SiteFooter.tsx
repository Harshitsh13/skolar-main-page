import { Logo } from "@/components/ui/Logo";
import { navLinks, siteConfig } from "@/config/site";
import { imageCredits } from "@/content/credits";
import type { Destination } from "@/lib/types";
import { WhatsAppLink } from "@/components/ui/WhatsAppLink";
import { ArrowUpRight } from "@/components/ui/Icons";

export function SiteFooter({ destinations }: { destinations: Destination[] }) {
  const { email, phone, address } = siteConfig.contact;
  const year = new Date().getFullYear();

  return (
    <footer data-header-tone="dark" className="bg-navy-950 text-paper">
      <div className="container-x py-16 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <Logo tone="dark" height={104} />
            <p className="mt-6 max-w-xs text-[0.95rem] leading-relaxed text-paper/55">
              SKOLAR is an international education brand helping students discover, apply to and prepare for university
              abroad.
            </p>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:col-span-8">
            <div>
              <h3 className="eyebrow text-paper/40">Explore</h3>
              <ul className="mt-5 space-y-3">
                {navLinks.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} className="text-[0.95rem] text-paper/80 transition-colors hover:text-paper">
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {destinations.length > 0 && (
              <div>
                <h3 className="eyebrow text-paper/40">SKOLAR platforms</h3>
                <ul className="mt-5 space-y-3">
                  {destinations.map((d) => (
                    <li key={d.id}>
                      <a
                        href={d.pageUrl ?? d.url}
                        {...(d.pageUrl || d.url.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
                        className="group inline-flex items-center gap-1.5 text-[0.95rem] text-paper/80 transition-colors hover:text-paper"
                      >
                        SKOLAR {d.countryName ?? d.title}
                        <ArrowUpRight size={14} className="opacity-50 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="eyebrow text-paper/40">Contact</h3>
              <ul className="mt-5 space-y-3 text-[0.95rem] text-paper/80">
                <li>
                  <WhatsAppLink className="transition-colors hover:text-paper">WhatsApp</WhatsAppLink>
                </li>
                {email && (
                  <li>
                    <a href={`mailto:${email}`} className="break-all transition-colors hover:text-paper">
                      {email}
                    </a>
                  </li>
                )}
                {phone && (
                  <li>
                    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="transition-colors hover:text-paper">
                      {phone}
                    </a>
                  </li>
                )}
                {address && <li className="text-paper/60">{address}</li>}
              </ul>
              {siteConfig.social.length > 0 && (
                <ul className="mt-8 flex flex-wrap gap-2">
                  {siteConfig.social.map((s) => (
                    <li key={s.label}>
                      <a
                        href={s.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex rounded-full border border-white/15 px-3.5 py-1.5 text-[0.8rem] text-paper/75 transition-colors hover:border-white/50 hover:text-paper"
                      >
                        {s.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </nav>
        </div>

        <div className="mt-16 flex flex-col gap-4 border-t border-white/10 pt-6 text-[0.8rem] text-paper/45 md:flex-row md:items-start md:justify-between">
          <p>© {year} SKOLAR. All rights reserved.</p>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <a href="/privacy" className="hover:text-paper">
              Privacy Policy
            </a>
            <a href="/terms" className="hover:text-paper">
              Terms &amp; Conditions
            </a>
            <details className="group max-w-md">
              <summary className="cursor-pointer list-none hover:text-paper">Image credits</summary>
              <ul className="mt-3 space-y-1.5 text-[0.75rem] leading-snug text-paper/45">
                {imageCredits.map((c) => (
                  <li key={c.image}>
                    <a href={c.source} target="_blank" rel="noopener noreferrer" className="hover:text-paper">
                      {c.title}
                    </a>{" "}
                    by {c.author}, {c.license}
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      </div>
    </footer>
  );
}
