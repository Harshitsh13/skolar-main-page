"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ABOUT_MAX_CHARS,
  ABOUT_PROMPTS,
  DEFAULT_GRADE_FORMAT,
  EDUCATION_LEVELS,
  FINDER_COUNTRIES,
  GRADE_FORMATS,
  GRADE_RANGES,
  MAX_COUNTRIES,
  MAX_SUBJECTS,
  SUBJECTS,
  gradeQuestionContext,
  type EducationLevel,
  type GradeFormat,
} from "@/config/finder";
import type { FinderAnswers, FinderResponse } from "@/lib/finder-schema";
import { describeAnswers } from "@/lib/finder-describe";
import { ArrowLeft, ArrowRight, Close } from "@/components/ui/Icons";
import { Chip, OptionTile, TextField } from "./controls";
import { FinderLoading } from "./FinderLoading";
import { FinderReport } from "./FinderReport";
import { FinderError } from "./FinderError";

/* ───────────────────────────── Types & state ───────────────────────────── */

export interface PlatformLink {
  id: string;
  title: string;
  countryName?: string;
  url: string;
  imageUrl: string;
}

interface Draft {
  level: EducationLevel | null;
  levelOther: string;
  gradeFormat: GradeFormat;
  gradeFormatTouched: boolean;
  gradeChoice: string | null;
  gradeManual: string;
  subjects: string[];
  subjectOtherOn: boolean;
  subjectOther: string;
  countries: string[];
  open: boolean;
  countryOtherOn: boolean;
  countryOther: string;
  about: string;
}

type Stage = "intro" | "questions" | "loading" | "result" | "error";

const EMPTY: Draft = {
  level: null,
  levelOther: "",
  gradeFormat: "percentage",
  gradeFormatTouched: false,
  gradeChoice: null,
  gradeManual: "",
  subjects: [],
  subjectOtherOn: false,
  subjectOther: "",
  countries: [],
  open: false,
  countryOtherOn: false,
  countryOther: "",
  about: "",
};

const STEPS = ["Education", "Grades", "Subject", "Destination", "About you"] as const;
const STORAGE_KEY = "skolar-finder-v1";

function toAnswers(d: Draft): FinderAnswers {
  return {
    education: { level: d.level!, otherText: d.level === "other" ? d.levelOther.trim() || undefined : undefined },
    grade: {
      format: d.gradeFormat,
      choice: d.gradeChoice as FinderAnswers["grade"]["choice"],
      manualValue: d.gradeChoice === "manual" ? d.gradeManual.trim() : undefined,
    },
    subjects: { ids: d.subjects, otherText: d.subjectOtherOn ? d.subjectOther.trim() || undefined : undefined },
    destinations: {
      countries: d.countries,
      openToSuggestions: d.open,
      otherText: d.countryOtherOn ? d.countryOther.trim() || undefined : undefined,
    },
    about: d.about.trim() || undefined,
  };
}

function stepValid(step: number, d: Draft): boolean {
  switch (step) {
    case 0:
      return Boolean(d.level) && (d.level !== "other" || d.levelOther.trim().length > 0);
    case 1:
      return Boolean(d.gradeChoice) && (d.gradeChoice !== "manual" || d.gradeManual.trim().length > 0);
    case 2:
      return d.subjects.length > 0 || (d.subjectOtherOn && d.subjectOther.trim().length > 0);
    case 3:
      return d.countries.length > 0 || d.open || (d.countryOtherOn && d.countryOther.trim().length > 0);
    default:
      return true;
  }
}

/** Lightweight hook for analytics: listen for `skolar:finder` on window. */
function track(event: string, detail: Record<string, unknown> = {}) {
  try {
    window.dispatchEvent(new CustomEvent("skolar:finder", { detail: { event, ...detail } }));
  } catch {}
}

/* ───────────────────────────── Component ───────────────────────────── */

