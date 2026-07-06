import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconDownload, IconPencil, IconTrash, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import type { PropertyValue } from "@keva/schema";
import type { KevaItem } from "@keva/sdk";
import { PropertiesEditor } from "./PropertiesEditor";
import { CopyButton } from "./CopyButton";
import { FileTypeIcon } from "./FileTypeIcon";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import { CsvViewer } from "@/components/ui/csv-viewer";
import { PDFViewer } from "@/components/ui/pdf-viewer";
import { errorMessage } from "../lib/errors";
import { formatBytes, formatDate, formatRelative } from "../lib/format";
import { removeItemsFromPages, replaceItemInPages, type ItemsCache } from "../lib/items-cache";
import { isCsv, isImage, isPdf, isPreviewable } from "../lib/preview";
import { keva } from "../lib/keva";
import { objectUrlFor, revokeObjectUrl } from "../lib/object-url-cache";
import { usageQueryKey } from "../lib/use-usage";
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

type Panel = "preview" | "properties";

const PANEL_LABELS: Record<Panel, string> = {
  preview: "Preview",
  properties: "Properties",
};

// The panels available for an item, in display order. Preview is offered only
// when the content can actually be rendered; Properties (system metadata plus
// the user's own keys) always exists. With a single panel the segmented
// control is hidden, so a non-previewable item shows Properties directly.
const panelsFor = (o: KevaItem): Panel[] =>
  isPreviewable(o) ? ["preview", "properties"] : ["properties"];

// Where the file extension begins, for pre-selecting just the stem when
// renaming (so a careless keystroke replaces "report" but keeps ".pdf"). A
// leading-dot name (".gitignore") or an extension-less name has no stem to
// isolate, so the whole value is selected.
const extensionStart = (name: string): number => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name.length : dot;
};

interface FileDetailProps {
  itemId: string;
  // Renders a close affordance in the header when provided (used by the
  // side panel; the bottom sheet supplies its own close button).
  onClose?: () => void;
  // Called after a successful delete so the container can clear its selection.
  onDeleted: () => void;
}

