import Image from "next/image";
import { siteConfig } from "@/config/site";
import { WhatsAppLink } from "@/components/ui/WhatsAppLink";
import { ArrowRight, WhatsApp } from "@/components/ui/Icons";

/** Section 05: the closing call to action. */
export function ContactSection() {
  const { email, phone, address } = siteConfig.contact;
  const details = [
    email && { label: "Email", value: email, href: `mailto:${email}` },
    phone && { label: "Phone", value: phone, href: `tel:${phone.replace(/[^\d+]/g, "")}` },
    address && { label: "Office", value: address },
  ].filter(Boolean) as { label: string; value: string; href?: string }[];

  return (
    <section id="contact" data-header-tone="dark" className="relative isolate overflow-hidden bg-navy-950 text-paper">
      <div className="absolute inset-0 -z-10">
        <Image
          src="/images/library-rotunda.webp"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-[50%_40%] opacity-55"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-navy-950/70 via-navy-950/55 to-navy-950" />
      </div>

      <div className="container-x flex min-h-[78svh] flex-col items-center justify-center py-28 text-center lg:min-h-[86svh]">
        <p className="eyebrow text-gold-300" data-reveal>
          Contact SKOLAR
        </p>
        <h2 className="display mt-6 max-w-4xl text-[2.6rem] sm:text-[3.6rem] lg:text-[4.6rem]" data-reveal>
          Ready to explore your university options?
        </h2>
        <div className="mt-10 flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row" data-reveal>
          <a href="#finder" className="btn btn-gold group w-full !min-h-[3.4rem] !px-7 sm:w-auto">
            Start Your University Search <ArrowRight size={18} className="link-arrow" />
          </a>
          <WhatsAppLink className="btn btn-ghost-dark w-full !min-h-[3.4rem] !px-7 backdrop-blur-sm sm:w-auto">
            <WhatsApp size={18} /> Talk to SKOLAR on WhatsApp
          </WhatsAppLink>
        </div>

        {details.length > 0 && (
          <dl className="mt-16 flex flex-wrap justify-center gap-x-12 gap-y-6 border-t border-white/15 pt-8" data-reveal>
            {details.map((d) => (
              <div key={d.label}>
                <dt className="eyebrow text-paper/45">{d.label}</dt>
                <dd className="mt-2 text-[1rem]">
                  {d.href ? (
                    <a href={d.href} className="u-link">
                      {d.value}
                    </a>
                  ) : (
                    d.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
