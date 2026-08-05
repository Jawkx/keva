import { FileCode2, FileSpreadsheet, FileText, Image, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { brandIconUrl } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { ProductBetaBadge } from "./ProductBetaBadge";

function Keyhole({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 132" fill="none" className={className} aria-hidden>
      <circle cx="50" cy="42" r="30" stroke="currentColor" strokeWidth="6" />
      <path
        d="M40 66 L31 116 Q30 124 38 124 L62 124 Q70 124 69 116 L60 66"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Wordmark({ className, mark }: { className?: string; mark?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <img
        src={brandIconUrl}
        alt=""
        className={cn("size-9 rounded-[10px] object-cover ring-1", mark ?? "ring-white/15")}
      />
      <span className="font-heading text-[26px] leading-none font-semibold tracking-tight">
        Keva
      </span>
      <ProductBetaBadge />
    </span>
  );
}

function Chip({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-md px-2.5 py-1 text-[13px] ring-1 ring-inset",
        accent
          ? "bg-white/90 font-medium text-neutral-900 ring-white/0"
          : "bg-white/[0.04] font-medium text-white/55 ring-white/10",
      )}
    >
      {children}
    </span>
  );
}

type MockFile = {
  name: string;
  meta: string;
  icon: LucideIcon;
  chips: [label: string, accent: boolean][];
};

function FileCard({ file }: { file: MockFile }) {
  const Icon = file.icon;
  return (
    <div className="mr-5 w-72 shrink-0 rounded-xl bg-white/[0.03] p-5 ring-1 ring-inset ring-white/[0.08]">
      <div className="flex items-center gap-3.5">
        <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-white/70 ring-1 ring-inset ring-white/10">
          <Icon className="size-[22px]" />
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
    icon: FileText,
    chips: [
      ["category=finance", false],
      ["year=2026", true],
    ],
  },
  {
    name: "brand-logo.svg",
    meta: "SVG · 12 KB",
    icon: FileCode2,
    chips: [["project=brand", false]],
  },
  {
    name: "q2-budget.xlsx",
    meta: "XLSX · 88 KB",
    icon: FileSpreadsheet,
    chips: [
      ["category=finance", false],
      ["status=final", true],
    ],
  },
  {
    name: "rooftop.jpg",
    meta: "JPEG · 3.1 MB",
    icon: Image,
    chips: [["album=travel", false]],
  },
  {
    name: "contract.pdf",
    meta: "PDF · 480 KB",
    icon: FileText,
    chips: [
      ["type=legal", false],
      ["signed=true", true],
    ],
  },
  { name: "notes.md", meta: "MD · 4 KB", icon: FileText, chips: [["pinned=true", false]] },
];

function FileRow({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <div className="flex shrink-0" aria-hidden={ariaHidden}>
      {FILES.map((file) => (
        <FileCard key={file.name} file={file} />
      ))}
    </div>
  );
}

function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-[#0a0a0b] p-14 text-white lg:flex lg:flex-col">
      {/* Blueprint grid — reads as "structured", fades toward the edges */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] [background-size:46px_46px] [mask-image:radial-gradient(ellipse_120%_90%_at_20%_10%,black,transparent_70%)]"
      />
      {/* Soft top-left light source */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[32rem] rounded-full bg-white/[0.05] blur-3xl"
      />
      {/* Oversized keyhole watermark bleeding off the bottom-right — the vault motif */}
      <Keyhole className="pointer-events-none absolute -right-24 -bottom-28 h-[32rem] w-auto text-white/[0.028]" />

      <div className="relative flex h-full flex-col">
        <div className="flex items-center gap-2">
          <span className="font-heading text-[26px] leading-none font-semibold tracking-tight">
            Keva
          </span>
          <ProductBetaBadge tone="inverse" />
        </div>

        <div className="flex flex-1 flex-col justify-center gap-12">
          <div className="flex max-w-xl items-center gap-6">
            <img
              src={brandIconUrl}
              alt=""
              className="size-[5.75rem] shrink-0 rounded-[22px] object-cover ring-1 ring-white/15"
            />
            <h2 className="font-heading text-[2.75rem] leading-[1.05] font-semibold tracking-tight text-balance">
              Your files,
              <br />
              <span className="relative inline-block">
                structured.
                <span
                  aria-hidden
                  className="absolute -bottom-1 left-0 h-[3px] w-full rounded-full bg-gradient-to-r from-white/60 to-white/5"
                />
              </span>
            </h2>
          </div>

          <div className="-mx-14 [mask-image:linear-gradient(to_right,transparent,black_7%,black_93%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_7%,black_93%,transparent)]">
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

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1.05fr_1fr]">
      <BrandPanel />
      <main className="flex flex-col items-center justify-center px-6 py-12 lg:border-l lg:border-border">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <div className="flex justify-center lg:hidden">
            <Wordmark className="text-foreground" mark="ring-border" />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
