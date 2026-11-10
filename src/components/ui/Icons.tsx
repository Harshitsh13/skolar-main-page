import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 20): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

export const ArrowRight = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 12h15M13 6l6 6-6 6" /></svg>
);
export const ArrowLeft = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M20 12H5M11 6l-6 6 6 6" /></svg>
);
export const ArrowUpRight = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M7 17 17 7M8 7h9v9" /></svg>
);
export const Check = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const Close = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const Menu = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 8h16M4 16h16" /></svg>
);
export const Refresh = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
);
export const Pencil = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" /></svg>
);
export const Plane = ({ size, ...p }: P) => (
  <svg width={size ?? 20} height={size ?? 20} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <path d="M21.5 15.6v-1.9L13.6 9V3.6a1.6 1.6 0 1 0-3.2 0V9l-7.9 4.7v1.9l7.9-2.4v5.2l-2.1 1.6v1.5l3.7-1.1 3.7 1.1v-1.5l-2.1-1.6v-5.2l7.9 2.4Z" />
  </svg>
);
export const WhatsApp = ({ size, ...p }: P) => (
  <svg width={size ?? 20} height={size ?? 20} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.23 8.23 0 1 1 6.98 3.86Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.17.24-.64.8-.78.97-.14.17-.29.18-.54.06a6.73 6.73 0 0 1-3.37-2.94c-.25-.44.25-.41.72-1.36.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.42h-.48a.92.92 0 0 0-.66.31c-.23.25-.87.85-.87 2.07s.89 2.4 1.01 2.56c.12.17 1.75 2.67 4.24 3.74 1.57.68 2.19.74 2.98.62.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.14-1.18-.06-.11-.22-.17-.47-.29Z" />
  </svg>
);