// Detail view for a single item — metadata, a best-effort preview, and the
// property editor. Shared by the resizable side panel (wide screens) and the
// bottom sheet (narrow screens). Loads its own data on mount; remount it with a
// `key={itemId}` so a new selection re-runs the load.
export function FileDetail({ itemId, onClose, onDeleted }: FileDetailProps) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
  // Rename editor: null when idle, otherwise the in-progress draft name.
  const [renameDraft, setRenameDraft] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  const itemQuery = useQuery({
    queryKey: ["item", itemId],
    queryFn: () => keva.get(itemId),
  });
  const item = itemQuery.data ?? null;
  const loading = itemQuery.isLoading;
  const error = itemQuery.error ? errorMessage(itemQuery.error) : null;

  // Content bytes are cached (immutable per id), so re-opening a file is
  // instant and never re-downloads. The Blob is built once here and shared.
  const contentQuery = useQuery({
    queryKey: ["content", itemId],
    enabled: Boolean(item) && isPreviewable(item!),
    staleTime: Infinity,
    queryFn: async () => {
      const bytes = await keva.downloadBytes(itemId);
      return {
        bytes,
        blob: new Blob([bytes.slice().buffer as ArrayBuffer], {
          type: item!.contentType,
        }),
      };
    },
  });
  const previewLoading = contentQuery.isLoading;

  // Derive the preview from cached bytes. `objectUrlFor` is an LRU keyed by id,
  // so reading it during render reuses the same URL; entries are revoked on LRU
  // eviction or explicit delete. Best-effort: content errors are ignored here.
  const preview = useMemo<Preview | null>(() => {
    if (!item || !contentQuery.data) return null;
    const { bytes, blob } = contentQuery.data;
    if (isImage(item) || isPdf(item)) {
      return {
        kind: isImage(item) ? "image" : "pdf",
        url: objectUrlFor(itemId, blob),
      };
    }
    if (isCsv(item)) return { kind: "csv", text: new TextDecoder().decode(bytes) };
    return { kind: "text", text: new TextDecoder().decode(bytes).slice(0, 5000) };
  }, [item, contentQuery.data, itemId]);

  // Which panels this item exposes (Preview is dropped for non-previewable
  // files). The first entry is the default — Preview when available, else Info.
  const panels = useMemo(() => (item ? panelsFor(item) : []), [item]);

  // The active panel is derived from the URL, never stored separately: a valid
  // `?panel=` wins, otherwise we fall back to the default without touching the
  // address bar until the user actually picks a tab.
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
      // Drop the row from any cached list (whatever search is active) so it
      // disappears without a refetch; free its preview URL; then navigate away.
      queryClient.setQueriesData<ItemsCache>({ queryKey: ["items"] }, (old) =>
        old ? removeItemsFromPages(old, [itemId]) : old,
      );
      void queryClient.invalidateQueries({ queryKey: usageQueryKey });
      revokeObjectUrl(itemId);
      onDeleted();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const patchMutation = useMutation({
    mutationFn: (vars: { set: Record<string, PropertyValue>; unset: string[] }) =>
      keva.patch(itemId, vars),
    onSuccess: (updated) => {
      queryClient.setQueryData(["item", itemId], updated);
      // Keep the list rows in sync (e.g. a rename) without a refetch.
      queryClient.setQueriesData<ItemsCache>({ queryKey: ["items"] }, (old) =>
        old ? replaceItemInPages(old, updated) : old,
      );
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const busy = downloadMutation.isPending || deleteMutation.isPending;

  const onPatch = async (set: Record<string, PropertyValue>, unset: string[]) => {
    await patchMutation.mutateAsync({ set, unset });
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
    // Nothing to do on an empty or unchanged name — just leave the editor.
    if (!item || next === "" || next === item.name) {
      setRenameDraft(null);
      return;
    }
    try {
      await patchMutation.mutateAsync({ set: { name: next }, unset: [] });
      setRenameDraft(null);
    } catch {
      // onError already surfaced a toast; stay in edit mode so they can retry.
    }
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
        <div className="flex min-w-0 items-center gap-3">
          {item && <FileTypeIcon contentType={item.contentType} />}
          <div className="min-w-0 flex-1">
            {renameDraft !== null ? (
              // Enter commits, Escape/blur cancels — a careless click-away never
              // silently overwrites the name. The stem is pre-selected on focus.
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
                      <IconPencil />
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
              <IconDownload />
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
                <IconTrash />
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
              <IconX />
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
            <IconAlertTriangle />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : !item ? (
          <p className="text-sm text-muted-foreground">Not found.</p>
        ) : activePanel === "preview" ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            {previewLoading ? (
              // Mirror the shape of the content that will replace it: image
              // previews use a ratio-stable frame, while pdf/csv/text viewers
              // stretch to flex-1.
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
              <PDFViewer
                src={preview.url}
                fileName={item.name}
                defaultZoom={ZoomMode.FitWidth}
                showUpload={false}
                showDownload={false}
                className="min-h-0 w-full flex-1 overflow-hidden rounded-md bg-muted/30"
              />
            ) : preview?.kind === "csv" ? (
              <CsvViewer
                data={preview.text}
                search
                className="min-h-0 w-full flex-1 overflow-hidden rounded-md bg-muted/30"
              />
            ) : preview?.kind === "text" ? (
              // The scroll container is pinned to the content width (w-full
              // min-w-0); the <pre> keeps its natural width and scrolls
              // inside it, so long lines never widen the panel.
              <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-md bg-muted/50">
                <pre className="w-max p-3 font-mono text-xs">{preview.text}</pre>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Preview unavailable.</p>
            )}
          </section>
        ) : (
          // Info and properties are one surface: an item is just a bag of
          // key→value pairs. The system-owned keys (read-only) and the user's
          // own properties (editable) render as one list, told apart by the
          // leading icon on each row rather than by separate sections. Content
          // type and size live in the header above; these carry the rest.
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
