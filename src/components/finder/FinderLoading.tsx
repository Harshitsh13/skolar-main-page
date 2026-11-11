"use client";

import { useEffect, useState } from "react";
import { FlightPath } from "./FlightPath";
import { WhatsAppLink } from "@/components/ui/WhatsAppLink";
import { WhatsApp } from "@/components/ui/Icons";
import type { FinderAnswers } from "@/lib/finder-schema";
import { buildWhatsAppMessage } from "./whatsapp";

export interface QueueStatus {
  remainingSeconds: number;
  attempt: number;
  message: string;
}

/** Shown while the AI analyses the answers (or while waiting in the demand queue). */
export function FinderLoading({
  answers,
  rawAnswers,
  queue,
}: {
  answers: { label: string; value: string }[];
  rawAnswers: FinderAnswers;
  queue?: QueueStatus | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const status = queue
    ? `High demand right now — you're in the queue. Retrying automatically in ${queue.remainingSeconds}s`
    : elapsed < 6
      ? "Reading your answers"
      : elapsed < 16
        ? "Matching universities and courses to your profile"
        : elapsed < 30
          ? "Writing your guidance. This usually takes under a minute."
          : "Almost there. Thanks for your patience.";

  return (
    <div className="flex min-h-[560px] flex-col justify-between px-6 py-8 sm:px-10 sm:py-10" role="status" aria-live="polite">
      <div>
        <FlightPath animate className="h-24 w-48 text-navy-900 sm:h-28 sm:w-56" />
        <h2 className="display mt-6 text-[1.9rem] leading-tight text-navy-900 sm:text-[2.2rem]">
          {queue ? "You’re in the queue" : "Preparing your guidance"}
        </h2>
        <p key={queue ? "queued" : status} className="mt-2 text-[0.98rem] text-ink-soft" style={{ animation: "fade-up .5s var(--ease-out-soft)" }}>
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
        {queue && (
          <div className="mt-5 rounded-2xl border border-gold-500/30 bg-gold-100/40 p-4">
            <p className="text-[0.88rem] leading-relaxed text-navy-800">
              {queue.message}
            </p>
            <div className="mt-3">
              <WhatsAppLink
                message={buildWhatsAppMessage({ answers: rawAnswers, includeDetails: true })}
                className="btn btn-gold !min-h-10 !px-4 text-sm"
              >
                <WhatsApp size={16} /> Skip wait &amp; discuss with a counsellor
              </WhatsAppLink>
            </div>
          </div>
        )}
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
