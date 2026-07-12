import { type ReactNode, Suspense, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert02Icon, Cancel01Icon, Download01Icon, LockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { CopyButton } from "../../components/CopyButton";
import { propertyListClass } from "../../components/PropertiesEditor";
import { CsvPreviewViewer } from "../../components/viewers/CsvPreviewViewer";
import { PdfPreviewViewer } from "../../components/viewers/PdfPreviewViewer";
import { errorMessage } from "../../lib/errors";
import { formatBytes, formatDate, formatPropertyValue, formatRelative } from "../../lib/format";
import { shareContentQueryKey, shareItemQueryKey } from "../../lib/items-cache";
import { objectUrlFor } from "../../lib/object-url-cache";
import { isCsv, isImage, isPdf, isPreviewable } from "../../lib/preview";
import { useShare } from "./share-context";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Preview =
  | { kind: "image"; url: string }
  | { kind: "pdf"; url: string }
  | { kind: "csv"; text: string }
  | { kind: "text"; text: string };

type PreviewContent = { kind: "blob"; blob: Blob } | { kind: "text"; text: string };

type Panel = "preview" | "info";

const PANEL_LABELS: Record<Panel, string> = {
  preview: "Preview",
  info: "Info",
};

interface ShareFileDetailProps {
  itemId: string;
  onClose?: () => void;
}

export function ShareFileDetail({ itemId, onClose }: ShareFileDetailProps) {
  const { client } = useShare();
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
  const [activePanel, setActivePanel] = useState<Panel | null>(null);

  const itemQuery = useQuery({
    queryKey: shareItemQueryKey(itemId),
    queryFn: () => client.get(itemId),
  });
  const item = itemQuery.data ?? null;
  const loading = itemQuery.isLoading;
  const error = itemQuery.error ? errorMessage(itemQuery.error) : null;

  const contentQuery = useQuery({
    queryKey: shareContentQueryKey(itemId),
    enabled: Boolean(item) && isPreviewable(item!),
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async () => {
      const bytes = await client.downloadBytes(itemId);
      if (isImage(item!) || isPdf(item!)) {
        return {
          kind: "blob",
          blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type: item!.contentType }),
        } satisfies PreviewContent;
      }
      return {
        kind: "text",
        text: new TextDecoder().decode(bytes).slice(0, 5000),
      } satisfies PreviewContent;
    },
  });
  const previewLoading = contentQuery.isLoading;

  const preview = useMemo<Preview | null>(() => {
    if (!item || !contentQuery.data) return null;
    if (contentQuery.data.kind === "blob") {
      return {
        kind: isImage(item) ? "image" : "pdf",
        url: objectUrlFor(itemId, contentQuery.data.blob),
      };
    }
    if (isCsv(item)) return { kind: "csv", text: contentQuery.data.text };
    return { kind: "text", text: contentQuery.data.text };
  }, [item, contentQuery.data, itemId]);

  const panels = useMemo<Panel[]>(
    () => (item && isPreviewable(item) ? ["preview", "info"] : ["info"]),
    [item],
  );
  const panel: Panel = activePanel && panels.includes(activePanel) ? activePanel : panels[0]!;

  const download = useMutation({
    mutationFn: async () => {
      const { url } = await client.getDownloadUrl(itemId);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item?.name ?? itemId;
      // Keep the secret share URL out of the storage host's Referer.
      anchor.rel = "noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setImageAspectRatio(image.naturalWidth / image.naturalHeight);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-heading text-base font-medium" title={item?.name}>
            {item?.name ?? "…"}
          </h2>
          {item && (
            <p className="truncate text-sm text-muted-foreground">
              {item.contentType} · {formatBytes(item.size)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Download"
                  disabled={download.isPending || !item}
                  onClick={() => download.mutate()}
                />
              }
            >
              <HugeiconsIcon icon={Download01Icon} />
            </TooltipTrigger>
            <TooltipContent>Download</TooltipContent>
          </Tooltip>

          {onClose && (
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <HugeiconsIcon icon={Cancel01Icon} />
            </Button>
          )}
        </div>
      </header>

      {item && panels.length > 1 && (
        <div className="shrink-0 px-4 pt-3">
          <ToggleGroup
            variant="outline"
            value={[panel]}
            onValueChange={(value) => {
              const next = value[0] as Panel | undefined;
              if (next) setActivePanel(next);
            }}
            className="w-full"
            aria-label="Detail panel"
          >
            {panels.map((p) => (
              <ToggleGroupItem key={p} value={p}>
                {PANEL_LABELS[p]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}

      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error && !item ? (
          <Alert variant="destructive">
            <HugeiconsIcon icon={Alert02Icon} />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : !item ? (
          <p className="text-sm text-muted-foreground">Not found.</p>
        ) : panel === "preview" ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            {previewLoading ? (
              isImage(item) ? (
                <Skeleton className="aspect-video w-full max-w-full rounded-md" />
              ) : (
                <Skeleton className="min-h-0 w-full flex-1" />
              )
            ) : preview?.kind === "image" ? (
              <div
                className="w-full max-w-full overflow-hidden rounded-md bg-muted/30"
                style={{ aspectRatio: imageAspectRatio ?? 16 / 9 }}
              >
                <img
                  src={preview.url}
                  alt={item.name}
                  className="h-full w-full object-contain"
                  onLoad={onImageLoad}
                />
              </div>
            ) : preview?.kind === "pdf" ? (
              <Suspense fallback={<Skeleton className="min-h-0 w-full flex-1" />}>
                <PdfPreviewViewer
                  src={preview.url}
                  fileName={item.name}
                  className="min-h-0 w-full flex-1 overflow-hidden rounded-md bg-muted/30"
                />
              </Suspense>
            ) : preview?.kind === "csv" ? (
              <Suspense fallback={<Skeleton className="min-h-0 w-full flex-1" />}>
                <CsvPreviewViewer
                  data={preview.text}
                  className="min-h-0 w-full flex-1 overflow-hidden rounded-md bg-muted/30"
                />
              </Suspense>
            ) : preview?.kind === "text" ? (
              <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-md bg-muted/50">
                <pre className="w-max p-3 font-mono text-xs">{preview.text}</pre>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Preview unavailable.</p>
            )}
          </section>
        ) : (
          <section className="min-w-0">
            <div className={propertyListClass}>
              <InfoRow label="Status">
                <Badge variant="secondary">{item.status}</Badge>
              </InfoRow>
              <InfoRow label="Source" title={item.source}>
                <span className="truncate" title={item.source}>
                  {item.source}
                </span>
              </InfoRow>
              <InfoRow label="Added">
                <span title={formatDate(item.createdAt)}>{formatRelative(item.createdAt)}</span>
              </InfoRow>
              <InfoRow label="Updated">
                <span title={formatDate(item.updatedAt)}>{formatRelative(item.updatedAt)}</span>
              </InfoRow>
              <InfoRow label="ID">
                <span className="min-w-0 truncate font-mono text-xs">{item.id}</span>
                <CopyButton value={item.id} label="Copy ID" />
              </InfoRow>
              {Object.entries(item.properties).map(([key, value]) => (
                <InfoRow key={`prop:${key}`} label={key} title={key} mono>
                  <span className="truncate">{formatPropertyValue(value)}</span>
                </InfoRow>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function InfoRow({
  label,
  title,
  mono,
  children,
}: {
  label: string;
  title?: string | undefined;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="flex size-6 shrink-0 items-center justify-center" title="Read-only">
        <HugeiconsIcon icon={LockIcon} className="size-3.5 text-muted-foreground" />
      </span>
      <span
        className={cn("w-24 shrink-0 truncate text-sm text-muted-foreground", mono && "font-mono")}
        title={title ?? label}
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">{children}</div>
    </div>
  );
}
