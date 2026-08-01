import { ArchiveRestore, Download, Pencil, Trash2, TriangleAlert, X } from "lucide-react";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ItemPresentation, PropertyValue } from "@keva/schema";
import type { KevaItem } from "@keva/sdk";
import { FileActivity } from "./FileActivity";
import { PropertiesEditor } from "./PropertiesEditor";
import { CopyButton } from "./CopyButton";
import { CsvPreviewViewer } from "./viewers/CsvPreviewViewer";
import { PdfPreviewViewer } from "./viewers/PdfPreviewViewer";
import { FilePreviewSkeleton } from "./viewers/FilePreviewSkeleton";
import { ImagePreviewViewer } from "./viewers/ImagePreviewViewer";
import { HtmlPreviewViewer } from "./viewers/HtmlPreviewViewer";
import { MarkdownPreviewViewer } from "./viewers/MarkdownPreviewViewer";
import { errorMessage } from "../lib/errors";
import { formatBytes, formatDate, formatRelative } from "../lib/format";
import {
  cachePatchedItem,
  itemContentQueryKey,
  itemQueryKey,
  removeDeletedItemsFromCache,
} from "../lib/items-cache";
import { isCsv, isHtml, isImage, isMarkdown, isPdf, isPreviewable } from "../lib/preview";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
  onDeleted?: () => void;
  onRestored?: () => void;
  onPurged?: () => void;
  variant?: "active" | "trash";
}

