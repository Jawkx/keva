import type { ComponentType, ReactNode } from "react";
import {
  IconFileSpreadsheet,
  IconFileText,
  IconFileTypePdf,
  IconFileTypeSvg,
  IconMarkdown,
  IconPhoto,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Wordmark } from "./Wordmark";

// Decorative-only chip that mirrors the app's property tags (e.g. `category=finance`).
function Chip({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-md px-2.5 py-1 text-[13px] font-medium ring-1",
        accent
          ? "bg-primary/15 text-primary ring-primary/25"
          : "bg-white/[0.06] text-white/55 ring-white/10",
      )}
    >
      {children}
    </span>
  );
}

type MockFile = {
  name: string;
  meta: string;
  Icon: ComponentType<{ className?: string }>;
  chips: [label: string, accent: boolean][];
};

function FileCard({ file }: { file: MockFile }) {
  // The trailing right margin is baked into the card so the two marquee copies
  // tile with even spacing and the -50% loop stays seamless (no track gap).
  return (
    <div className="mr-6 w-72 shrink-0 rounded-xl border border-white/10 bg-[#141922] p-5">
      <div className="flex items-center gap-3.5">
        <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <file.Icon className="size-[22px]" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-base font-medium text-white/90">{file.name}</div>
          <div className="text-[13px] text-white/40">{file.meta}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {file.chips.map(([label, accent]) => (
          <Chip key={label} accent={accent}>
            {label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

const FILES: MockFile[] = [
  {
    name: "annual-report.pdf",
    meta: "PDF · 2.4 MB",
    Icon: IconFileTypePdf,
    chips: [["category=finance", false], ["year=2026", true]],
  },
  { name: "brand-logo.svg", meta: "SVG · 12 KB", Icon: IconFileTypeSvg, chips: [["project=brand", false]] },
  {
    name: "q2-budget.xlsx",
    meta: "XLSX · 88 KB",
    Icon: IconFileSpreadsheet,
    chips: [["category=finance", false], ["status=final", true]],
  },
  { name: "rooftop.jpg", meta: "JPEG · 3.1 MB", Icon: IconPhoto, chips: [["album=travel", false]] },
  {
    name: "contract.pdf",
    meta: "PDF · 480 KB",
    Icon: IconFileText,
    chips: [["type=legal", false], ["signed=true", true]],
  },
  { name: "notes.md", meta: "MD · 4 KB", Icon: IconMarkdown, chips: [["pinned=true", false]] },
];

/** One copy of the file row; rendered twice inside the marquee track. */
function FileRow({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <div className="flex shrink-0" aria-hidden={ariaHidden}>
      {FILES.map((file) => (
        <FileCard key={file.name} file={file} />
      ))}
    </div>
  );
}

/**
 * The dark brand panel shown beside the auth form on large screens. A minimal,
 * typography-led headline sits above a full-bleed marquee of tagged file cards
 * that scrolls horizontally forever — a live preview of the real product (files
 * carry your own property tags). Edges fade out via a mask; the scroll respects
 * prefers-reduced-motion.
 */
function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-[#0b0e13] p-14 text-white lg:flex lg:flex-col">
      {/* One faint light from the top edge — subtle depth, no busy texture. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.035] to-transparent"
      />

      <div className="relative flex h-full flex-col">
        <Wordmark size="lg" />

        <div className="flex flex-1 flex-col justify-center gap-12">
          <div>
            <h2 className="max-w-md font-heading text-[2.75rem] leading-[1.05] font-semibold tracking-tight text-balance">
              Your files,
              <br />
              <span className="text-primary">structured.</span>
            </h2>
            <div className="mt-7 h-px w-12 bg-primary/70" />
            <p className="mt-7 text-[15px] leading-relaxed text-white/45">
              Tag anything. Find it in seconds.
            </p>
          </div>

          {/* Full-bleed marquee: break out of the panel padding, fade both edges. */}
          <div
            className="-mx-14 [mask-image:linear-gradient(to_right,transparent,black_7%,black_93%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_7%,black_93%,transparent)]"
          >
            <div className="flex w-max animate-[marquee-x_50s_linear_infinite] motion-reduce:animate-none">
              <FileRow />
              <FileRow ariaHidden />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Two-column auth frame: brand panel (lg+) beside the form column. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />
      <main className="flex flex-col items-center justify-center px-6 py-12 lg:border-l lg:border-border">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <div className="flex justify-center lg:hidden">
            <Wordmark size="lg" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
