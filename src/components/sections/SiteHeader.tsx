"use client";

import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { navLinks } from "@/config/site";
import { Close, Menu, WhatsApp } from "@/components/ui/Icons";
import { WhatsAppLink } from "@/components/ui/WhatsAppLink";

/** Slim header that switches tone based on the section underneath it. */
export function SiteHeader({ initialTone = "dark", homeHref = "" }: { initialTone?: "dark" | "light"; homeHref?: string }) {
  const [tone, setTone] = useState<"dark" | "light">(initialTone);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      setScrolled(window.scrollY > 8);
      const probe = 34;
      let t: "dark" | "light" = "light";
      document.querySelectorAll<HTMLElement>("[data-header-tone]").forEach((s) => {
        const r = s.getBoundingClientRect();
        if (r.top <= probe && r.bottom > probe) t = s.dataset.headerTone as "dark" | "light";
      });
      setTone(t);
      let current = "";
      navLinks.forEach((l) => {
        const el = document.querySelector<HTMLElement>(l.href);
        if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.35) current = l.href;
      });
      setActive(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const dark = tone === "dark";

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,color] duration-500 ${
          dark ? "text-paper" : "text-navy-900"
        } ${
          scrolled
            ? dark
              ? "border-b border-white/[0.07] bg-navy-950/75 backdrop-blur-xl"
              : "border-b border-navy-900/[0.07] bg-paper/80 backdrop-blur-xl"
            : "border-b border-transparent"
        }`}
      >
        <div className="container-x flex h-16 items-center justify-between gap-6 lg:h-[68px]">
          <a href={`${homeHref}#finder`} className="relative -my-3 flex shrink-0 items-center" aria-label="SKOLAR home">
            <span className={`transition-opacity duration-500 ${dark ? "opacity-100" : "opacity-0"}`}>
              <Logo tone="dark" height={60} priority />
            </span>
            <span className={`absolute inset-0 transition-opacity duration-500 ${dark ? "opacity-0" : "opacity-100"}`}>
              <Logo tone="light" height={60} priority />
            </span>
          </a>

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {navLinks.map((l) => (
              <a
                key={l.href}
                href={homeHref + l.href}
                className={`relative rounded-full px-3.5 py-2 text-[0.88rem] font-medium transition-colors ${
                  dark ? "text-paper/70 hover:text-paper" : "text-navy-900/65 hover:text-navy-900"
                } ${active === l.href ? (dark ? "!text-paper" : "!text-navy-900") : ""}`}
              >
                {l.label}
                <span
                  className={`absolute inset-x-3.5 -bottom-px h-px origin-left bg-gold-500 transition-transform duration-500 ${
                    active === l.href ? "scale-x-100" : "scale-x-0"
                  }`}
                />
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <WhatsAppLink
              className={`btn !min-h-10 !px-4 text-[0.85rem] ${dark ? "btn-light" : "btn-navy"}`}
              aria-label="Chat with SKOLAR on WhatsApp"
            >
              <WhatsApp size={17} />
              <span className="hidden sm:inline">WhatsApp</span>
            </WhatsAppLink>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className={`grid h-10 w-10 place-items-center rounded-full lg:hidden ${
                dark ? "border border-white/20" : "border border-navy-900/15"
              }`}
              aria-label="Open menu"
              aria-expanded={open}
              aria-controls="mobile-menu"
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu */}
      <div
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={`fixed inset-0 z-[60] flex flex-col bg-navy-900 text-paper transition-[opacity,visibility] duration-500 lg:hidden ${
          open ? "visible opacity-100" : "invisible opacity-0"
        }`}
      >
        <div className="container-x flex h-16 items-center justify-between">
          <Logo tone="dark" height={50} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid h-10 w-10 place-items-center rounded-full border border-white/20"
            aria-label="Close menu"
          >
            <Close size={20} />
          </button>
        </div>
        <nav aria-label="Mobile" className="container-x mt-8 flex flex-1 flex-col">
          {navLinks.map((l, i) => (
            <a
              key={l.href}
              href={homeHref + l.href}
              onClick={() => setOpen(false)}
              className="display flex items-baseline justify-between border-b border-white/10 py-4 text-[2rem]"
              style={{
                transition: `opacity .6s ${0.08 + i * 0.05}s, transform .6s ${0.08 + i * 0.05}s var(--ease-out-soft)`,
                opacity: open ? 1 : 0,
                transform: open ? "none" : "translateY(10px)",
              }}
            >
              {l.label}
              <span className="font-sans text-xs tracking-widest text-paper/40">0{i + 1}</span>
            </a>
          ))}
        </nav>
        <div className="container-x pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <WhatsAppLink className="btn btn-gold w-full" onClick={() => setOpen(false)}>
            <WhatsApp size={18} /> Talk to SKOLAR on WhatsApp
          </WhatsAppLink>
        </div>
      </div>
    </>
  );
}