export function FileDetail({
  itemId,
  onClose,
  onDeleted,
  onRestored,
  onPurged,
  variant = "active",
}: FileDetailProps) {
  const trashMode = variant === "trash";
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const itemQuery = useQuery({
    queryKey: trashMode ? ["trash-item", itemId] : itemQueryKey(itemId),
    queryFn: () => (trashMode ? keva.getTrash(itemId) : keva.get(itemId)),
  });
  const item = itemQuery.data ?? null;
  const loading = itemQuery.isLoading;
  const error = itemQuery.error ? errorMessage(itemQuery.error) : null;

  const contentQuery = useQuery({
    queryKey: trashMode ? ["trash-content", itemId] : itemContentQueryKey(itemId),
    enabled: Boolean(item) && isPreviewable(item!),
    staleTime: Infinity,
    gcTime: 0,
    queryFn: ({ signal }) =>
      runEffectPromise(
        loadPreviewContent(
          trashMode ? keva.downloadTrashBytesEffect(itemId) : keva.downloadBytesEffect(itemId),
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

  const panels = useMemo(
    () => (item ? (trashMode ? (["preview"] as Panel[]) : panelsFor(item)) : []),
    [item, trashMode],
  );

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
      const { url } = await (trashMode
        ? keva.getTrashDownloadUrl(itemId)
        : keva.getDownloadUrl(itemId));
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
      const name = item?.name ?? "item";
      toast.success(`Moved ${name} to Trash`, {
        action: {
          label: "Undo",
          onClick: () => {
            void keva
              .restore(itemId)
              .then(() => {
                void queryClient.invalidateQueries({ queryKey: ["items"] });
                void queryClient.invalidateQueries({ queryKey: ["trash"] });
                toast.success(`Restored ${name}`);
              })
              .catch((error) => toast.error(errorMessage(error)));
          },
        },
      });
      removeDeletedItemsFromCache(queryClient, [itemId]);
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      onDeleted?.();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const restoreMutation = useMutation({
    mutationFn: () => keva.restore(itemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      toast.success(`Restored ${item?.name ?? "file"}`);
      onRestored?.();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const purgeMutation = useMutation({
    mutationFn: () => keva.purge(itemId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      toast.success(`Permanently deleted ${item?.name ?? "file"}`);
      onPurged?.();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const patchMutation = useMutation({
    mutationFn: (vars: { set: Record<string, PropertyValue>; unset: string[] }) =>
      keva.patch(itemId, vars),
    onSuccess: (updated) => {
      cachePatchedItem(queryClient, updated);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const rotationMutation = useMutation({
    mutationFn: ({
      presentation,
      expectedRevision,
    }: {
      presentation: ItemPresentation;
      expectedRevision: number;
    }) =>
      keva.patch(itemId, {
        expectedRevision,
        set: {},
        unset: [],
        presentation,
      }),
    onMutate: async ({ presentation }) => {
      await queryClient.cancelQueries({ queryKey: itemQueryKey(itemId) });
      const previous = queryClient.getQueryData<KevaItem>(itemQueryKey(itemId));
      if (previous) {
        queryClient.setQueryData<KevaItem>(itemQueryKey(itemId), {
          ...previous,
          presentation,
        });
      }
      return { previous };
    },
    onSuccess: (updated) => {
      cachePatchedItem(queryClient, updated);
    },
    onError: (err, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(itemQueryKey(itemId), context.previous);
      }
      void queryClient.invalidateQueries({ queryKey: itemQueryKey(itemId) });
      toast.error(errorMessage(err));
    },
  });

  const busy =
    downloadMutation.isPending ||
    deleteMutation.isPending ||
    restoreMutation.isPending ||
    purgeMutation.isPending;

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

  const nameExtensionStart = item ? extensionStart(item.name) : 0;
  const nameStem = item?.name.slice(0, nameExtensionStart) ?? "…";
  const nameExtension = item?.name.slice(nameExtensionStart) ?? "";
  const imageRotation = item?.presentation?.image?.rotation ?? 0;

  const rotateImage = (direction: -1 | 1) => {
    if (!item || rotationMutation.isPending) return;
    const rotation = ((((imageRotation + direction * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
    rotationMutation.mutate({
      presentation: {
        ...item.presentation,
        image: { ...item.presentation?.image, rotation },
      },
      expectedRevision: item.revision,
    });
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          {loading ? (
            <div className="flex min-w-0 items-center gap-1">
              <Skeleton className="h-5 w-40 max-w-full" />
              <Skeleton className="size-7 shrink-0" />
            </div>
          ) : renameDraft !== null ? (
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
              <h2 className="flex min-w-0 font-heading text-base font-medium" title={item?.name}>
                <span className="min-w-0 truncate">{nameStem}</span>
                <span className="shrink-0">{nameExtension}</span>
              </h2>
              {item && !trashMode && (
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
          {loading ? (
            <Skeleton className="mt-1 h-5 w-32" />
          ) : item && renameDraft === null ? (
            <p className="truncate text-sm text-muted-foreground">
              {item.contentType} · {formatBytes(item.size)}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {onClose && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close file details"
              title="Close"
              onClick={onClose}
            >
              <X />
            </Button>
          )}
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

          <Separator orientation="vertical" className="mx-1 h-5 data-vertical:self-center" />
          {trashMode && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !item}
              onClick={() => restoreMutation.mutate()}
            >
              <ArchiveRestore data-icon="inline-start" />
              Restore
            </Button>
          )}
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
                        aria-label={trashMode ? "Delete forever" : "Delete"}
                        disabled={busy || !item}
                      />
                    }
                  />
                }
              >
                <Trash2 />
              </TooltipTrigger>
              <TooltipContent>{trashMode ? "Delete forever" : "Move to Trash"}</TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {trashMode ? `Permanently delete “${item?.name}”?` : `Delete “${item?.name}”?`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {trashMode
                    ? "This permanently removes the file and cannot be undone."
                    : "This moves the item to Trash, where you can restore it or delete it forever."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    setConfirmOpen(false);
                    if (trashMode) purgeMutation.mutate();
                    else deleteMutation.mutate();
                  }}
                >
                  {trashMode ? "Delete forever" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
          <FilePreviewSkeleton />
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
                rotation={imageRotation}
                rotating={rotationMutation.isPending}
                {...(trashMode ? {} : { onRotate: rotateImage })}
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
              <ScrollArea className="min-h-0 w-full min-w-0 flex-1 rounded-md bg-muted/50">
                <pre className="w-max p-3 font-mono text-xs">{preview.text}</pre>
              </ScrollArea>
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
