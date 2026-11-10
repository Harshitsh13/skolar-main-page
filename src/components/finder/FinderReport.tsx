"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { FinderAnswers, FinderResponse } from "@/lib/finder-schema";
import { describeAnswers } from "@/lib/finder-describe";
import { whatsappLink } from "@/config/site";
import { ArrowUpRight, Pencil, Refresh, WhatsApp } from "@/components/ui/Icons";
import { buildWhatsAppMessage } from "./whatsapp";
import type { PlatformLink } from "./Finder";

const fade = (i: number) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay: 0.08 * i, ease: [0.22, 1, 0.36, 1] as const },
});

export function FinderReport({
  response,
  answers,
  platforms,
  onEdit,
  onRestart,
}: {
  response: FinderResponse;
  answers: FinderAnswers;
  platforms: PlatformLink[];
  onEdit: () => void;
  onRestart: () => void;
}) {
  const { result, ref, generatedAt } = response;
  const recap = describeAnswers(answers);
  const related = platforms.filter((p) => result.relatedPlatformIds.includes(p.id));
  const date = new Date(generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="text-paper">
      {/* Report header, on navy */}
      <motion.div {...fade(0)} className="flex flex-col gap-6 pb-10 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow flex items-center gap-3 text-gold-300">
            <span className="h-px w-8 bg-gold-500" /> Your SKOLAR AI report · {date}
          </p>
          <h1 className="display mt-5 max-w-3xl text-[2.4rem] sm:text-[3.2rem] lg:text-[3.6rem]">
            Your university exploration report
          </h1>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={onEdit} className="btn btn-ghost-dark !min-h-11">
            <Pencil size={16} /> Edit answers
          </button>
          <button type="button" onClick={onRestart} className="btn btn-ghost-dark !min-h-11">
            <Refresh size={16} /> Start over
          </button>
        </div>
      </motion.div>

      <div className="grid gap-5 lg:grid-cols-12 lg:gap-6">
        {/* Sidebar: answers + counsellor CTA */}
        <aside className="order-2 space-y-5 lg:order-1 lg:col-span-4">
          <div className="space-y-5 lg:sticky lg:top-24">
            <motion.div {...fade(2)} id="counsellor-panel" className="scroll-mt-24">
              <CounsellorPanel answers={answers} brief={result.counsellorBrief} reference={ref} />
            </motion.div>
            <motion.div {...fade(3)} className="rounded-[22px] border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between">
                <p className="eyebrow text-paper/50">What you told us</p>
                <button type="button" onClick={onEdit} className="text-xs text-gold-300 hover:text-gold-100">
                  Edit
                </button>
              </div>
              <dl className="mt-4 space-y-3.5">
                {recap.map((r) => (
                  <div key={r.label}>
                    <dt className="text-[0.72rem] uppercase tracking-[0.14em] text-paper/40">{r.label}</dt>
                    <dd className="mt-0.5 text-[0.95rem] text-paper/90">{r.value}</dd>
                  </div>
                ))}
                {answers.about && (
                  <div>
                    <dt className="text-[0.72rem] uppercase tracking-[0.14em] text-paper/40">In your words</dt>
                    <dd className="mt-0.5 line-clamp-4 text-[0.92rem] italic text-paper/70">&ldquo;{answers.about}&rdquo;</dd>
                  </div>
                )}
              </dl>
            </motion.div>
          </div>
        </aside>

        {/* The report document */}
        <motion.article
          {...fade(1)}
          className="order-1 rounded-[26px] bg-paper text-navy-900 shadow-[0_40px_80px_-40px_rgb(0_0_0/0.7)] lg:order-2 lg:col-span-8"
        >
          <div className="border-b border-navy-900/8 px-6 py-7 sm:px-10 sm:py-9">
            <span className="inline-flex items-center gap-2 rounded-full bg-stone px-3 py-1.5 text-[0.75rem] font-medium text-navy-700">
              <span className="h-1.5 w-1.5 rounded-full bg-gold-500" /> Exploratory guidance: not an admission or eligibility
              decision
            </span>
            <p className="display mt-6 text-[1.45rem] leading-[1.35] text-navy-900 sm:text-[1.7rem]">{result.profileSummary}</p>
            {result.profileHighlights.length > 0 && (
              <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                {result.profileHighlights.map((h) => (
                  <div key={h.label} className="border-l-2 border-gold-500/70 pl-3">
                    <dt className="text-[0.72rem] uppercase tracking-[0.12em] text-ink-faint">{h.label}</dt>
                    <dd className="mt-0.5 text-[0.93rem] font-medium">{h.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {result.pathways.length > 0 && (
            <Section title="Study pathways to explore" index="01">
              <div className="space-y-4">
                {result.pathways.map((p, i) => (
                  <div key={i} className="rounded-2xl border border-navy-900/10 bg-white p-5 sm:p-6">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h4 className="text-[1.08rem] font-semibold leading-snug">{p.title}</h4>
                      <p className="text-[0.8rem] text-ink-faint">
                        {p.studyLevel} · {p.destination}
                      </p>
                    </div>
                    <p className="mt-2.5 text-[0.95rem] leading-relaxed text-ink-soft">{p.rationale}</p>
                    {p.whatToCheck.length > 0 && (
                      <div className="mt-4 border-t border-dashed border-navy-900/12 pt-3.5">
                        <p className="text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-faint">Check before applying</p>
                        <ul className="mt-2 space-y-1.5">
                          {p.whatToCheck.map((c) => (
                            <li key={c} className="flex gap-2.5 text-[0.9rem] text-navy-700">
                              <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-gold-500" />
                              {c}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {result.universityExamples.length > 0 && (
            <Section
              title="Universities you could look into"
              index="02"
              note="Suggestions to research, not confirmed matches. Entry requirements, fees and deadlines must be verified with each university."
            >
              <ul className="divide-y divide-navy-900/8 border-y border-navy-900/8">
                {result.universityExamples.map((u) => (
                  <li key={u.name} className="grid gap-1 py-4 sm:grid-cols-[1fr_auto] sm:gap-6">
                    <div>
                      <p className="font-semibold">
                        {u.name} <span className="font-normal text-ink-faint">· {u.country}</span>
                      </p>
                      <p className="mt-1 text-[0.92rem] text-ink-soft">{u.why}</p>
                    </div>
                    <span
                      className={`mt-1 h-fit w-fit rounded-full px-2.5 py-1 text-[0.7rem] font-semibold uppercase tracking-[0.08em] ${
                        u.status === "skolar_listed"
                          ? "bg-gold-100 text-gold-600"
                          : "border border-navy-900/15 text-ink-soft"
                      }`}
                    >
                      {u.status === "skolar_listed" ? "Listed by SKOLAR" : "To verify"}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {related.length > 0 && (
            <Section title="Relevant SKOLAR platforms" index="03">
              <div className="grid gap-3 sm:grid-cols-2">
                {related.map((p) => (
                  <a
                    key={p.id}
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-4 rounded-2xl border border-navy-900/10 bg-white p-3 pr-5 transition-colors hover:border-navy-900/30"
                  >
                    <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl">
                      <Image src={p.imageUrl} alt="" fill sizes="64px" className="object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.72rem] uppercase tracking-[0.12em] text-ink-faint">SKOLAR {p.countryName}</span>
                      <span className="block truncate font-semibold">{p.title}</span>
                    </span>
                    <ArrowUpRight size={18} className="link-arrow-diag shrink-0 transition-transform duration-300" />
                  </a>
                ))}
              </div>
            </Section>
          )}

          {(result.considerations.length > 0 || result.missingInformation.length > 0) && (
            <div className="grid gap-px border-t border-navy-900/8 bg-navy-900/8 md:grid-cols-2">
              {result.considerations.length > 0 && (
                <div className="bg-paper px-6 py-8 sm:px-10">
                  <h3 className="eyebrow text-ink-soft">Important considerations</h3>
                  <ul className="mt-4 space-y-3">
                    {result.considerations.map((c) => (
                      <li key={c} className="flex gap-3 text-[0.95rem] leading-relaxed">
                        <span className="mt-[0.6rem] h-1 w-3 shrink-0 bg-gold-500" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.missingInformation.length > 0 && (
                <div className="bg-paper px-6 py-8 sm:px-10">
                  <h3 className="eyebrow text-ink-soft">What a counsellor would ask you</h3>
                  <ul className="mt-4 space-y-4">
                    {result.missingInformation.map((m) => (
                      <li key={m.question}>
                        <p className="text-[0.95rem] font-medium">{m.question}</p>
                        <p className="mt-0.5 text-[0.86rem] text-ink-soft">{m.why}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {result.nextSteps.length > 0 && (
            <div className="rounded-b-[26px] bg-navy-900 px-6 py-9 text-paper sm:px-10">
              <h3 className="eyebrow text-gold-300">Suggested next steps</h3>
              <ol className="mt-5 grid gap-5 sm:grid-cols-2">
                {result.nextSteps.map((s, i) => (
                  <li key={s} className="flex gap-4">
                    <span className="display text-[1.6rem] leading-none text-gold-400">{String(i + 1).padStart(2, "0")}</span>
                    <p className="text-[0.95rem] leading-relaxed text-paper/85">{s}</p>
                  </li>
                ))}
              </ol>
              <p className="mt-8 border-t border-white/10 pt-5 text-[0.78rem] leading-relaxed text-paper/45">
                Generated by SKOLAR AI from your answers. This report is exploratory. It does not assess or guarantee admission,
                scholarships or visas. Always confirm requirements with the university and a SKOLAR counsellor.
              </p>
            </div>
          )}
        </motion.article>
      </div>
      <MobileCounsellorBar />
    </div>
  );
}

/** On phones the counsellor panel sits below the report, so keep a way to reach it in view. */
function MobileCounsellorBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const panel = document.getElementById("counsellor-panel");
    const finder = document.getElementById("finder");
    if (!panel || !finder) return;
    let panelVisible = false;
    let finderVisible = true;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.target === panel) panelVisible = e.isIntersecting;
        if (e.target === finder) finderVisible = e.isIntersecting;
      });
      setShow(finderVisible && !panelVisible);
    });
    io.observe(panel);
    io.observe(finder);
    return () => io.disconnect();
  }, []);
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 transition-transform duration-500 lg:hidden ${
        show ? "translate-y-0" : "translate-y-[150%]"
      }`}
    >
      <a href="#counsellor-panel" className="btn btn-gold w-full shadow-2xl">
        <WhatsApp size={18} /> Discuss this with a counsellor
      </a>
    </div>
  );
}

function Section({ title, index, note, children }: { title: string; index: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-navy-900/8 px-6 py-8 sm:px-10 sm:py-9">
      <div className="mb-5 flex items-baseline gap-4">
        <span className="text-[0.78rem] font-semibold tabular-nums text-gold-600">{index}</span>
        <div>
          <h3 className="display text-[1.5rem] leading-tight sm:text-[1.7rem]">{title}</h3>
          {note && <p className="mt-1.5 max-w-xl text-[0.85rem] text-ink-faint">{note}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function CounsellorPanel({ answers, brief, reference }: { answers: FinderAnswers; brief: string; reference: string | null }) {
  const [share, setShare] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const message = useMemo(
    () => buildWhatsAppMessage({ answers, includeDetails: share, brief, reference }),
    [answers, share, brief, reference],
  );
  const href = whatsappLink(message);

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-gold-500 p-6 text-navy-950">
      <WhatsApp size={120} className="pointer-events-none absolute -right-6 -top-6 text-navy-950/[0.07]" />
      <p className="eyebrow text-navy-950/60">Next: talk it through</p>
      <h2 className="display mt-3 text-[1.65rem] leading-[1.15]">Discuss your options with a SKOLAR counsellor.</h2>

      <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl bg-navy-950/[0.07] p-3.5">
        <input
          type="checkbox"
          checked={share}
          onChange={(e) => setShare(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-navy-900"
        />
        <span className="text-[0.86rem] leading-snug">
          Include my answers, preferred destination and report summary in the message
        </span>
      </label>

      <button
        type="button"
        onClick={() => setShowPreview((v) => !v)}
        className="mt-3 text-[0.8rem] font-medium text-navy-950/70 underline underline-offset-4 hover:text-navy-950"
        aria-expanded={showPreview}
      >
        {showPreview ? "Hide message" : "Preview message"}
      </button>
      {showPreview && (
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-paper/90 p-3.5 font-sans text-[0.8rem] leading-relaxed text-navy-900">
          {message}
        </pre>
      )}

      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => window.dispatchEvent(new CustomEvent("skolar:finder", { detail: { event: "whatsapp", shared: share } }))}
          className="btn btn-navy mt-5 w-full !whitespace-normal !py-3 text-center"
        >
          <WhatsApp size={18} className="shrink-0" /> I want to discuss this with a counsellor.
        </a>
      ) : (
        <a href="#contact" className="btn btn-navy mt-5 w-full !whitespace-normal !py-3 text-center">
          I want to discuss this with a counsellor.
        </a>
      )}
      <p className="mt-3 text-[0.75rem] leading-snug text-navy-950/60">
        Opens WhatsApp with the message ready. You can review or edit it before sending.
        {reference && <> Your reference: <span className="font-semibold">{reference}</span></>}
      </p>
    </div>
  );
}
