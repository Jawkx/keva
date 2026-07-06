import { cn } from "@/lib/utils";

type WordmarkProps = {
  /** "sm" for the sidebar/header, "lg" for the marketing/auth hero. */
  size?: "sm" | "lg";
  className?: string;
  /** Extra classes for the "eva" text — e.g. to hide it when the sidebar collapses. */
  textClassName?: string;
};

// The logo PNG is a big "K"; "eva" is rendered as text so the pair reads as the
// "Keva" wordmark. Aligning an image glyph with text is what made earlier
// versions fiddly, so this derives the alignment instead of guessing it:
//
//   items-baseline  Flexbox aligns an <img>'s bottom edge to the text baseline.
//                   That sidesteps the font's descender space entirely — the
//                   reason bottom-aligning the boxes (items-end) left "eva"
//                   floating above the "K" and needed per-size translate hacks.
//
// The icon has transparent padding baked in (measured once from the 192px
// canvas: the glyph occupies x[29..162] y[14..178]). We express that padding as
// FRACTIONS of the image, so a single formula aligns the pair at any size:
//   BOTTOM_PAD  transparent space below the glyph → nudge the K down by that much
//               so its visual bottom (not its box bottom) lands on the baseline.
//   RIGHT_PAD   transparent space right of the glyph → pull "eva" left by that
//               much so the two kern as one word instead of floating apart.
// Re-measure if the icon asset changes.
const BOTTOM_PAD = 0.068;
const RIGHT_PAD = 0.151;

// img = rendered "K" box in px; font = "eva" font-size in px (tuned to read at
// the same visual weight as the glyph).
const SIZES = {
  sm: { img: 32, font: 29 },
  lg: { img: 44, font: 42 },
} as const;

export function Wordmark({ size = "sm", className, textClassName }: WordmarkProps) {
  const { img, font } = SIZES[size];
  return (
    <span className={cn("inline-flex items-baseline", className)}>
      <img
        src="/android-chrome-192x192.png"
        alt="K"
        className="object-contain"
        style={{ width: img, height: img, transform: `translateY(${img * BOTTOM_PAD}px)` }}
      />
      <span
        className={cn("font-heading font-semibold leading-none text-primary", textClassName)}
        style={{ fontSize: font, marginLeft: -(img * RIGHT_PAD) }}
      >
        eva
      </span>
    </span>
  );
}
