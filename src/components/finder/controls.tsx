"use client";

import { forwardRef } from "react";
import { Check } from "@/components/ui/Icons";

/** Large answer tile used for single- and multi-select questions. */
export function OptionTile({
  selected,
  onClick,
  label,
  hint,
  multi,
  disabled,
  badge,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  hint?: string;
  multi?: boolean;
  disabled?: boolean;
  badge?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`group relative rounded-2xl border transition-[border-color,background-color,box-shadow] duration-300 ${
        selected
          ? "border-navy-900 bg-white shadow-[0_0_0_1px_var(--color-navy-900),0_14px_30px_-18px_rgb(23_22_39/0.5)]"
          : "border-navy-900/12 bg-white/60 hover:border-navy-900/35 hover:bg-white"
      } ${disabled ? "opacity-45" : ""}`}
    >
      <button
        type="button"
        role={multi ? "checkbox" : "radio"}
        aria-checked={selected}
        disabled={disabled}
        onClick={onClick}
        className="flex w-full items-start gap-3.5 rounded-2xl px-4 py-3.5 text-left sm:px-5 sm:py-4"
      >
        <span
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center border transition-colors duration-300 ${
            multi ? "rounded-md" : "rounded-full"
          } ${selected ? "border-navy-900 bg-navy-900 text-paper" : "border-navy-900/25 bg-white text-transparent"}`}
        >
          <Check size={13} strokeWidth={2.4} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[0.98rem] font-semibold leading-snug text-navy-900">{label}</span>
            {badge}
          </span>
          {hint && <span className="mt-0.5 block text-[0.82rem] leading-snug text-ink-soft">{hint}</span>}
        </span>
      </button>
      {children && <div className="px-4 pb-4 sm:px-5">{children}</div>}
    </div>
  );
}

export const TextField = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label: string }
>(function TextField({ label, className = "", ...props }, ref) {
  return (
    <label className={`block ${className}`}>
      <span className="sr-only">{label}</span>
      <input
        ref={ref}
        {...props}
        className="w-full rounded-xl border border-navy-900/15 bg-paper px-3.5 py-3 text-[0.98rem] text-navy-900 placeholder:text-ink-faint focus:border-navy-900 focus:bg-white focus:outline-none focus:ring-0"
      />
    </label>
  );
});

export function Chip({
  selected,
  onClick,
  children,
  disabled,
  dot,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  dot?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-[0.92rem] font-medium transition-all duration-300 ${
        selected
          ? "border-navy-900 bg-navy-900 text-paper"
          : "border-navy-900/15 bg-white/70 text-navy-900 hover:border-navy-900/40 hover:bg-white"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      {selected ? <Check size={14} strokeWidth={2.4} /> : null}
      {children}
      {dot && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${selected ? "bg-gold-300" : "bg-gold-500"}`}
          aria-label="SKOLAR platform"
          title="SKOLAR has a dedicated platform for this destination"
        />
      )}
    </button>
  );
}