export function Finder({ platforms }: { platforms: PlatformLink[] }) {
  const [stage, setStage] = useState<Stage>("intro");
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [d, setD] = useState<Draft>(EMPTY);
  const [response, setResponse] = useState<FinderResponse | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reduce = useReducedMotion();

  const platformCountries = useMemo(
    () => new Set(platforms.map((p) => p.countryName).filter(Boolean) as string[]),
    [platforms],
  );
  const countries = useMemo(
    () => Array.from(new Set([...FINDER_COUNTRIES, ...platformCountries])),
    [platformCountries],
  );

  /* Restore an in-progress or finished session (e.g. after returning from WhatsApp). */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const s = JSON.parse(saved);
        if (s.draft) setD({ ...EMPTY, ...s.draft });
        if (s.response) {
          setResponse(s.response);
          setStage("result");
        } else if (s.stage === "questions") {
          setStage("questions");
          setStep(Math.min(4, s.step ?? 0));
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ draft: d, step, stage: stage === "loading" || stage === "error" ? "questions" : stage, response }),
      );
    } catch {}
  }, [d, step, stage, response, hydrated]);

  const update = useCallback((patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch })), []);

  const scrollToFinder = () => {
    const el = rootRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 84;
    if (Math.abs(window.scrollY - top) > 40) window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  };

  const start = () => {
    setStage("questions");
    setStep(0);
    track("start");
    requestAnimationFrame(scrollToFinder);
  };

  const goTo = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(next);
    track("step", { step: next + 1 });
  };

  useEffect(() => {
    if (stage === "questions") headingRef.current?.focus({ preventScroll: true });
  }, [step, stage]);

  const submit = async () => {
    setStage("loading");
    setError(null);
    track("submit");
    requestAnimationFrame(scrollToFinder);
    try {
      const res = await fetch("/api/finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toAnswers(d)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ code: data.error ?? "unknown", message: data.message ?? "Something went wrong. Please try again." });
        setStage("error");
        return;
      }
      setResponse(data as FinderResponse);
      setStage("result");
      track("complete", { ref: (data as FinderResponse).ref });
      requestAnimationFrame(scrollToFinder);
    } catch {
      setError({ code: "network", message: "We couldn't reach SKOLAR. Check your connection and try again." });
      setStage("error");
    }
  };

  const next = () => {
    if (!stepValid(step, d)) return;
    if (step < STEPS.length - 1) goTo(step + 1);
    else void submit();
  };

  const restart = () => {
    setD(EMPTY);
    setResponse(null);
    setStep(0);
    setStage("intro");
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
    requestAnimationFrame(scrollToFinder);
  };

  const editAnswers = () => {
    setResponse(null);
    setStage("questions");
    setDir(-1);
    setStep(0);
    requestAnimationFrame(scrollToFinder);
  };

  /* Auto-advance after single-choice answers feels faster; skip it when the user still needs to type. */
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);
  const autoAdvance = (fn: () => void, ok: boolean) => {
    fn();
    if (!ok) return;
    const at = step;
    window.setTimeout(() => {
      // Only advance if the student hasn't already moved on or back.
      if (stepRef.current !== at) return;
      setDir(1);
      setStep(at + 1);
      track("step", { step: at + 2 });
    }, reduce ? 0 : 320);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      next();
    }
  };

  const answered = stage !== "intro" ? describeAnswers(safeAnswers(d)).filter((_, i) => i < step || stage !== "questions") : [];

  /* ───────────── Render ───────────── */

  const isResult = stage === "result" && response;

  return (
    <div ref={rootRef} className="relative">
      {isResult ? (
        <FinderReport
          response={response!}
          answers={toAnswers(d)}
          platforms={platforms}
          onEdit={editAnswers}
          onRestart={restart}
        />
      ) : (
        <div className="grid items-start gap-10 lg:grid-cols-12 lg:gap-14">
          {/* Left column: intro copy, then a live profile as the student answers */}
          <div className={`lg:col-span-5 lg:pt-6 ${stage !== "intro" ? "hidden lg:block" : ""}`}>
            <AnimatePresence mode="wait" initial={false}>
              {stage === "intro" ? (
                <motion.div
                  key="intro"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                >
                  <p className="eyebrow flex items-center gap-3 text-gold-300">
                    <span className="h-px w-8 bg-gold-500" /> SKOLAR AI University Finder
                  </p>
                  <h1 className="display mt-6 text-balance text-[2.6rem] text-paper sm:text-[3.4rem] lg:text-[3.3rem] xl:text-[3.85rem]">
                    Find your best&#8209;fit university with <em className="font-[360] text-gold-300">SKOLAR&nbsp;AI.</em>
                  </h1>
                  <p className="mt-6 max-w-md text-[1.06rem] leading-relaxed text-paper/70">
                    Answer a few simple questions to explore universities that match your academic profile and
                    preferences.
                  </p>
                  <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
                    <button type="button" onClick={start} className="btn btn-gold group !min-h-[3.4rem] !px-7 text-base">
                      Start Now <ArrowRight size={18} className="link-arrow" />
                    </button>
                    <p className="text-sm text-paper/50">5 short questions · About 2 minutes</p>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="live"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="text-paper"
                >
                  <p className="eyebrow flex items-center gap-3 text-gold-300">
                    <span className="h-px w-8 bg-gold-500" /> Your profile so far
                  </p>
                  <p className="display mt-5 text-[2.1rem] leading-[1.1] text-paper/95">
                    {stage === "loading" ? "Preparing your guidance." : "Every answer shapes your results."}
                  </p>
                  <dl className="mt-8 border-t border-white/10">
                    {STEPS.slice(0, 4).map((label, i) => {
                      const row = answered[i];
                      return (
                        <div key={label} className="flex items-baseline justify-between gap-6 border-b border-white/10 py-3.5">
                          <dt className="text-[0.8rem] uppercase tracking-[0.12em] text-paper/40">{label}</dt>
                          <dd
                            className={`text-right text-[0.95rem] transition-colors duration-500 ${row ? "text-paper" : "text-paper/25"}`}
                          >
                            {row ? row.value : "—"}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  {stage === "questions" && (
                    <button
                      type="button"
                      onClick={restart}
                      className="mt-6 text-sm text-paper/45 underline-offset-4 transition-colors hover:text-paper hover:underline"
                    >
                      Start over
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right column: the finder panel */}
          <div className={`lg:col-span-7 ${stage !== "intro" ? "col-span-full" : ""}`}>
            {stage === "intro" && <IntroPanel onStart={start} />}

            {(stage === "questions" || stage === "loading" || stage === "error") && (
              <div
                className="relative overflow-hidden rounded-[26px] bg-paper text-navy-900 shadow-[0_40px_80px_-40px_rgb(0_0_0/0.7)] ring-1 ring-white/10"
                onKeyDown={stage === "questions" ? onKeyDown : undefined}
              >
                {stage === "questions" && (
                  <>
                    <Progress step={step} onJump={(i) => i < step && goTo(i)} onClose={restart} />
                    <div className="relative min-h-[460px] px-5 pb-6 pt-7 sm:px-9 sm:pt-9 lg:min-h-[520px]">
                      <AnimatePresence mode="wait" custom={dir} initial={false}>
                        <motion.div
                          key={step}
                          custom={dir}
                          initial={{ opacity: 0, x: reduce ? 0 : dir * 28 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: reduce ? 0 : dir * -28 }}
                          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                        >
                          {step === 0 && (
                            <StepEducation d={d} update={update} headingRef={headingRef} autoAdvance={autoAdvance} />
                          )}
                          {step === 1 && (
                            <StepGrade d={d} update={update} headingRef={headingRef} autoAdvance={autoAdvance} />
                          )}
                          {step === 2 && <StepSubjects d={d} update={update} headingRef={headingRef} />}
                          {step === 3 && (
                            <StepDestination
                              d={d}
                              update={update}
                              headingRef={headingRef}
                              countries={countries}
                              platformCountries={platformCountries}
                            />
                          )}
                          {step === 4 && <StepAbout d={d} update={update} headingRef={headingRef} />}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-navy-900/8 bg-paper/95 px-5 py-4 backdrop-blur sm:px-9">
                      <button
                        type="button"
                        onClick={() => (step === 0 ? restart() : goTo(step - 1))}
                        className="btn btn-ghost-light !min-h-11 !px-4"
                      >
                        <ArrowLeft size={17} /> Back
                      </button>
                      <button
                        type="button"
                        onClick={next}
                        disabled={!stepValid(step, d)}
                        className={`btn group !min-h-11 ${step === 4 ? "btn-gold" : "btn-navy"}`}
                      >
                        {step === 4 ? (d.about.trim() ? "See my results" : "Skip & see my results") : "Next"}
                        <ArrowRight size={17} className="link-arrow" />
                      </button>
                    </div>
                  </>
                )}
                {stage === "loading" && <FinderLoading answers={describeAnswers(toAnswers(d))} />}
                {stage === "error" && error && (
                  <FinderError error={error} onRetry={submit} onEdit={() => setStage("questions")} answers={toAnswers(d)} />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* Partial answers for the live recap (tolerates unanswered fields). */
function safeAnswers(d: Draft): FinderAnswers {
  return {
    education: { level: d.level ?? "other", otherText: d.levelOther || undefined },
    grade: { format: d.gradeFormat, choice: (d.gradeChoice ?? "manual") as FinderAnswers["grade"]["choice"], manualValue: d.gradeManual || "—" },
    subjects: { ids: d.subjects, otherText: d.subjectOtherOn ? d.subjectOther || undefined : undefined },
    destinations: { countries: d.countries, openToSuggestions: d.open, otherText: d.countryOtherOn ? d.countryOther || undefined : undefined },
    about: d.about,
  };
}

/* ───────────────────────────── Intro panel ───────────────────────────── */

function IntroPanel({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[26px] sm:aspect-[16/12] lg:aspect-[7/6]">
        <Image
          src="/images/library-long-room.webp"
          alt="The long, book-lined hall of a historic university library"
          fill
          priority
          sizes="(min-width: 1024px) 58vw, 100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-navy-950/85 via-navy-950/15 to-navy-950/10" />
      </div>
      {/* Route card listing the five questions */}
      <div className="absolute inset-x-4 bottom-4 sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-[360px]">
        <div className="rounded-[20px] bg-paper/95 p-5 text-navy-900 shadow-2xl backdrop-blur-md sm:p-6">
          <div className="flex items-center justify-between">
            <p className="eyebrow text-ink-soft">What we&rsquo;ll ask</p>
            <p className="text-xs text-ink-faint">≈ 2 min</p>
          </div>
          <ol className="relative mt-4 space-y-2.5">
            <span className="absolute bottom-2 left-[5px] top-2 border-l border-dashed border-navy-900/25" aria-hidden />
            {["Your highest education", "Your grades", "What you'd like to study", "Where you'd like to study", "Anything else about you"].map(
              (q, i) => (
                <li key={q} className="relative flex items-center gap-3.5 text-[0.93rem]">
                  <span className={`relative h-[11px] w-[11px] rounded-full border-2 ${i === 0 ? "border-gold-500 bg-gold-500" : "border-navy-900/30 bg-paper"}`} />
                  <span className={i === 0 ? "font-semibold" : "text-ink-soft"}>{q}</span>
                </li>
              ),
            )}
          </ol>
          <button type="button" onClick={onStart} className="btn btn-navy group mt-5 w-full">
            Begin with question 1 <ArrowRight size={17} className="link-arrow" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── Progress ───────────────────────────── */

function Progress({ step, onJump, onClose }: { step: number; onJump: (i: number) => void; onClose: () => void }) {
  return (
    <div className="border-b border-navy-900/8 px-5 pb-4 pt-5 sm:px-9">
      <div className="flex items-center justify-between">
        <p className="text-[0.8rem] font-medium text-ink-soft" aria-live="polite">
          Question <span className="font-semibold text-navy-900">{step + 1}</span> of {STEPS.length}
          <span className="text-ink-faint"> · {STEPS[step]}</span>
        </p>
        <button
          type="button"
          onClick={onClose}
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition-colors hover:bg-navy-900/5 hover:text-navy-900"
          aria-label="Close and start over"
        >
          <Close size={17} />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={5} aria-valuenow={step + 1}>
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => onJump(i)}
            disabled={i >= step}
            className="group py-1 text-left disabled:cursor-default"
            aria-label={i < step ? `Go back to ${label}` : label}
          >
            <span className="block h-[3px] overflow-hidden rounded-full bg-navy-900/10">
              <span
                className="block h-full rounded-full bg-gold-500 transition-transform duration-700 ease-[cubic-bezier(.22,1,.36,1)]"
                style={{ transform: `scaleX(${i <= step ? 1 : 0})`, transformOrigin: "left" }}
              />
            </span>
            <span
              className={`mt-2 hidden text-[0.72rem] font-medium tracking-wide sm:block ${
                i === step ? "text-navy-900" : i < step ? "text-ink-soft group-hover:text-navy-900" : "text-ink-faint"
              }`}
            >
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────── Steps ───────────────────────────── */

type StepProps = {
  d: Draft;
  update: (p: Partial<Draft>) => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
};

function QuestionHead({ headingRef, title, help }: { headingRef: StepProps["headingRef"]; title: string; help?: string }) {
  return (
    <div className="mb-6 sm:mb-7">
      <h2 ref={headingRef} tabIndex={-1} className="display text-[1.75rem] leading-[1.12] text-navy-900 outline-none sm:text-[2.1rem]">
        {title}
      </h2>
      {help && <p className="mt-2.5 text-[0.95rem] text-ink-soft">{help}</p>}
    </div>
  );
}

function StepEducation({ d, update, headingRef, autoAdvance }: StepProps & { autoAdvance: (fn: () => void, ok: boolean) => void }) {
  const otherRef = useRef<HTMLInputElement>(null);
  const choose = (level: EducationLevel) => {
    const patch: Partial<Draft> = { level };
    if (!d.gradeFormatTouched && level !== d.level) {
      patch.gradeFormat = DEFAULT_GRADE_FORMAT[level];
      patch.gradeChoice = null;
    }
    if (level === "other") {
      update(patch);
      setTimeout(() => otherRef.current?.focus(), 50);
    } else autoAdvance(() => update(patch), true);
  };
  return (
    <div role="radiogroup" aria-label="Highest level of education">
      <QuestionHead headingRef={headingRef} title="What is the highest level of education you have completed?" />
      <div className="grid items-start gap-2.5 sm:grid-cols-2">
        {EDUCATION_LEVELS.map((l) => (
          <OptionTile key={l.id} selected={d.level === l.id} onClick={() => choose(l.id)} label={l.label} hint={l.hint}>
            {l.id === "other" && d.level === "other" ? (
              <TextField
                ref={otherRef}
                label="Which qualification did you complete?"
                placeholder="e.g. IB Diploma, A-Levels, Foundation year"
                value={d.levelOther}
                maxLength={120}
                onChange={(e) => update({ levelOther: e.target.value })}
              />
            ) : null}
          </OptionTile>
        ))}
      </div>
    </div>
  );
}

function StepGrade({ d, update, headingRef, autoAdvance }: StepProps & { autoAdvance: (fn: () => void, ok: boolean) => void }) {
  const manualRef = useRef<HTMLInputElement>(null);
  const placeholder: Record<GradeFormat, string> = {
    percentage: "e.g. 78.4%",
    cgpa10: "e.g. 7.9",
    gpa4: "e.g. 3.2",
    other: "e.g. B+, 2:1, 14/20, 1.7",
  };
  return (
    <div>
      <QuestionHead
        headingRef={headingRef}
        title="What percentage or grade did you achieve?"
        help={gradeQuestionContext(d.level)}
      />
      <div className="mb-5">
        <p className="mb-2 text-[0.78rem] font-medium uppercase tracking-[0.12em] text-ink-faint" id="grade-format-label">
          Grading system
        </p>
        <div
          role="radiogroup"
          aria-labelledby="grade-format-label"
          className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto rounded-full bg-stone/70 p-1 sm:mx-0 sm:inline-flex"
        >
          {GRADE_FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={d.gradeFormat === f.id}
              onClick={() =>
                update({
                  gradeFormat: f.id,
                  gradeFormatTouched: true,
                  gradeChoice: d.gradeChoice === "manual" ? "manual" : null,
                })
              }
              className={`shrink-0 rounded-full px-3.5 py-2 text-[0.85rem] font-medium transition-all duration-300 ${
                d.gradeFormat === f.id ? "bg-white text-navy-900 shadow-sm" : "text-ink-soft hover:text-navy-900"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div role="radiogroup" aria-label="Your result" className="grid items-start gap-2.5 sm:grid-cols-2">
        {GRADE_RANGES[d.gradeFormat].map((r) => (
          <OptionTile
            key={r.id}
            selected={d.gradeChoice === r.id}
            onClick={() => autoAdvance(() => update({ gradeChoice: r.id }), true)}
            label={r.label}
            hint={r.detail}
          />
        ))}
        <OptionTile
          selected={d.gradeChoice === "manual"}
          onClick={() => {
            update({ gradeChoice: "manual" });
            setTimeout(() => manualRef.current?.focus(), 30);
          }}
          label="Enter manually"
          hint="Type your exact result"
        >
          <TextField
            ref={manualRef}
            label="Your exact result"
            placeholder={placeholder[d.gradeFormat]}
            value={d.gradeManual}
            maxLength={60}
            inputMode={d.gradeFormat === "other" ? "text" : "decimal"}
            onChange={(e) => update({ gradeManual: e.target.value, gradeChoice: "manual" })}
            onFocus={() => d.gradeChoice !== "manual" && d.gradeManual && update({ gradeChoice: "manual" })}
          />
        </OptionTile>
      </div>
    </div>
  );
}

function StepSubjects({ d, update, headingRef }: StepProps) {
  const otherRef = useRef<HTMLInputElement>(null);
  const count = d.subjects.length + (d.subjectOtherOn ? 1 : 0);
  const full = count >= MAX_SUBJECTS;
  const toggle = (id: string) => {
    if (id === "undecided") return update({ subjects: d.subjects.includes(id) ? [] : ["undecided"], subjectOtherOn: false });
    const without = d.subjects.filter((s) => s !== "undecided");
    update({ subjects: without.includes(id) ? without.filter((s) => s !== id) : full ? without : [...without, id] });
  };
  return (
    <div>
      <QuestionHead
        headingRef={headingRef}
        title="What would you like to study?"
        help={`Choose up to ${MAX_SUBJECTS} areas. Not sure yet is a perfectly good answer.`}
      />
      <div className="flex flex-wrap gap-2" aria-label="Subject areas">
        {SUBJECTS.map((s) => {
          const on = d.subjects.includes(s.id);
          return (
            <Chip key={s.id} selected={on} onClick={() => toggle(s.id)} disabled={!on && full && s.id !== "undecided"}>
              {s.label}
            </Chip>
          );
        })}
        <Chip
          selected={d.subjectOtherOn}
          disabled={!d.subjectOtherOn && full}
          onClick={() => {
            const on = !d.subjectOtherOn;
            update({ subjectOtherOn: on, subjects: d.subjects.filter((x) => x !== "undecided") });
            if (on) setTimeout(() => otherRef.current?.focus(), 30);
          }}
        >
          Other
        </Chip>
      </div>
      {d.subjectOtherOn && (
        <TextField
          ref={otherRef}
          className="mt-4 max-w-md"
          label="Other subject"
          placeholder="e.g. Veterinary science, Aviation, Psychology"
          maxLength={120}
          value={d.subjectOther}
          onChange={(e) => update({ subjectOther: e.target.value })}
        />
      )}
      <p className="mt-5 text-[0.82rem] text-ink-faint">
        {count} of {MAX_SUBJECTS} selected
      </p>
    </div>
  );
}

function StepDestination({
  d,
  update,
  headingRef,
  countries,
  platformCountries,
}: StepProps & { countries: string[]; platformCountries: Set<string> }) {
  const otherRef = useRef<HTMLInputElement>(null);
  const count = d.countries.length + (d.countryOtherOn ? 1 : 0);
  const full = count >= MAX_COUNTRIES;
  return (
    <div>
      <QuestionHead
        headingRef={headingRef}
        title="Which country would you prefer to study in?"
        help={`Pick up to ${MAX_COUNTRIES}, or let us suggest options.`}
      />
      <OptionTile
        multi
        selected={d.open}
        onClick={() => update({ open: !d.open })}
        label="I'm open to suggestions"
        hint="We'll suggest destinations that suit your profile"
      />
      <div className="mt-5 flex flex-wrap gap-2" aria-label="Countries">
        {countries.map((c) => {
          const on = d.countries.includes(c);
          return (
            <Chip
              key={c}
              selected={on}
              disabled={!on && full}
              dot={platformCountries.has(c)}
              onClick={() => update({ countries: on ? d.countries.filter((x) => x !== c) : [...d.countries, c] })}
            >
              {c}
            </Chip>
          );
        })}
        <Chip
          selected={d.countryOtherOn}
          disabled={!d.countryOtherOn && full}
          onClick={() => {
            update({ countryOtherOn: !d.countryOtherOn });
            if (!d.countryOtherOn) setTimeout(() => otherRef.current?.focus(), 30);
          }}
        >
          Other
        </Chip>
      </div>
      {d.countryOtherOn && (
        <TextField
          ref={otherRef}
          className="mt-4 max-w-md"
          label="Other country"
          placeholder="Type a country"
          maxLength={60}
          value={d.countryOther}
          onChange={(e) => update({ countryOther: e.target.value })}
        />
      )}
      {platformCountries.size > 0 && (
        <p className="mt-5 flex items-center gap-2 text-[0.8rem] text-ink-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-500" /> SKOLAR has a dedicated platform for this destination
        </p>
      )}
    </div>
  );
}

function StepAbout({ d, update, headingRef }: StepProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const addPrompt = (p: string) => {
    const sep = d.about.trim() ? (d.about.endsWith("\n") ? "" : "\n") : "";
    const next = (d.about + sep + p + " ").slice(0, ABOUT_MAX_CHARS);
    update({ about: next });
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(next.length, next.length);
      }
    });
  };
  return (
    <div>
      <QuestionHead
        headingRef={headingRef}
        title="Would you like to tell us anything else about yourself?"
        help="Optional. Career goals, budget, timing, a preferred course or anything that matters to your decision."
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {ABOUT_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => addPrompt(p)}
            className="rounded-full border border-dashed border-navy-900/20 px-3 py-1.5 text-[0.8rem] text-ink-soft transition-colors hover:border-navy-900/50 hover:text-navy-900"
          >
            + {p.replace("…", "")}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="sr-only">Anything else about yourself</span>
        <textarea
          ref={ref}
          value={d.about}
          maxLength={ABOUT_MAX_CHARS}
          onChange={(e) => update({ about: e.target.value })}
          rows={6}
          placeholder="For example: I want to become a software engineer, my family budget is limited, and I'd like to start in September next year."
          className="w-full resize-none rounded-2xl border border-navy-900/15 bg-white/70 px-4 py-3.5 text-[0.98rem] leading-relaxed text-navy-900 placeholder:text-ink-faint focus:border-navy-900 focus:bg-white focus:outline-none"
        />
      </label>
      <div className="mt-2 flex items-start justify-between gap-4 text-[0.78rem] text-ink-faint">
        <p>Please don&rsquo;t include your name, phone number or other contact details.</p>
        <p className="shrink-0 tabular-nums">
          {d.about.length}/{ABOUT_MAX_CHARS}
        </p>
      </div>
    </div>
  );
}
