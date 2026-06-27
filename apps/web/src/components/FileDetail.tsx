import { useCallback, useRef, useState } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Preview = { kind: "image"; url: string } | { kind: "text"; text: string };

const IMAGE_MAX = 5 * 1024 * 1024;
const TEXT_MAX = 256 * 1024;
const isImage = (o: KevaObject) => o.contentType.startsWith("image/");
const isText = (o: KevaObject) =>
  o.contentType.startsWith("text/") ||
  o.contentType === "application/json" ||
  o.contentType === "application/xml";
const isPreviewable = (o: KevaObject) =>
  (isImage(o) && (o.size ?? Infinity) <= IMAGE_MAX) ||
  (isText(o) && (o.size ?? Infinity) <= TEXT_MAX);

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
      const bytes = await keva.download(obj.id);
      if (isImage(obj)) {
        const url = URL.createObjectURL(
          new Blob([bytes.slice().buffer as ArrayBuffer], {
            type: obj.contentType,
          }),
        );
        previewUrlRef.current = url;
        setPreview({ kind: "image", url });
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
      const bytes = await keva.download(object.id);
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: object.contentType,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = object.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
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
      <header className="flex items-start justify-between gap-2 border-b p-4">
        <div className="min-w-0">
          <h2 className="truncate font-heading text-base font-medium" title={object?.name}>
            {object?.name ?? "…"}
          </h2>
          {object && (
            <p className="truncate text-xs text-muted-foreground">
              {object.contentType} · {formatBytes(object.size)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
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
                        size="icon-sm"
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
        ) : (
          <>
            <section className="min-w-0">
              <dl className="rounded-lg border px-4">
                <MetaRow label="ID">
                  <span className="min-w-0 truncate font-mono">{object.id}</span>
                  <CopyButton value={object.id} label="Copy ID" />
                </MetaRow>
                <MetaRow label="Content type">{object.contentType}</MetaRow>
                <MetaRow label="Size">{formatBytes(object.size)}</MetaRow>
                <MetaRow label="Status">
                  <Badge variant="secondary">{object.status}</Badge>
                </MetaRow>
                <MetaRow label="Source">{object.source}</MetaRow>
                <MetaRow label="Created">
                  <span title={formatDate(object.createdAt)}>
                    {formatRelative(object.createdAt)}
                  </span>
                </MetaRow>
                <MetaRow label="Updated">
                  <span title={formatDate(object.updatedAt)}>
                    {formatRelative(object.updatedAt)}
                  </span>
                </MetaRow>
              </dl>
            </section>

            {isPreviewable(object) && (
              <section className="flex min-w-0 flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground uppercase">
                  Preview
                </h3>
                {previewLoading ? (
                  <Skeleton className="h-48 w-full" />
                ) : preview?.kind === "image" ? (
                  <img
                    src={preview.url}
                    alt={object.name}
                    className="max-h-96 max-w-full rounded-md border"
                  />
                ) : preview?.kind === "text" ? (
                  // The scroll container is pinned to the content width (w-full
                  // min-w-0); the <pre> keeps its natural width and scrolls
                  // inside it, so long lines never widen the panel.
                  <div className="max-h-96 w-full min-w-0 overflow-auto rounded-md border bg-muted/50">
                    <pre className="w-max p-3 font-mono text-xs">
                      {preview.text}
                    </pre>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Preview unavailable.
                  </p>
                )}
              </section>
            )}

            <section className="flex min-w-0 flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground uppercase">
                Attributes
              </h3>
              <AttributesEditor
                attributes={object.attributes}
                onPatch={onPatch}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <dt className="w-28 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 break-all text-sm">
        {children}
      </dd>
    </div>
  );
}
