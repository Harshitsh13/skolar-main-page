"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "@/components/ui/Icons";

/** Horizontal, snap-scrolling rail used once there are 3+ destination platforms. */
export function DestinationRail({ children, count }: { children: React.ReactNode; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    el.scrollBy({ left: dir * ((card?.offsetWidth ?? 400) + 20), behavior: "smooth" });
  };

  return (
    <div>
      <div
        ref={ref}
        className="scrollbar-none -mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-px-5 px-5 pb-2 md:-mx-8 md:scroll-px-8 md:px-8 xl:mx-0 xl:scroll-px-0 xl:px-0"
        role="region"
        aria-label={`${count} SKOLAR destination platforms`}
      >
        {children}
      </div>
      <div className="mt-8 flex items-center justify-between">
        <p className="text-sm text-paper/45">{count} platforms</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => scroll(-1)}
            disabled={edge.start}
            className="grid h-11 w-11 place-items-center rounded-full border border-white/20 transition-colors hover:border-white/60 disabled:opacity-30"
            aria-label="Previous platforms"
          >
            <ArrowLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => scroll(1)}
            disabled={edge.end}
            className="grid h-11 w-11 place-items-center rounded-full border border-white/20 transition-colors hover:border-white/60 disabled:opacity-30"
            aria-label="Next platforms"
          >
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
