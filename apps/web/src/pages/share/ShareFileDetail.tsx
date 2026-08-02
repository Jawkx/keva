import { Download, LockKeyhole, Trash2, TriangleAlert, X } from "lucide-react";
import { lazy, type ReactNode, Suspense, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CopyButton } from "../../components/CopyButton";
import { propertyListClass } from "../../components/PropertiesEditor";
import { CsvPreviewViewer } from "../../components/viewers/CsvPreviewViewer";
import { PdfPreviewViewer } from "../../components/viewers/PdfPreviewViewer";
import { FilePreviewSkeleton } from "../../components/viewers/FilePreviewSkeleton";
import { ImagePreviewViewer } from "../../components/viewers/ImagePreviewViewer";
import { HtmlPreviewViewer } from "../../components/viewers/HtmlPreviewViewer";
import { MarkdownPreviewViewer } from "../../components/viewers/MarkdownPreviewViewer";
import { errorMessage } from "../../lib/errors";
import { formatBytes, formatDate, formatPropertyValue, formatRelative } from "../../lib/format";
import {
  removeDeletedShareItemFromCache,
  shareContentQueryKey,
  shareItemQueryKey,
} from "../../lib/items-cache";
import { objectUrlFor } from "../../lib/object-url-cache";
import {
  isCsv,
  isHtml,
  isImage,
  isMarkdown,
  isPdf,
  isPreviewable,
  isVideo,
} from "../../lib/preview";
import { runEffectPromise } from "../../lib/effect-runtime";
import { loadPreviewContent } from "../../lib/preview-content";
import { loadOptionalThumbnailUrl } from "../../lib/thumbnails";
import { useShare } from "./share-context";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const VideoPreview = lazy(() => import("../../components/viewers/VideoPreview"));

type Preview =
  | { kind: "image"; url: string }
  | { kind: "pdf"; url: string }
  | { kind: "csv"; text: string }
  | { kind: "text"; text: string };

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
  const queryClient = useQueryClient();
  const [activePanel, setActivePanel] = useState<Panel | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const itemQuery = useQuery({
    queryKey: shareItemQueryKey(itemId),
    queryFn: () => client.get(itemId),
  });
  const item = itemQuery.data ?? null;
  const loading = itemQuery.isLoading;
  const error = itemQuery.error ? errorMessage(itemQuery.error) : null;

  const contentQuery = useQuery({
    queryKey: shareContentQueryKey(itemId),
    enabled: Boolean(item) && isPreviewable(item!) && !isVideo(item!),
    staleTime: Infinity,
    gcTime: 0,
    queryFn: ({ signal }) =>
      runEffectPromise(
        loadPreviewContent(
          client.downloadBytesEffect(itemId),
          item!.contentType,
          isImage(item!) || isPdf(item!),
        ),
        signal,
      ),
  });
  const previewLoading = contentQuery.isLoading;

  const thumbnailQuery = useQuery({
    queryKey: ["share-thumbnail", itemId],
    enabled: Boolean(item) && isVideo(item!),
    staleTime: 4 * 60_000,
    gcTime: 0,
    retry: false,
    queryFn: () => loadOptionalThumbnailUrl(() => client.getThumbnailUrl(itemId)),
  });

  const preview = useMemo<Preview | null>(() => {
    if (!item || !contentQuery.data) return null;
    if (contentQuery.data.kind === "blob") {
      return {
        kind: isImage(item) ? "image" : "pdf",
        url: objectUrlFor("share", itemId, contentQuery.data.blob),
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

  const loadVideoSource = useCallback(() => client.getDownloadUrl(itemId), [client, itemId]);

  const deleteMutation = useMutation({
    mutationFn: () => client.delete(itemId),
    onSuccess: () => {
      removeDeletedShareItemFromCache(queryClient, itemId);
      setDeleteOpen(false);
      toast.success(`Moved ${item?.name ?? "upload"} to the owner’s Trash`);
      onClose?.();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

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

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          {loading ? (
            <Skeleton className="h-5 w-40 max-w-full" />
          ) : (
            <h2 className="truncate font-heading text-base font-medium" title={item?.name}>
              {item?.name ?? "…"}
            </h2>
          )}
          {loading ? (
            <Skeleton className="mt-1 h-5 w-32" />
          ) : item ? (
            <p className="truncate text-sm text-muted-foreground">
              {item.contentType} · {formatBytes(item.size)}
            </p>
          ) : null}
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
              <Download />
            </TooltipTrigger>
            <TooltipContent>Download</TooltipContent>
          </Tooltip>

          {item?.canDelete && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Move upload to Trash"
              disabled={deleteMutation.isPending}
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 />
            </Button>
          )}

          {onClose && (
            <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
              <X />
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
          <FilePreviewSkeleton />
        ) : error && !item ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : !item ? (
          <p className="text-sm text-muted-foreground">Not found.</p>
        ) : panel === "preview" ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            {isVideo(item) ? (
              <Suspense fallback={<FilePreviewSkeleton variant="image" />}>
                <VideoPreview
                  key={itemId}
                  itemId={itemId}
                  contentType={item.contentType}
                  fileName={item.name}
                  loadSource={loadVideoSource}
                  {...(thumbnailQuery.data ? { posterUrl: thumbnailQuery.data } : {})}
                />
              </Suspense>
            ) : previewLoading ? (
              isImage(item) ? (
                <FilePreviewSkeleton variant="image" />
              ) : isPdf(item) || isCsv(item) ? (
                <FilePreviewSkeleton variant="viewer" />
              ) : (
                <FilePreviewSkeleton />
              )
            ) : preview?.kind === "image" ? (
              <ImagePreviewViewer
                key={preview.url}
                src={preview.url}
                alt={item.name}
                rotation={item.presentation?.image?.rotation ?? 0}
              />
            ) : preview?.kind === "pdf" ? (
              <Suspense fallback={<FilePreviewSkeleton variant="viewer" />}>
                <PdfPreviewViewer
                  src={preview.url}
                  fileName={item.name}
                  className="min-h-0 w-full flex-1 overflow-hidden rounded-md bg-muted/30"
                />
              </Suspense>
            ) : preview?.kind === "csv" ? (
              <Suspense fallback={<FilePreviewSkeleton variant="viewer" />}>
                <CsvPreviewViewer
                  data={preview.text}
                  className="min-h-0 w-full flex-1 overflow-hidden rounded-md bg-muted/30"
                />
              </Suspense>
            ) : preview?.kind === "text" && isMarkdown(item) ? (
              <MarkdownPreviewViewer key={itemId} source={preview.text} />
            ) : preview?.kind === "text" && isHtml(item) ? (
              <HtmlPreviewViewer key={itemId} source={preview.text} />
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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{item?.name}” to Trash?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes your upload from the shared view and moves it to the owner’s Trash. The
              owner can restore it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
        <LockKeyhole className="size-3.5 text-muted-foreground" />
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
