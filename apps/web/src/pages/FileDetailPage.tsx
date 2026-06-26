import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  IconAlertTriangle,
  IconDownload,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type { AttributeValue } from "@keva/schema";
import type { KevaObject } from "@keva/sdk";
import { AttributesEditor } from "../components/AttributesEditor";
import { PageHeader } from "../components/PageHeader";
import { formatBytes, formatDate } from "../lib/format";
import { keva } from "../lib/keva";
import { useApiError } from "../lib/useApiError";
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

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-32 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-sm">{children}</dd>
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

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setObject(await keva.get(id));
    } catch (err) {
      setError(handleError(err));
    } finally {
      setLoading(false);
    }
  }, [id, handleError]);

  useEffect(() => {
    void load();
  }, [load]);

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
              <span className="font-mono">{object.id}</span>
            </MetaRow>
            <MetaRow label="Content type">{object.contentType}</MetaRow>
            <MetaRow label="Size">{formatBytes(object.size)}</MetaRow>
            <MetaRow label="Status">
              <Badge variant="secondary">{object.status}</Badge>
            </MetaRow>
            <MetaRow label="Source">{object.source}</MetaRow>
            <MetaRow label="Created">{formatDate(object.createdAt)}</MetaRow>
            <MetaRow label="Updated">{formatDate(object.updatedAt)}</MetaRow>
          </dl>
        </CardContent>
      </Card>

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
