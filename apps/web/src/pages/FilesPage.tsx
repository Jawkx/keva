import { useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowsSort,
  IconArrowUp,
  IconCloudUpload,
  IconFiles,
  IconSearch,
  IconUpload,
} from "@tabler/icons-react";
import type { KevaObject } from "@keva/sdk";
import { PageHeader } from "../components/PageHeader";
import { UploadModal } from "../components/UploadModal";
import {
  formatAttributeValue,
  formatBytes,
  formatRelative,
} from "../lib/format";
import { keva } from "../lib/keva";
import { useApiError } from "../lib/useApiError";
import { useMountEffect } from "../lib/useMountEffect";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

type SortKey = "name" | "size" | "createdAt";
type SortDir = "asc" | "desc";

export function FilesPage() {
  const navigate = useNavigate();
  const handleError = useApiError();
  const [objects, setObjects] = useState<readonly KevaObject[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadKey, setUploadKey] = useState(0);

  const [pageDragging, setPageDragging] = useState(false);
  const dragDepth = useRef(0);

  const load = useCallback(
    async (reset: boolean) => {
      if (reset) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const result = await keva.query({
          where: [],
          limit: PAGE_SIZE,
          ...(reset ? {} : cursor ? { cursor } : {}),
        });
        setObjects((prev) =>
          reset ? result.objects : [...prev, ...result.objects],
        );
        setCursor(result.nextCursor);
      } catch (err) {
        setError(handleError(err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [cursor, handleError],
  );

  useMountEffect(() => {
    void load(true);
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? objects.filter(
          (o) =>
            o.name.toLowerCase().includes(q) ||
            o.contentType.toLowerCase().includes(q),
        )
      : objects;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "size") return ((a.size ?? 0) - (b.size ?? 0)) * dir;
      if (sortKey === "createdAt")
        return (
          (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) *
          dir
        );
      return a.name.localeCompare(b.name) * dir;
    });
  }, [objects, search, sortKey, sortDir]);

  const stats = useMemo(() => {
    const totalSize = objects.reduce((sum, o) => sum + (o.size ?? 0), 0);
    const types = new Set(objects.map((o) => o.contentType));
    return { count: objects.length, totalSize, types: types.size };
  }, [objects]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const openUpload = (files: File[]) => {
    setPendingFiles(files);
    setUploadKey((k) => k + 1);
    setUploadOpen(true);
  };

  const onPageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setPageDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) openUpload(dropped);
  };

  return (
    <div
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        dragDepth.current += 1;
        setPageDragging(true);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setPageDragging(false);
      }}
      onDrop={onPageDrop}
      className="relative"
    >
      {pageDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary px-10 py-8 text-center">
            <IconCloudUpload className="size-7 text-primary" />
            <p className="font-medium">Drop to upload</p>
          </div>
        </div>
      )}

      <PageHeader
        title="Files"
        description="Every object you've stored in keva."
        actions={
          <Button onClick={() => openUpload([])}>
            <IconUpload data-icon="inline-start" />
            Upload
          </Button>
        }
      />

      {!loading && objects.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatCard
            label="Objects"
            value={`${stats.count}${cursor ? "+" : ""}`}
          />
          <StatCard label="Total size" value={formatBytes(stats.totalSize)} />
          <StatCard label="Types" value={String(stats.types)} />
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <IconAlertTriangle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      {!loading && objects.length > 0 && (
        <div className="relative mb-3 max-w-xs">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by name or type…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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
              Upload your first file, or drop one anywhere on this page.
            </EmptyDescription>
          </EmptyHeader>
          <Button onClick={() => openUpload([])}>
            <IconUpload data-icon="inline-start" />
            Upload
          </Button>
        </Empty>
      ) : visible.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconSearch />
            </EmptyMedia>
            <EmptyTitle>No matches</EmptyTitle>
            <EmptyDescription>
              No objects match “{search}”.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader
                    label="Name"
                    active={sortKey === "name"}
                    dir={sortDir}
                    onClick={() => toggleSort("name")}
                  />
                  <TableHead>Type</TableHead>
                  <SortHeader
                    label="Size"
                    active={sortKey === "size"}
                    dir={sortDir}
                    onClick={() => toggleSort("size")}
                  />
                  <SortHeader
                    label="Created"
                    active={sortKey === "createdAt"}
                    dir={sortDir}
                    onClick={() => toggleSort("createdAt")}
                  />
                  <TableHead>Attributes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((object) => {
                  const attrKeys = Object.keys(object.attributes).slice(0, 2);
                  return (
                    <TableRow
                      key={object.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/objects/${object.id}`)}
                    >
                      <TableCell className="font-medium">
                        <Link
                          to={`/objects/${object.id}`}
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
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
                        {formatRelative(object.createdAt)}
                      </TableCell>
                      <TableCell>
                        {attrKeys.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {attrKeys.map((key) => (
                              <Badge key={key} variant="secondary">
                                {key}=
                                {formatAttributeValue(object.attributes[key]!)}
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

          {cursor && !search && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                disabled={loadingMore}
                onClick={() => void load(false)}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}

      <UploadModal
        key={uploadKey}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        initialFiles={pendingFiles}
        onUploaded={() => void load(true)}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-0">
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-heading text-2xl font-semibold tabular-nums">
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <TableHead>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <IconArrowUp className="size-3.5" />
          ) : (
            <IconArrowDown className="size-3.5" />
          )
        ) : (
          <IconArrowsSort className="size-3.5 opacity-50" />
        )}
      </button>
    </TableHead>
  );
}
