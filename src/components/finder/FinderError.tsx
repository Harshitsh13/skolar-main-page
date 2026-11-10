"use client";

import { WhatsAppLink } from "@/components/ui/WhatsAppLink";
import { ArrowLeft, Refresh, WhatsApp } from "@/components/ui/Icons";
import type { FinderAnswers } from "@/lib/finder-schema";
import { buildWhatsAppMessage } from "./whatsapp";

export function FinderError({
  error,
  onRetry,
  onEdit,
  answers,
}: {
  error: { code: string; message: string };
  onRetry: () => void;
  onEdit: () => void;
  answers: FinderAnswers;
}) {
  const canRetry = error.code !== "not_configured";
  return (
    <div className="flex min-h-[480px] flex-col justify-center px-6 py-10 sm:px-10" role="alert">
      <p className="eyebrow text-gold-600">We couldn&rsquo;t finish your analysis</p>
      <h2 className="display mt-4 max-w-lg text-[1.9rem] leading-tight text-navy-900 sm:text-[2.2rem]">{error.message}</h2>
      <p className="mt-4 max-w-lg text-ink-soft">
        Your answers are kept on this device. You can also send them to a SKOLAR counsellor, who can review them with you
        directly.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {canRetry && (
          <button type="button" onClick={onRetry} className="btn btn-navy">
            <Refresh size={17} /> Try again
          </button>
        )}
        <WhatsAppLink
          message={buildWhatsAppMessage({ answers, includeDetails: true })}
          className="btn btn-gold"
        >
          <WhatsApp size={18} /> Send my answers to a counsellor
        </WhatsAppLink>
        <button type="button" onClick={onEdit} className="btn btn-ghost-light">
          <ArrowLeft size={17} /> Review answers
        </button>
      </div>
    </div>
  );
}
