import { ArrowRight, HardDrive } from "lucide-react";
import { Link } from "react-router";
import type { UsageResult } from "@keva/sdk";
import { formatBytes, formatContentType } from "../lib/format";
import { useUsage } from "../lib/use-usage";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PALETTE = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"] as const;
const TOP = PALETTE.length;

interface Segment {
  readonly key: string;
  readonly label: string;
  readonly bytes: number;
  readonly color: string;
  readonly pct: number;
}

const buildSegments = (usage: UsageResult): Segment[] => {
  const total = usage.totalBytes;
  const pct = (bytes: number) => (total > 0 ? (bytes / total) * 100 : 0);
  const segments: Segment[] = usage.byType.slice(0, TOP).map((entry, index) => ({
    key: entry.contentType,
    label: formatContentType(entry.contentType),
    bytes: entry.bytes,
    color: PALETTE[index]!,
    pct: pct(entry.bytes),
  }));
  const rest = usage.byType.slice(TOP);
  if (rest.length > 0) {
    const bytes = rest.reduce((sum, entry) => sum + entry.bytes, 0);
    segments.push({
      key: "__other__",
      label: `Other (${rest.length})`,
      bytes,
      color: "bg-muted-foreground/40",
      pct: pct(bytes),
    });
  }
  return segments;
};

const plural = (n: number) => (n === 1 ? "item" : "items");

const formatUsagePercent = (percent: number): string => {
  if (percent === 0) return "0%";
  if (percent < 0.01) return "<0.01%";
  if (percent < 1) return `${percent.toFixed(2)}%`;
  return `${percent.toFixed(0)}%`;
};

export function StorageUsageCard() {
  const { data: usage, isPending, isError } = useUsage();

  return (
    <div>
      <header className="pb-5">
        <h2 className="font-heading text-xl font-semibold tracking-tight">Storage</h2>
      </header>
      <Separator />
      <section className="py-6">
        {isPending ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-9 w-40" />
                <Skeleton className="h-5 w-28" />
              </div>
              <div className="space-y-2">
                <Skeleton className="ml-auto h-5 w-24" />
                <Skeleton className="ml-auto h-5 w-28" />
              </div>
            </div>
            <div className="space-y-2">
              <Skeleton className="h-2.5 w-full rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-5 w-20" />
                </div>
              ))}
            </div>
            <Skeleton className="h-2.5 w-full rounded-full" />
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Skeleton className="size-2.5 shrink-0 rounded-full" />
                  <Skeleton className="h-5 flex-1" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </div>
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Couldn't load storage usage.</p>
        ) : usage.quotaBytes === 0 ? (
          <NoStoragePlan />
        ) : (
          <UsageBreakdown usage={usage} />
        )}
      </section>
    </div>
  );
}

function NoStoragePlan() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-full border bg-background shadow-sm">
        <HardDrive className="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="mt-5 font-heading text-lg font-semibold">No storage plan</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
        Choose a plan to activate storage and start your 14-day trial.
      </p>
      <Button className="mt-5" nativeButton={false} render={<Link to="/settings/billing" />}>
        View billing plans
        <ArrowRight data-icon="inline-end" />
      </Button>
    </div>
  );
}

function UsageBreakdown({ usage }: { readonly usage: UsageResult }) {
  const segments = buildSegments(usage);
  const hasBytes = usage.totalBytes > 0;
  const accountedBytes =
    usage.quotaBytes === null || usage.remainingBytes === null
      ? usage.totalBytes
      : usage.quotaBytes - usage.remainingBytes;
  const usagePct =
    usage.quotaBytes === null || usage.quotaBytes <= 0
      ? null
      : (accountedBytes / usage.quotaBytes) * 100;
  const meterPct = usagePct === null ? 0 : Math.min(100, usagePct);
  const isAtLimit = usagePct !== null && usagePct >= 100;
  const isNearLimit = usagePct !== null && usagePct >= 80;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-3xl font-semibold tabular-nums">
              {formatBytes(usage.totalBytes)}
            </span>
            <span className="text-sm text-muted-foreground">used</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {usage.itemCount.toLocaleString()} {plural(usage.itemCount)}
            {usage.quotaItems !== null && ` of ${usage.quotaItems.toLocaleString()}`}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-medium tabular-nums">
            {usage.quotaBytes === null
              ? "Unlimited storage"
              : `${formatBytes(usage.quotaBytes)} limit`}
          </p>
          <p className="mt-1 text-muted-foreground tabular-nums">
            {usage.remainingBytes === null
              ? "No usage limit"
              : `${formatBytes(usage.remainingBytes)} remaining`}
          </p>
        </div>
      </div>

      {usage.quotaBytes !== null && (
        <div>
          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Storage used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(usagePct ?? 0))}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                isAtLimit ? "bg-destructive" : isNearLimit ? "bg-chart-3" : "bg-chart-2",
              )}
              style={{ width: `${meterPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground tabular-nums">
            {formatUsagePercent(usagePct ?? 0)} used
          </p>
        </div>
      )}

      {isNearLimit && (
        <p className={cn("text-sm font-medium", isAtLimit ? "text-destructive" : "text-chart-4")}>
          {isAtLimit
            ? "Storage limit reached. Delete files before uploading more."
            : "Storage is above 80%. Consider deleting files you no longer need."}
        </p>
      )}

      {usage.period && (
        <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Monthly uploads
            </p>
            <p className="mt-1 font-medium tabular-nums">
              {(usage.period.uploadsUsed + usage.period.uploadsReserved).toLocaleString()} /{" "}
              {usage.period.uploadsLimit.toLocaleString()}
            </p>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">API and MCP usage</summary>
            <p className="mt-2 text-muted-foreground tabular-nums">
              {usage.period.apiRequestsUsed.toLocaleString()} /{" "}
              {usage.period.apiRequestsLimit.toLocaleString()} programmatic requests
            </p>
          </details>
        </div>
      )}

      {hasBytes ? (
        <>
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
            {segments.map((segment) => (
              <div
                key={segment.key}
                className={cn("h-full first:rounded-l-full last:rounded-r-full", segment.color)}
                style={{ width: `${segment.pct}%` }}
              />
            ))}
          </div>
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {segments.map((segment) => (
              <li key={segment.key} className="flex items-center gap-2 text-sm">
                <span className={cn("size-2.5 shrink-0 rounded-full", segment.color)} />
                <span className="min-w-0 flex-1 truncate">{segment.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatBytes(segment.bytes)}
                </span>
                <span className="w-9 text-right tabular-nums text-muted-foreground">
                  {segment.pct.toFixed(0)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No files stored yet.</p>
      )}
    </div>
  );
}
