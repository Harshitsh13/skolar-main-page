"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Logo } from "@/components/ui/Logo";

export function StudioLogin({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) throw new Error(data.message || "Sign-in failed.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-navy-950 px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <Logo tone="dark" height={52} priority />
          <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-gold-300">Studio</p>
        </div>
        <form onSubmit={submit} className="rounded-[24px] bg-paper p-6 shadow-2xl sm:p-7">
          <h1 className="display text-[1.8rem] text-navy-900">Sign in</h1>
          <p className="mt-1 text-sm text-ink-soft">Administrators only.</p>
          {!configured ? (
            <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-800">
              Sign-in is disabled: set <code>ADMIN_PASSWORD</code> in the server environment.
            </p>
          ) : (
            <>
              <label className="mt-6 block">
                <span className="mb-1.5 block text-[0.8rem] font-semibold text-navy-900">Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="min-h-12 w-full rounded-xl border border-navy-900/15 bg-white px-4 text-navy-900 focus:border-navy-900/50 focus:outline-none focus:ring-2 focus:ring-gold-300/60"
                  autoFocus
                  required
                />
              </label>
              {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
              <button disabled={busy || !password} className="btn btn-navy mt-6 w-full">
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </>
          )}
        </form>
      </div>
    </main>
  );
}
