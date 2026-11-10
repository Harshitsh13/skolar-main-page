"use client";

import { useEffect, useState } from "react";
import { FlightPath } from "./FlightPath";

/** Shown while Grok analyses the answers. It echoes the answers back so the wait feels personal. */
export function FinderLoading({ answers }: { answers: { label: string; value: string }[] }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const status =
    elapsed < 6
      ? "Reading your answers"
      : elapsed < 16
        ? "Matching study pathways to your profile"
        : elapsed < 30
          ? "Writing your guidance. This usually takes under a minute."
          : "Almost there. Thanks for your patience.";

  return (
    <div className="flex min-h-[560px] flex-col justify-between px-6 py-8 sm:px-10 sm:py-10" role="status" aria-live="polite">
      <div>
        <FlightPath animate className="h-24 w-48 text-navy-900 sm:h-28 sm:w-56" />
        <h2 className="display mt-6 text-[1.9rem] leading-tight text-navy-900 sm:text-[2.2rem]">
          Preparing your guidance
        </h2>
        <p key={status} className="mt-2 text-[0.98rem] text-ink-soft" style={{ animation: "fade-up .5s var(--ease-out-soft)" }}>
          {status}
          <span className="ml-1 inline-flex gap-0.5 align-middle">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1 w-1 rounded-full bg-gold-500"
                style={{ animation: `pulse-dot 1.2s ${i * 0.2}s infinite` }}
              />
            ))}
          </span>
        </p>
      </div>
      <dl className="mt-10 grid gap-x-8 sm:grid-cols-2">
        {answers.map((a, i) => (
          <div
            key={a.label}
            className="border-t border-navy-900/10 py-3"
            style={{ animation: `fade-up .6s ${0.15 + i * 0.12}s var(--ease-out-soft) both` }}
          >
            <dt className="text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">{a.label}</dt>
            <dd className="mt-1 text-[0.95rem] text-navy-900">{a.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
