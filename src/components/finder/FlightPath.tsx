/**
 * The dotted flight path from the SKOLAR logo, used as a loader and an accent.
 * `animate` sends the dashes along the curve; the plane rides at the end.
 */
export function FlightPath({ animate = false, className = "" }: { animate?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 240 120" className={className} aria-hidden fill="none">
      <path d="M6 114 C 70 108, 120 70, 150 46 S 214 10, 228 8" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />
      <path
        d="M6 114 C 70 108, 120 70, 150 46 S 214 10, 228 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="0.1 6"
        style={animate ? { animation: "dash-travel 1.1s linear infinite" } : undefined}
      />
      <g transform="translate(228 8) rotate(62)">
        <path
          d="M7.5 5.6v-.9L3.9 2.6V.7a.7.7 0 0 0-1.4 0v1.9L-1.1 4.7v.9l3.6-1.1v2.4l-.9.7v.7l1.6-.5 1.6.5v-.7l-.9-.7V4.5Z"
          fill="var(--color-gold-500)"
          transform="translate(-3.2 -4) scale(1.15)"
        />
      </g>
    </svg>
  );
}
