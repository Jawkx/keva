import { Download, Pencil, Trash2, TriangleAlert, X } from "lucide-react";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PropertyValue } from "@keva/schema";
import type { KevaItem } from "@keva/sdk";
import { FileActivity } from "./FileActivity";
import { PropertiesEditor } from "./PropertiesEditor";
import { CopyButton } from "./CopyButton";
import { CsvPreviewViewer } from "./viewers/CsvPreviewViewer";
import { PdfPreviewViewer } from "./viewers/PdfPreviewViewer";
import { errorMessage } from "../lib/errors";
import { formatBytes, formatDate, formatRelative } from "../lib/format";
import {
  cachePatchedItem,
  itemContentQueryKey,
  itemQueryKey,
  removeDeletedItemsFromCache,
} from "../lib/items-cache";
import { isCsv, isImage, isPdf, isPreviewable } from "../lib/preview";
import { keva } from "../lib/keva";
import { objectUrlFor } from "../lib/object-url-cache";
import { runEffectPromise } from "../lib/effect-runtime";
import { loadPreviewContent } from "../lib/preview-content";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Preview =
  | { kind: "image"; url: string }
  | { kind: "pdf"; url: string }
  | { kind: "csv"; text: string }
  | { kind: "text"; text: string };

type Panel = "preview" | "properties" | "activity";

const PANEL_LABELS: Record<Panel, string> = {
  preview: "Preview",
  properties: "Properties",
  activity: "Activity",
};

const panelsFor = (o: KevaItem): Panel[] =>
  isPreviewable(o) ? ["preview", "properties", "activity"] : ["properties", "activity"];

const extensionStart = (name: string): number => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name.length : dot;
};

interface FileDetailProps {
  itemId: string;
  onClose?: () => void;
  onDeleted: () => void;
}

