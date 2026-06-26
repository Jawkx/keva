import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  IconAlertTriangle,
  IconFiles,
  IconUpload,
} from "@tabler/icons-react";
import type { KevaObject } from "@keva/sdk";
import { PageHeader } from "../components/PageHeader";
import { UploadModal } from "../components/UploadModal";
import { formatAttributeValue, formatBytes, formatDate } from "../lib/format";
import { keva } from "../lib/keva";
import { useApiError } from "../lib/useApiError";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function FilesPage() {
  const handleError = useApiError();
  const [objects, setObjects] = useState<readonly KevaObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await keva.query({ where: [], limit: 100 });
      setObjects(result.objects);
    } catch (err) {
      setError(handleError(err));
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Files"
        description="Every object you've stored in keva."
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <IconUpload data-icon="inline-start" />
            Upload
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <IconAlertTriangle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : objects.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFiles />
            </EmptyMedia>
            <EmptyTitle>No objects yet</EmptyTitle>
            <EmptyDescription>
              Upload your first file to get started.
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => setUploadOpen(true)}>
            <IconUpload data-icon="inline-start" />
            Upload
          </Button>
        </Empty>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Attributes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {objects.map((object) => {
                const attrKeys = Object.keys(object.attributes).slice(0, 2);
                return (
                  <TableRow key={object.id}>
                    <TableCell className="font-medium">
                      <Link
                        to={`/objects/${object.id}`}
                        className="hover:underline"
                      >
                        {object.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {object.contentType}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {formatBytes(object.size)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(object.createdAt)}
                    </TableCell>
                    <TableCell>
                      {attrKeys.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {attrKeys.map((key) => (
                            <Badge key={key} variant="secondary">
                              {key}={formatAttributeValue(object.attributes[key]!)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <UploadModal
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => void load()}
      />
    </div>
  );
}
