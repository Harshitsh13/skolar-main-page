"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { ToastProvider, useApi } from "./kit";

const NAV: Array<{ href: string; label: string; icon: string }> = [
  { href: "/admin", label: "Overview", icon: "◎" },
  { href: "/admin/automation", label: "Blog Automation", icon: "✦" },
  { href: "/admin/research", label: "Research & Sources", icon: "⌕" },
  { href: "/admin/review", label: "Review Queue", icon: "✓" },
  { href: "/admin/library", label: "Content Library", icon: "▤" },
  { href: "/admin/calendar", label: "Publishing Calendar", icon: "▦" },
  { href: "/admin/data", label: "Countries & Universities", icon: "⌂" },
  { href: "/admin/integrations", label: "Integrations", icon: "⇄" },
  { href: "/admin/settings", label: "Settings", icon: "⚙" },
];

const SOON: Array<{ slug: string; label: string }> = [
  { slug: "carousel", label: "Carousel Studio" },
  { slug: "reels", label: "Reel Studio" },
  { slug: "crawler", label: "Crawler & Monitoring" },
  { slug: "website-builder", label: "Website Builder" },
];

function isActive(path: string, href: string) {
  if (href === "/admin") return path === "/admin" || path === "/admin/reports" || path === "/admin/notifications";
  if (href === "/admin/review") return path.startsWith("/admin/review") || path.startsWith("/admin/articles");
  if (href === "/admin/library") return path.startsWith("/admin/library") || path.startsWith("/admin/write");
  return path.startsWith(href);
}

function NavList({ path, onNavigate }: { path: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Studio" className="flex flex-col gap-0.5">
      {NAV.map((n) => {
        const active = isActive(path, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[0.9rem] transition-colors ${
              active ? "bg-paper/10 font-semibold text-paper" : "text-paper/65 hover:bg-paper/5 hover:text-paper"
            }`}
          >
            <span aria-hidden className={`grid w-5 place-items-center text-[0.95rem] ${active ? "text-gold-300" : ""}`}>
              {n.icon}
            </span>
            {n.label}
          </Link>
        );
      })}
      <p className="eyebrow mt-6 px-3 pb-2 text-paper/35">Coming soon</p>
      {SOON.map((s) => {
        const href = `/admin/coming/${s.slug}`;
        return (
          <Link
            key={s.slug}
            href={href}
            onClick={onNavigate}
            className={`flex min-h-10 items-center justify-between gap-3 rounded-xl px-3 text-[0.85rem] ${path === href ? "bg-paper/10 text-paper/80" : "text-paper/40 hover:text-paper/60"}`}
          >
            {s.label}
            <span className="rounded-full border border-paper/15 px-2 py-0.5 text-[0.62rem] uppercase tracking-wider">Soon</span>
          </Link>
        );
      })}
      <Link href="/admin/site" onClick={onNavigate} className={`mt-6 flex min-h-10 items-center rounded-xl px-3 text-[0.82rem] ${path === "/admin/site" ? "text-paper" : "text-paper/45 hover:text-paper/70"}`}>
        Homepage cards (website)
      </Link>
    </nav>
  );
}

export function StudioShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/admin";
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data: notes, reload } = useApi<{ items: Array<{ read: boolean }> }>("notifications", { refreshMs: 60_000 });
  const unread = notes?.items.filter((n) => !n.read).length ?? 0;

  useEffect(() => {
    void reload();
  }, [path, reload]);

  const logout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.refresh();
  };

  return (
    <ToastProvider>
      <div className="min-h-dvh bg-paper lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh flex-col overflow-y-auto bg-navy-950 px-4 py-6 lg:flex">
          <Link href="/admin" className="mb-8 flex items-center gap-3 px-2">
            <Logo tone="dark" height={34} />
            <span className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-gold-300">Studio</span>
          </Link>
          <NavList path={path} />
          <div className="mt-auto pt-8">
            <a href="/" target="_blank" rel="noopener noreferrer" className="block px-3 py-2 text-[0.8rem] text-paper/45 hover:text-paper/70">
              View website ↗
            </a>
            <button onClick={logout} className="w-full px-3 py-2 text-left text-[0.8rem] text-paper/45 hover:text-paper/70">
              Sign out
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          {/* Top bar */}
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-navy-900/[0.06] bg-paper/90 px-4 backdrop-blur sm:px-6 lg:px-10">
            <div className="flex items-center gap-3 lg:hidden">
              <button onClick={() => setOpen(true)} className="grid h-11 w-11 place-items-center rounded-full hover:bg-stone" aria-label="Open menu">
                ☰
              </button>
              <span className="text-[0.95rem] font-semibold text-navy-900">
                SKOLAR <span className="text-gold-600">Studio</span>
              </span>
            </div>
            <div className="hidden text-[0.8rem] text-ink-faint lg:block">SKOLAR Studio · content research, review & publishing</div>
            <div className="flex items-center gap-2">
              <Link href="/admin/write" className="hidden min-h-10 items-center rounded-full bg-navy-900 px-4 text-[0.82rem] font-semibold text-paper hover:bg-navy-800 sm:inline-flex">
                Write article
              </Link>
              <Link href="/admin/notifications" className="relative grid h-11 w-11 place-items-center rounded-full hover:bg-stone" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
                  <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                  <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {unread > 0 && <span className="absolute right-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-gold-500 px-1 text-[0.65rem] font-bold text-navy-950">{unread > 99 ? "99+" : unread}</span>}
              </Link>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[84rem] px-4 pb-24 pt-6 sm:px-6 sm:pt-8 lg:px-10">{children}</main>
        </div>

        {/* Mobile drawer */}
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-navy-950/50" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-[84%] max-w-xs flex-col overflow-y-auto bg-navy-950 px-4 py-5" style={{ animation: "fade-up .2s var(--ease-out-soft)" }}>
              <div className="mb-6 flex items-center justify-between px-2">
                <Logo tone="dark" height={30} />
                <button onClick={() => setOpen(false)} className="grid h-11 w-11 place-items-center rounded-full text-paper/80 hover:bg-paper/10" aria-label="Close menu">
                  ✕
                </button>
              </div>
              <NavList path={path} onNavigate={() => setOpen(false)} />
              <div className="mt-auto pt-6">
                <Link href="/admin/write" onClick={() => setOpen(false)} className="mb-2 flex min-h-11 items-center justify-center rounded-full bg-gold-500 text-[0.9rem] font-semibold text-navy-950">
                  Write article
                </Link>
                <button onClick={logout} className="w-full px-3 py-2 text-left text-[0.85rem] text-paper/50">
                  Sign out
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ToastProvider>
  );
}