export function FileDetail({ itemId, onClose, onDeleted }: FileDetailProps) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const itemQuery = useQuery({
    queryKey: itemQueryKey(itemId),
    queryFn: () => keva.get(itemId),
  });
  const item = itemQuery.data ?? null;
  const loading = itemQuery.isLoading;
  const error = itemQuery.error ? errorMessage(itemQuery.error) : null;

  const contentQuery = useQuery({
    queryKey: itemContentQueryKey(itemId),
    enabled: Boolean(item) && isPreviewable(item!),
    staleTime: Infinity,
    gcTime: 0,
    queryFn: ({ signal }) =>
      runEffectPromise(
        loadPreviewContent(
          keva.downloadBytesEffect(itemId),
          item!.contentType,
          isImage(item!) || isPdf(item!),
        ),
        signal,
      ),
  });
  const previewLoading = contentQuery.isLoading;

  const preview = useMemo<Preview | null>(() => {
    if (!item || !contentQuery.data) return null;
    if (contentQuery.data.kind === "blob") {
      return {
        kind: isImage(item) ? "image" : "pdf",
        url: objectUrlFor("owner", itemId, contentQuery.data.blob),
      };
    }
    if (isCsv(item)) return { kind: "csv", text: contentQuery.data.text };
    return { kind: "text", text: contentQuery.data.text };
  }, [item, contentQuery.data, itemId]);

  const panels = useMemo(() => (item ? panelsFor(item) : []), [item]);

  const paramPanel = searchParams.get("panel") as Panel | null;
  const activePanel: Panel =
    paramPanel && panels.includes(paramPanel) ? paramPanel : (panels[0] ?? "properties");

  const setPanel = useCallback(
    (next: Panel) => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          sp.set("panel", next);
          return sp;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const downloadMutation = useMutation({
    mutationFn: async () => {
      const { url } = await keva.getDownloadUrl(itemId);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item?.name ?? itemId;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => keva.delete(itemId),
    onSuccess: () => {
      toast.success(`Deleted ${item?.name ?? "item"}`);
      removeDeletedItemsFromCache(queryClient, [itemId]);
      onDeleted();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const patchMutation = useMutation({
    mutationFn: (vars: { set: Record<string, PropertyValue>; unset: string[] }) =>
      keva.patch(itemId, vars),
    onSuccess: (updated) => {
      cachePatchedItem(queryClient, updated);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const busy = downloadMutation.isPending || deleteMutation.isPending;

  const onPatch = async (set: Record<string, PropertyValue>, unset: string[]) => {
    return (await patchMutation.mutateAsync({ set, unset })).properties;
  };

  // Focus the rename field as it mounts and pre-select the stem. A stable
  // callback ref (not an effect) so it fires once on mount, not every render.
  const renameInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.focus();
      node.setSelectionRange(0, extensionStart(node.value));
    }
  }, []);

  const commitRename = async () => {
    const next = renameDraft?.trim() ?? "";
    if (!item || next === "" || next === item.name) {
      setRenameDraft(null);
      return;
    }
    try {
      await patchMutation.mutateAsync({ set: { name: next }, unset: [] });
      setRenameDraft(null);
    } catch {}
  };

  const onImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      setImageAspectRatio(image.naturalWidth / image.naturalHeight);
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          {renameDraft !== null ? (
            <input
              ref={renameInputRef}
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onBlur={() => setRenameDraft(null)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setRenameDraft(null);
                }
              }}
              aria-label="Rename file"
              className="w-full rounded-sm border border-input bg-transparent px-1.5 py-0.5 font-heading text-base font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-1">
              <h2 className="truncate font-heading text-base font-medium" title={item?.name}>
                {item?.name ?? "…"}
              </h2>
              {item && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Rename"
                        className="shrink-0 text-muted-foreground"
                        onClick={() => setRenameDraft(item.name)}
                      />
                    }
                  >
                    <Pencil />
                  </TooltipTrigger>
                  <TooltipContent>Rename</TooltipContent>
                </Tooltip>
              )}
            </div>
          )}
          {item && renameDraft === null && (
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
                  disabled={busy || !item}
                  onClick={() => downloadMutation.mutate()}
                />
              }
            >
              <Download />
            </TooltipTrigger>
            <TooltipContent>Download</TooltipContent>
          </Tooltip>

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <Tooltip>
              <TooltipTrigger
                render={
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        aria-label="Delete"
                        disabled={busy || !item}
                      />
                    }
                  />
                }
              >
                <Trash2 />
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{item?.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the item and its properties. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    setConfirmOpen(false);
                    deleteMutation.mutate();
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

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
            value={[activePanel]}
            onValueChange={(value) => {
              const next = value[0] as Panel | undefined;
              if (next) setPanel(next);
            }}
            className="w-full"
            aria-label="Detail panel"
          >
            {panels.map((panel) => (
              <ToggleGroupItem key={panel} value={panel}>
                {PANEL_LABELS[panel]}
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
            <TriangleAlert />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : !item ? (
          <p className="text-sm text-muted-foreground">Not found.</p>
        ) : activePanel === "preview" ? (
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
        ) : activePanel === "activity" ? (
          <section className="min-w-0">
            <FileActivity itemId={itemId} />
          </section>
        ) : (
          <section className="min-w-0">
            <PropertiesEditor
              properties={item.properties}
              systemRows={[
                { key: "Status", value: <Badge variant="secondary">{item.status}</Badge> },
                {
                  key: "Source",
                  title: item.source,
                  value: (
                    <span className="truncate" title={item.source}>
                      {item.source}
                    </span>
                  ),
                },
                {
                  key: "Created",
                  value: (
                    <span title={formatDate(item.createdAt)}>{formatRelative(item.createdAt)}</span>
                  ),
                },
                {
                  key: "Updated",
                  value: (
                    <span title={formatDate(item.updatedAt)}>{formatRelative(item.updatedAt)}</span>
                  ),
                },
                {
                  key: "ID",
                  value: (
                    <>
                      <span className="min-w-0 truncate font-mono text-xs">{item.id}</span>
                      <CopyButton value={item.id} label="Copy ID" />
                    </>
                  ),
                },
              ]}
              onPatch={onPatch}
            />
          </section>
        )}
      </div>
    </div>
  );
}
