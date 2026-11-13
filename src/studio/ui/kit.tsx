"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/* ═════════════════════════ API helper ═════════════════════════ */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown; form?: FormData }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/studio/${path}`, {
      method: init?.method ?? (init?.body || init?.form ? "POST" : "GET"),
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.form ?? (init?.body !== undefined ? JSON.stringify(init.body) : undefined),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Network error — the request did not reach the server. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (res.status === 401) {
    window.location.reload();
    throw new ApiError("Session expired", 401);
  }
  if (!res.ok) {
    const fallback =
      res.status === 413
        ? "The upload is larger than the server accepts (Vercel limit: 4.5 MB per request)."
        : res.status === 504 || res.status === 502
          ? `The server timed out or failed (HTTP ${res.status}). Nothing was saved — try again.`
          : `Request failed (HTTP ${res.status}).`;
    throw new ApiError(data?.message || fallback, res.status, data);
  }
  return data;
}

export function useApi<T>(path: string | null, opts?: { refreshMs?: number }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    if (!pathRef.current) return;
    try {
      const d = await api<T>(pathRef.current);
      setData(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!path) return;
    setLoading(true);
    void reload();
    if (!opts?.refreshMs) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, opts.refreshMs);
    return () => clearInterval(t);
  }, [path, opts?.refreshMs, reload]);

  return { data, error, loading, reload, setData };
}

/* ═════════════════════════ Toasts ═════════════════════════ */

