import Image from "next/image";

/**
 * The official SKOLAR logo. These are background-free extractions of the
 * supplied logo files: artwork and proportions are unchanged.
 */
export function Logo({
  tone = "dark",
  height = 44,
  className,
  priority,
}: {
  /** "dark" = for dark backgrounds (white artwork); "light" = for light backgrounds. */
  tone?: "dark" | "light";
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  const src = tone === "dark" ? "/brand/skolar-logo-on-dark.png" : "/brand/skolar-logo-on-light.png";
  const ratio = tone === "dark" ? 475 / 404 : 444 / 369;
  return (
    <Image
      src={src}
      alt="SKOLAR"
      width={Math.round(height * ratio)}
      height={height}
      className={className}
      priority={priority}
      sizes={`${Math.round(height * ratio * 2)}px`}
    />
  );
}
