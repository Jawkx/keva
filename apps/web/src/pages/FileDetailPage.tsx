import { useCallback, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconDownload,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type { AttributeValue } from "@keva/schema";
import type { KevaObject } from "@keva/sdk";
import { AttributesEditor } from "../components/AttributesEditor";
import { CopyButton } from "../components/CopyButton";
import { PageHeader } from "../components/PageHeader";
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-2.5 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <dt className="w-32 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 break-all text-sm">
        {children}
      </dd>
    </div>
  );
}

export function FileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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
    if (!id) return null;
    setLoading(true);
    setError(null);
    try {
      const obj = await keva.get(id);
      setObject(obj);
      return obj;
    } catch (err) {
      setError(handleError(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [id, handleError]);

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
      // Preview is best-effort; the download/delete actions still surface errors.
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
      navigate("/", { replace: true });
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

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (error && !object) {
    return (
      <Alert variant="destructive">
        <IconAlertTriangle />
        <AlertTitle>{error}</AlertTitle>
      </Alert>
    );
  }
  if (!object) {
    return <p className="text-muted-foreground">Not found.</p>;
  }

  return (
    <div>
      <Link
        to="/"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" />
        Files
      </Link>

      <PageHeader
        title={object.name}
        actions={
          <>
            <Button variant="outline" onClick={onDownload} disabled={busy}>
              <IconDownload data-icon="inline-start" />
              Download
            </Button>
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogTrigger
                render={<Button variant="destructive" disabled={busy} />}
              >
                <IconTrash data-icon="inline-start" />
                Delete
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete “{object.name}”?</AlertDialogTitle>
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
          </>
        }
      />

      <Card className="mb-6">
        <CardContent>
          <dl>
            <MetaRow label="ID">
              <span className="truncate font-mono">{object.id}</span>
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
        </CardContent>
      </Card>

      {isPreviewable(object) && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {previewLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : preview?.kind === "image" ? (
              <img
                src={preview.url}
                alt={object.name}
                className="max-h-96 w-auto rounded-md border"
              />
            ) : preview?.kind === "text" ? (
              <pre className="max-h-96 overflow-auto rounded-md border bg-muted/50 p-3 font-mono text-xs">
                {preview.text}
              </pre>
            ) : (
              <p className="text-sm text-muted-foreground">
                Preview unavailable.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Attributes</CardTitle>
        </CardHeader>
        <CardContent>
          <AttributesEditor attributes={object.attributes} onPatch={onPatch} />
        </CardContent>
      </Card>
    </div>
  );
}
