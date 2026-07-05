import { cn } from "@/lib/utils";

type WordmarkProps = {
  /** "sm" for the sidebar, "lg" for the marketing/auth hero. */
  size?: "sm" | "lg";
  className?: string;
  /** Extra classes for the "eva" text — e.g. to hide it when the sidebar collapses. */
  textClassName?: string;
};

// The logo PNG is a big "K"; "eva" is rendered as text so the pair reads as the
// "Keva" wordmark. Two size presets, each with tuned nudges:
//   -ml-*        The icon has ~15% transparent side padding baked in, so the
//                glyph's visual right edge stops short of its box. This negative
//                left margin (scales with the icon) pulls "eva" back over that
//                padding so the two kern as one word instead of floating apart.
//   translate-y  We bottom-align the boxes (items-end), but the font reserves
//                descender space below the baseline, so "eva" (no descenders)
//                floats above the glyph. This nudge drops the baseline onto the
//                glyph's visual bottom; it tracks the font's descent, so it grows
//                with the text size (hence ~1px at sm but ~13px at lg).
// Values are measured against this specific font + icon; re-check if either changes.
const SIZES = {
  sm: { img: "size-8", text: "text-[1.8rem]", nudge: "-ml-1 translate-y-px" },
  lg: { img: "size-11", text: "text-[2.6rem]", nudge: "-ml-1.5 translate-y-[13px]" },
} as const;

export function Wordmark({ size = "sm", className, textClassName }: WordmarkProps) {
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex items-end", className)}>
      <img src="/android-chrome-192x192.png" alt="K" className={cn(s.img, "object-contain")} />
      <span
        className={cn(
          "font-heading font-semibold leading-none text-primary",
          s.text,
          s.nudge,
          textClassName,
        )}
      >
        eva
      </span>
    </span>
  );
}
