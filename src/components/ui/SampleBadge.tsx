/** Marks illustrative content shown only while real content isn't published yet. */
export function SampleBadge({ children = "Sample content", className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-dashed border-gold-500/60 bg-gold-100/80 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-gold-600 ${className}`}
      title="Illustrative content: replaced automatically once real content is published from the SKOLAR Control Center."
    >
      <span className="h-1.5 w-1.5 rounded-full bg-gold-500" />
      {children}
    </span>
  );
}
