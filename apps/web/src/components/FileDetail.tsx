import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconDownload,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
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
import { removeItemsFromPages, type ItemsCache } from "../lib/items-cache";
import { keva } from "../lib/keva";
import { objectUrlFor, revokeObjectUrl } from "../lib/object-url-cache";
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
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Preview =
  | { kind: "image"; url: string }
  | { kind: "pdf"; url: string }
  | { kind: "csv"; text: string }
  | { kind: "text"; text: string };

const IMAGE_MAX = 5 * 1024 * 1024;
const PDF_MAX = 25 * 1024 * 1024;
const TEXT_MAX = 256 * 1024;
const isImage = (o: KevaItem) => o.contentType.startsWith("image/");
const isPdf = (o: KevaItem) => o.contentType === "application/pdf";
const isCsv = (o: KevaItem) =>
  o.contentType === "text/csv" ||
  o.contentType === "text/tab-separated-values" ||
  o.contentType === "application/csv";
const isText = (o: KevaItem) =>
  o.contentType.startsWith("text/") ||
  o.contentType === "application/json" ||
  o.contentType === "application/xml";
const isPreviewable = (o: KevaItem) =>
  (isImage(o) && (o.size ?? Infinity) <= IMAGE_MAX) ||
  (isPdf(o) && (o.size ?? Infinity) <= PDF_MAX) ||
  (isText(o) && (o.size ?? Infinity) <= TEXT_MAX);

type Panel = "preview" | "info" | "properties";

const PANEL_LABELS: Record<Panel, string> = {
  preview: "Preview",
  info: "Info",
  properties: "Properties",
};

// The panels available for an item, in display order. Preview is offered
// only when the content can actually be rendered; Info and Properties always
// exist. Determines which segmented-control buttons show and which `?panel=`
// values are valid.
const panelsFor = (o: KevaItem): Panel[] =>
  isPreviewable(o) ? ["preview", "info", "properties"] : ["info", "properties"];

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

  // Derive the preview from cached bytes. `objectUrlFor` is idempotent per id,
  // so reading it during render is safe (no leak under StrictMode); the URL is
  // revoked on unmount below. Best-effort: content errors are ignored here.
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
    paramPanel && panels.includes(paramPanel) ? paramPanel : (panels[0] ?? "info");

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
      revokeObjectUrl(itemId);
      onDeleted();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const patchMutation = useMutation({
    mutationFn: (vars: { set: Record<string, PropertyValue>; unset: string[] }) =>
      keva.patchProperties(itemId, vars),
    onSuccess: (updated) => queryClient.setQueryData(["item", itemId], updated),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const busy = downloadMutation.isPending || deleteMutation.isPending;

  // PropertiesEditor awaits this and reverts its own UI if it rejects.
  const onPatch = async (set: Record<string, PropertyValue>, unset: string[]) => {
    await patchMutation.mutateAsync({ set, unset });
  };

  const onImageLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setImageAspectRatio(image.naturalWidth / image.naturalHeight);
      }
    },
    [],
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {item && <FileTypeIcon contentType={item.contentType} />}
          <div className="min-w-0">
            <h2
              className="truncate font-heading text-base font-medium"
              title={item?.name}
            >
              {item?.name ?? "…"}
            </h2>
            {item && (
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
                  This permanently removes the item and its properties. This
                  cannot be undone.
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
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close"
              onClick={onClose}
            >
              <IconX />
            </Button>
          )}
        </div>
      </header>

      {item && (
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
              <p className="text-sm text-muted-foreground">
                Preview unavailable.
              </p>
            )}
          </section>
        ) : activePanel === "info" ? (
          <section className="min-w-0">
            {/* Content type and size live in the header above; keep this grid
                to the metadata that isn't shown elsewhere. */}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
              <MetaItem label="Status">
                <Badge variant="secondary">{item.status}</Badge>
              </MetaItem>
              <MetaItem label="Source">{item.source}</MetaItem>
              <MetaItem label="Created">
                <span title={formatDate(item.createdAt)}>
                  {formatRelative(item.createdAt)}
                </span>
              </MetaItem>
              <MetaItem label="Updated">
                <span title={formatDate(item.updatedAt)}>
                  {formatRelative(item.updatedAt)}
                </span>
              </MetaItem>
              <MetaItem label="ID" className="col-span-2">
                <span className="min-w-0 truncate font-mono text-xs">
                  {item.id}
                </span>
                <CopyButton value={item.id} label="Copy ID" />
              </MetaItem>
            </dl>
          </section>
        ) : (
          <section className="flex min-w-0 flex-col gap-2">
            <PropertiesEditor properties={item.properties} onPatch={onPatch} />
          </section>
        )}
      </div>
    </div>
  );
}

function MetaItem({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-sm">{children}</dd>
    </div>
  );
}
