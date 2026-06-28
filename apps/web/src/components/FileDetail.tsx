import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  IconAlertTriangle,
  IconDownload,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type { AttributeValue } from "@keva/schema";
import type { KevaObject } from "@keva/sdk";
import { AttributesEditor } from "./AttributesEditor";
import { CopyButton } from "./CopyButton";
import { FileTypeIcon } from "./FileTypeIcon";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import { CsvViewer } from "@/components/ui/csv-viewer";
import { PDFViewer } from "@/components/ui/pdf-viewer";
import { formatBytes, formatDate, formatRelative } from "../lib/format";
import { keva } from "../lib/keva";
import { useApiError } from "../lib/useApiError";
import { useMountEffect } from "../lib/useMountEffect";
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
const isImage = (o: KevaObject) => o.contentType.startsWith("image/");
const isPdf = (o: KevaObject) => o.contentType === "application/pdf";
const isCsv = (o: KevaObject) =>
  o.contentType === "text/csv" ||
  o.contentType === "text/tab-separated-values" ||
  o.contentType === "application/csv";
const isText = (o: KevaObject) =>
  o.contentType.startsWith("text/") ||
  o.contentType === "application/json" ||
  o.contentType === "application/xml";
const isPreviewable = (o: KevaObject) =>
  (isImage(o) && (o.size ?? Infinity) <= IMAGE_MAX) ||
  (isPdf(o) && (o.size ?? Infinity) <= PDF_MAX) ||
  (isText(o) && (o.size ?? Infinity) <= TEXT_MAX);

type Panel = "preview" | "info" | "attributes";

const PANEL_LABELS: Record<Panel, string> = {
  preview: "Preview",
  info: "Info",
  attributes: "Attributes",
};

// The panels available for an object, in display order. Preview is offered
// only when the content can actually be rendered; Info and Attributes always
// exist. Determines which segmented-control buttons show and which `?panel=`
// values are valid.
const panelsFor = (o: KevaObject): Panel[] =>
  isPreviewable(o) ? ["preview", "info", "attributes"] : ["info", "attributes"];

interface FileDetailProps {
  objectId: string;
  // Renders a close affordance in the header when provided (used by the
  // side panel; the bottom sheet supplies its own close button).
  onClose?: () => void;
  // Called after a successful delete so the container can clear its selection.
  onDeleted: () => void;
}

// Detail view for a single object — metadata, a best-effort preview, and the
// attribute editor. Shared by the resizable side panel (wide screens) and the
// bottom sheet (narrow screens). Loads its own data on mount; remount it with a
// `key={objectId}` so a new selection re-runs the load.
export function FileDetail({ objectId, onClose, onDeleted }: FileDetailProps) {
  const handleError = useApiError();
  const [object, setObject] = useState<KevaObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();

  // Which panels this object exposes (Preview is dropped for non-previewable
  // files). The first entry is the default — Preview when available, else Info.
  const panels = useMemo(() => (object ? panelsFor(object) : []), [object]);

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

  const load = useCallback(async (): Promise<KevaObject | null> => {
    setLoading(true);
    setError(null);
    try {
      const obj = await keva.get(objectId);
      setObject(obj);
      return obj;
    } catch (err) {
      setError(handleError(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [objectId, handleError]);

  const loadPreview = useCallback(async (obj: KevaObject) => {
    setPreviewLoading(true);
    try {
      const bytes = await keva.downloadBytes(obj.id);
      if (isImage(obj) || isPdf(obj)) {
        const url = URL.createObjectURL(
          new Blob([bytes.slice().buffer as ArrayBuffer], {
            type: obj.contentType,
          }),
        );
        previewUrlRef.current = url;
        setPreview({ kind: isImage(obj) ? "image" : "pdf", url });
      } else if (isCsv(obj)) {
        // The CSV viewer parses the full text itself; don't truncate.
        setPreview({ kind: "csv", text: new TextDecoder().decode(bytes) });
      } else {
        setPreview({
          kind: "text",
          text: new TextDecoder().decode(bytes).slice(0, 5000),
        });
      }
    } catch {
      // Preview is best-effort; download/delete still surface their own errors.
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useMountEffect(() => {
    void (async () => {
      const obj = await load();
      if (obj && isPreviewable(obj)) await loadPreview(obj);
    })();
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  });

  const onDownload = async () => {
    if (!object) return;
    setBusy(true);
    try {
      const { url } = await keva.getDownloadUrl(object.id);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = object.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (err) {
      toast.error(handleError(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!object) return;
    setBusy(true);
    try {
      await keva.delete(object.id);
      toast.success(`Deleted ${object.name}`);
      onDeleted();
    } catch (err) {
      toast.error(handleError(err));
      setBusy(false);
    }
  };

  const onPatch = async (
    set: Record<string, AttributeValue>,
    unset: string[],
  ) => {
    if (!object) return;
    try {
      setObject(await keva.patchAttributes(object.id, { set, unset }));
    } catch (err) {
      toast.error(handleError(err));
      throw err;
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <header className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {object && <FileTypeIcon contentType={object.contentType} />}
          <div className="min-w-0">
            <h2
              className="truncate font-heading text-base font-medium"
              title={object?.name}
            >
              {object?.name ?? "…"}
            </h2>
            {object && (
              <p className="truncate text-sm text-muted-foreground">
                {object.contentType} · {formatBytes(object.size)}
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
                  disabled={busy || !object}
                  onClick={onDownload}
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
                        disabled={busy || !object}
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
                <AlertDialogTitle>Delete “{object?.name}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes the object and its attributes. This
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    setConfirmOpen(false);
                    void onDelete();
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

      {object && (
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
        ) : error && !object ? (
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : !object ? (
          <p className="text-sm text-muted-foreground">Not found.</p>
        ) : activePanel === "preview" ? (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            {previewLoading ? (
              // Mirror the shape of the content that will replace it: images
              // render capped at max-h-96 (they don't fill the panel), while
              // pdf/csv/text viewers stretch to flex-1.
              isImage(object) ? (
                <Skeleton className="h-96 w-full max-w-full" />
              ) : (
                <Skeleton className="min-h-0 w-full flex-1" />
              )
            ) : preview?.kind === "image" ? (
              <img
                src={preview.url}
                alt={object.name}
                className="max-h-96 max-w-full rounded-md"
              />
            ) : preview?.kind === "pdf" ? (
              <PDFViewer
                src={preview.url}
                fileName={object.name}
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
                <Badge variant="secondary">{object.status}</Badge>
              </MetaItem>
              <MetaItem label="Source">{object.source}</MetaItem>
              <MetaItem label="Created">
                <span title={formatDate(object.createdAt)}>
                  {formatRelative(object.createdAt)}
                </span>
              </MetaItem>
              <MetaItem label="Updated">
                <span title={formatDate(object.updatedAt)}>
                  {formatRelative(object.updatedAt)}
                </span>
              </MetaItem>
              <MetaItem label="ID" className="col-span-2">
                <span className="min-w-0 truncate font-mono text-xs">
                  {object.id}
                </span>
                <CopyButton value={object.id} label="Copy ID" />
              </MetaItem>
            </dl>
          </section>
        ) : (
          <section className="flex min-w-0 flex-col gap-2">
            <AttributesEditor attributes={object.attributes} onPatch={onPatch} />
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
