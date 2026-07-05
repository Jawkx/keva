import type { UsageResult } from "@keva/sdk";
import { formatBytes, formatContentType } from "../lib/format";
import { useUsage } from "../lib/use-usage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Fixed-order categorical ramp (the design system's chart tokens). Segments are
// the tenant's largest content types by bytes; anything past the ramp folds into
// a single neutral "Other" bucket — never a cycled/extended palette.
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

export function StorageUsageCard() {
  const { data: usage, isPending, isError } = useUsage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storage</CardTitle>
        <CardDescription>How much you've stored in keva.</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-2.5 w-full rounded-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Couldn't load storage usage.</p>
        ) : usage.itemCount === 0 ? (
          <p className="text-sm text-muted-foreground">No files stored yet.</p>
        ) : (
          <UsageBreakdown usage={usage} />
        )}
      </CardContent>
    </Card>
  );
}

function UsageBreakdown({ usage }: { readonly usage: UsageResult }) {
  const segments = buildSegments(usage);
  const hasBytes = usage.totalBytes > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2">
        <span className="font-heading text-3xl font-semibold tabular-nums">
          {formatBytes(usage.totalBytes)}
        </span>
        <span className="text-sm text-muted-foreground">
          used · {usage.itemCount.toLocaleString()} {plural(usage.itemCount)}
        </span>
      </div>

      {hasBytes && (
        <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
          {segments.map((segment) => (
            <div
              key={segment.key}
              className={cn("h-full first:rounded-l-full last:rounded-r-full", segment.color)}
              style={{ width: `${segment.pct}%` }}
            />
          ))}
        </div>
      )}

      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-2 text-sm">
            <span className={cn("size-2.5 shrink-0 rounded-full", segment.color)} />
            <span className="min-w-0 flex-1 truncate">{segment.label}</span>
            <span className="tabular-nums text-muted-foreground">{formatBytes(segment.bytes)}</span>
            {hasBytes && (
              <span className="w-9 text-right tabular-nums text-muted-foreground">
                {segment.pct.toFixed(0)}%
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
