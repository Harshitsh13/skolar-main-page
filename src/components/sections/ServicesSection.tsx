"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { servicePhases } from "@/content/services";
import { Plane } from "@/components/ui/Icons";

const showUnconfirmed = process.env.NODE_ENV !== "production";

/**
 * Section 03: what SKOLAR actually does, told as a route in three phases.
 * The dotted flight path from the logo runs down the services; the plane
 * follows the service you're reading. Scrolling is never hijacked.
 */
export function ServicesSection() {
  const [active, setActive] = useState("discovery");
  const [planeY, setPlaneY] = useState(0);
  const routeRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  const activePhase = servicePhases.find((p) => p.services.some((s) => s.id === active)) ?? servicePhases[0];

  useEffect(() => {
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-service]"));
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length) setActive((visible[0].target as HTMLElement).dataset.service!);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    // offsetTop ignores the reveal transform, so the plane lands exactly on the node.
    const measure = () => {
      const node = nodeRefs.current[active];
      const li = node?.parentElement;
      if (node && li) setPlaneY(li.offsetTop + node.offsetTop);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  let counter = 0;

  return (
    <section id="what-we-do" data-header-tone="light" className="relative bg-stone/60 py-20 sm:py-24 lg:py-32">
      <div className="container-x">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          {/* Sticky intro + phase photograph */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-28">
              <p className="eyebrow text-ink-soft" data-reveal>
                What SKOLAR does
              </p>
              <h2 className="display mt-4 text-[2.4rem] text-navy-900 sm:text-[3rem] lg:text-[3.4rem]" data-reveal>
                Practical help, from shortlist to <em className="font-[360]">offer</em> and beyond.
              </h2>
              <p className="mt-5 max-w-md text-[1.02rem] leading-relaxed text-ink-soft" data-reveal>
                SKOLAR guides students through the decisions and paperwork of applying to university abroad. Here is where we
                help.
              </p>

              <div className="relative mt-10 hidden aspect-[4/3.4] overflow-hidden rounded-[22px] bg-navy-900 lg:block">
                {servicePhases.map((p) => (
                  <Image
                    key={p.id}
                    src={p.image.src}
                    alt={p.image.alt}
                    fill
                    sizes="40vw"
                    className={`object-cover transition-[opacity,transform] duration-[1200ms] ease-[cubic-bezier(.22,1,.36,1)] ${
                      p.id === activePhase.id ? "scale-100 opacity-100" : "scale-[1.04] opacity-0"
                    }`}
                  />
                ))}
                <div className="absolute inset-0 bg-gradient-to-t from-navy-950/70 via-transparent to-transparent" />
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between p-6 text-paper">
                  <div>
                    <p className="eyebrow text-gold-300">Phase {servicePhases.indexOf(activePhase) + 1} of 3</p>
                    <p className="display mt-1 text-[1.6rem]">{activePhase.label}</p>
                  </div>
                  <div className="flex gap-1.5">
                    {servicePhases.map((p) => (
                      <span
                        key={p.id}
                        className={`h-1.5 rounded-full transition-all duration-500 ${p.id === activePhase.id ? "w-6 bg-gold-400" : "w-1.5 bg-white/40"}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* The route */}
          <div className="relative lg:col-span-7" ref={routeRef}>
            {/* Dotted flight path + plane (desktop & tablet) */}
            <div aria-hidden className="absolute bottom-6 left-[7px] top-3 hidden border-l-[1.5px] border-dotted border-navy-900/30 sm:block" />
            <div
              aria-hidden
              className="absolute left-[-4px] top-0 hidden text-gold-500 transition-transform duration-700 ease-[cubic-bezier(.22,1,.36,1)] sm:block"
              style={{ transform: `translateY(${planeY - 5}px) rotate(180deg)` }}
            >
              <Plane size={24} />
            </div>

            <div className="space-y-16 sm:pl-14 lg:space-y-20">
              {servicePhases.map((phase) => (
                <div key={phase.id}>
                  {/* Mobile: phase image inline */}
                  <div className="relative mb-7 aspect-[16/10] overflow-hidden rounded-[18px] lg:hidden" data-reveal>
                    <Image src={phase.image.src} alt={phase.image.alt} fill sizes="(min-width: 640px) 80vw, 100vw" className="object-cover" />
                  </div>
                  <div className="mb-6 flex items-baseline gap-4" data-reveal>
                    <span className="eyebrow text-gold-600">{phase.label}</span>
                    <span className="h-px flex-1 bg-navy-900/12" />
                  </div>
                  <h3 className="display mb-8 text-[1.9rem] leading-tight text-navy-900 sm:text-[2.2rem]" data-reveal>
                    {phase.heading}
                  </h3>
                  <ol className="space-y-3">
                    {phase.services.map((s) => {
                      counter += 1;
                      const isActive = s.id === active;
                      return (
                        <li
                          key={s.id}
                          data-service={s.id}
                          data-reveal
                          className={`relative rounded-[18px] border p-5 transition-all duration-500 sm:p-7 ${
                            isActive
                              ? "border-navy-900/10 bg-paper shadow-[0_20px_40px_-28px_rgb(23_22_39/0.35)]"
                              : "border-transparent bg-transparent"
                          }`}
                        >
                          <span
                            ref={(el) => {
                              nodeRefs.current[s.id] = el;
                            }}
                            aria-hidden
                            className={`absolute -left-[calc(3.5rem-1px)] top-8 hidden h-3.5 w-3.5 rounded-full border-2 transition-colors duration-500 sm:block ${
                              isActive ? "border-gold-500 bg-gold-500" : "border-navy-900/30 bg-stone"
                            }`}
                          />
                          <div className="flex items-start gap-5">
                            <span className="display mt-0.5 text-[1.05rem] tabular-nums text-ink-faint">
                              {String(counter).padStart(2, "0")}
                            </span>
                            <div className="min-w-0 flex-1">
                              <h4 className="text-[1.15rem] font-semibold leading-snug text-navy-900 sm:text-[1.25rem]">
                                {s.title}
                                {showUnconfirmed && !s.confirmed && (
                                  <span
                                    className="ml-2 inline-block h-1.5 w-1.5 -translate-y-1 rounded-full bg-gold-500 align-middle"
                                    title="Unconfirmed service. Edit src/content/services.ts"
                                  />
                                )}
                              </h4>
                              <p className="mt-2 text-[0.98rem] leading-relaxed text-ink-soft">{s.description}</p>
                              <p className="mt-4 inline-flex items-center gap-2 text-[0.85rem] font-medium text-navy-700">
                                <span className="h-px w-5 bg-gold-500" /> {s.outcome}
                              </p>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