type Toast = { id: number; kind: "ok" | "err" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-md rounded-2xl px-4 py-3 text-sm shadow-lg ${
              t.kind === "err" ? "bg-red-700 text-white" : t.kind === "ok" ? "bg-navy-900 text-paper" : "bg-white text-navy-900 ring-1 ring-navy-900/10"
            }`}
            style={{ animation: "fade-up .25s var(--ease-out-soft)" }}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

/** Runs an async action with busy state + toast on error/success. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(key);
      try {
        const out = await fn();
        if (success) toast("ok", success);
        return out;
      } catch (err) {
        toast("err", err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );
  return { busy, run };
}

/* ═════════════════════════ Layout primitives ═════════════════════════ */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="display text-[2rem] leading-none text-navy-900 sm:text-[2.5rem]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-[0.95rem] text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ children, className = "", padded = true }: { children: React.ReactNode; className?: string; padded?: boolean }) {
  return <section className={`rounded-[20px] border border-navy-900/[0.07] bg-white ${padded ? "p-5 sm:p-6" : ""} ${className}`}>{children}</section>;
}

export function CardTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-[0.95rem] font-semibold text-navy-900">{children}</h2>
      {action}
    </div>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "gold" | "ghost" | "danger" | "subtle";
  size?: "sm" | "md";
  busy?: boolean;
};

export function Button({ variant = "ghost", size = "md", busy, className = "", children, disabled, ...rest }: BtnProps) {
  const v = {
    primary: "bg-navy-900 text-paper hover:bg-navy-800",
    gold: "bg-gold-500 text-navy-950 hover:bg-gold-400",
    ghost: "border border-navy-900/15 text-navy-900 hover:border-navy-900/40 bg-white",
    danger: "border border-red-700/25 text-red-700 hover:bg-red-50 bg-white",
    subtle: "text-navy-900 hover:bg-stone/70",
  }[variant];
  const s = size === "sm" ? "min-h-9 px-3.5 text-[0.82rem]" : "min-h-11 px-5 text-[0.9rem]";
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${v} ${s} ${className}`}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} aria-hidden />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-16 text-sm text-ink-faint" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-red-700/20 bg-red-50 p-4 text-sm text-red-800">
      {error}
      {onRetry && (
        <button onClick={onRetry} className="ml-3 font-semibold underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border border-dashed border-navy-900/15 px-6 py-12 text-center">
      <p className="display text-[1.4rem] text-navy-900">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

const TONES = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-700/15",
  gold: "bg-gold-100 text-gold-600 ring-gold-500/20",
  navy: "bg-navy-900 text-paper ring-navy-900",
  grey: "bg-stone/70 text-ink-soft ring-navy-900/5",
  red: "bg-red-50 text-red-700 ring-red-700/15",
  blue: "bg-sky-50 text-sky-800 ring-sky-700/15",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "grey", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.72rem] font-semibold ring-1 ${TONES[tone]} ${className}`}>{children}</span>;
}

export const STATUS_TONE: Record<string, Tone> = {
  researching: "blue",
  draft: "gold",
  needs_review: "red",
  approved: "green",
  scheduled: "blue",
  publishing: "gold",
  published: "navy",
  rejected: "grey",
  failed: "red",
  queued: "grey",
  running: "blue",
  paused: "grey",
  waiting_network: "gold",
  waiting_api: "gold",
  completed: "green",
  cancelled: "grey",
  verified: "green",
  partially_verified: "gold",
  conflicting: "red",
  unverified: "red",
  outdated: "gold",
  suggested: "grey",
  in_progress: "blue",
  used: "green",
  dismissed: "grey",
};

export const STATUS_TEXT: Record<string, string> = {
  researching: "Researching",
  draft: "Ready for review",
  needs_review: "Needs review",
  approved: "Approved",
  scheduled: "Scheduled",
  publishing: "Publishing…",
  published: "Published",
  rejected: "Rejected",
  failed: "Failed",
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  waiting_network: "Waiting for network",
  waiting_api: "Waiting for API",
  completed: "Completed",
  cancelled: "Cancelled",
  verified: "Verified",
  partially_verified: "Partially verified",
  conflicting: "Conflicting",
  unverified: "Unverified",
  outdated: "Outdated",
  suggested: "Suggested",
  in_progress: "In progress",
  used: "Used",
  dismissed: "Dismissed",
};

export function Status({ value }: { value: string }) {
  return <Badge tone={STATUS_TONE[value] ?? "grey"}>{STATUS_TEXT[value] ?? value}</Badge>;
}

/* ═════════════════════════ Forms ═════════════════════════ */

export function Field({ label, hint, children, className = "" }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[0.8rem] font-semibold text-navy-900">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[0.75rem] leading-snug text-ink-faint">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-navy-900/15 bg-white px-3.5 py-2.5 text-[0.92rem] text-navy-900 placeholder:text-ink-faint focus:border-navy-900/50 focus:outline-none focus:ring-2 focus:ring-gold-300/60";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} min-h-11 ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Select({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: Array<{ value: string; label: string }> }) {
  return (
    <select {...props} className={`${inputCls} min-h-11 pr-8 ${props.className ?? ""}`}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-start justify-between gap-4 ${disabled ? "opacity-50" : ""}`}>
      <span>
        <span className="block text-[0.9rem] font-semibold text-navy-900">{label}</span>
        {hint && <span className="block text-[0.78rem] text-ink-faint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-navy-900" : "bg-stone-dark"}`}
      >
        <span className={`absolute left-0 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </label>
  );
}

/* ═════════════════════════ Modal / sheet ═════════════════════════ */

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/40 p-0 sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[92vh] w-full overflow-y-auto rounded-t-[24px] bg-paper p-5 shadow-2xl sm:rounded-[24px] sm:p-7 ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
        style={{ animation: "fade-up .25s var(--ease-out-soft)" }}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="display text-[1.6rem] leading-tight text-navy-900">{title}</h2>
          <button onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full hover:bg-stone" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ═════════════════════════ Formatting ═════════════════════════ */

export function fmtDateTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function fmtDate(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d);
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "—";
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.max(1, Math.round(f / 60))} min`;
    if (f < 86400) return `in ${Math.round(f / 3600)} h`;
    return `in ${Math.round(f / 86400)} d`;
  }
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const nf = (n: number) => new Intl.NumberFormat("en-GB").format(n);
