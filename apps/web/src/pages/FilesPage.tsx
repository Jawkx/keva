import { useCallback, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
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
import { FileDetail } from "../components/FileDetail";
import { UploadModal } from "../components/UploadModal";
import {
  formatAttributeValue,
  formatBytes,
  formatRelative,
} from "../lib/format";
import { keva } from "../lib/keva";
import { useApiError } from "../lib/useApiError";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useMountEffect } from "../lib/useMountEffect";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
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

const columnHelper = createColumnHelper<KevaObject>();

const columns = [
  columnHelper.accessor("name", {
    header: ({ column }) => <SortButton column={column} label="Name" />,
    cell: (ctx) => (
      <span className="font-medium">{ctx.getValue()}</span>
    ),
  }),
  columnHelper.accessor("contentType", {
    header: "Type",
    cell: (ctx) => (
      <span className="text-muted-foreground">{ctx.getValue()}</span>
    ),
  }),
  columnHelper.accessor((o) => o.size ?? 0, {
    id: "size",
    header: ({ column }) => <SortButton column={column} label="Size" />,
    cell: (ctx) => (
      <span className="text-muted-foreground tabular-nums">
        {formatBytes(ctx.row.original.size)}
      </span>
    ),
  }),
  columnHelper.accessor((o) => new Date(o.createdAt).getTime(), {
    id: "createdAt",
    header: ({ column }) => <SortButton column={column} label="Created" />,
    cell: (ctx) => (
      <span className="text-muted-foreground">
        {formatRelative(ctx.row.original.createdAt)}
      </span>
    ),
  }),
  columnHelper.display({
    id: "attributes",
    header: "Attributes",
    cell: (ctx) => {
      const keys = Object.keys(ctx.row.original.attributes).slice(0, 2);
      if (keys.length === 0)
        return <span className="text-muted-foreground">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {keys.map((key) => (
            <Badge key={key} variant="secondary">
              {key}={formatAttributeValue(ctx.row.original.attributes[key]!)}
            </Badge>
          ))}
        </div>
      );
    },
  }),
];

export function FilesPage() {
  const navigate = useNavigate();
  const { id: selectedId } = useParams<{ id: string }>();
  const handleError = useApiError();
  // Split layout only makes sense once there's room for two panes side by side.
  const isWide = useMediaQuery("(min-width: 1024px)");

  const [objects, setObjects] = useState<readonly KevaObject[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);

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

  // Detail open in the side panel; collapse secondary columns so the list
  // stays readable in the narrower remaining space.
  const splitOpen = Boolean(selectedId) && isWide;
  const columnVisibility: VisibilityState = {
    contentType: !splitOpen,
    createdAt: !splitOpen,
    attributes: !splitOpen,
  };

  const table = useReactTable({
    data: objects as KevaObject[],
    columns,
    state: { sorting, globalFilter: search, columnVisibility },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    globalFilterFn: (row, _columnId, value: string) => {
      const q = value.trim().toLowerCase();
      if (!q) return true;
      const o = row.original;
      return (
        o.name.toLowerCase().includes(q) ||
        o.contentType.toLowerCase().includes(q)
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;

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

  const closeDetail = () => navigate("/");
  const onDeleted = () => {
    navigate("/");
    void load(true);
  };

  const tableInner = (
    <Table>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead key={header.id}>
                {header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            data-state={row.original.id === selectedId ? "selected" : undefined}
            className="cursor-pointer"
            onClick={() =>
              navigate(
                row.original.id === selectedId
                  ? "/"
                  : `/objects/${row.original.id}`,
              )
            }
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const loadMore = cursor && !search && (
    <div className="mt-4 flex justify-center">
      <Button
        variant="outline"
        disabled={loadingMore}
        onClick={() => void load(false)}
      >
        {loadingMore ? "Loading…" : "Load more"}
      </Button>
    </div>
  );

  const hasObjects = objects.length > 0;

  // Left pane: its own toolbar (filter + upload) above the scrollable table.
  // Used full-width when no detail is open, and as the left side of the split.
  const leftPane = (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b p-3">
        <div className="relative w-full max-w-xs">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by name or type…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex-1" />
        <Button onClick={() => openUpload([])}>
          <IconUpload data-icon="inline-start" />
          Upload
        </Button>
      </div>
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <Empty className="py-16">
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
            {tableInner}
            {loadMore}
          </>
        )}
      </div>
    </div>
  );

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
      className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
    >
      {pageDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary px-10 py-8 text-center">
            <IconCloudUpload className="size-7 text-primary" />
            <p className="font-medium">Drop to upload</p>
          </div>
        </div>
      )}

      {error && (
        <div className="shrink-0 p-4">
          <Alert variant="destructive">
            <IconAlertTriangle />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 flex-col gap-2 p-4 md:p-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !hasObjects ? (
        <div className="flex flex-1 items-center justify-center p-6">
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
        </div>
      ) : splitOpen ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 w-full min-w-0 flex-1"
        >
          <ResizablePanel defaultSize={58} minSize={35} className="min-w-0">
            {leftPane}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={42} minSize={28} className="min-w-0">
            <FileDetail
              key={selectedId}
              objectId={selectedId!}
              onClose={closeDetail}
              onDeleted={onDeleted}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-hidden">
          {leftPane}
        </div>
      )}

      {/* Narrow screens: detail opens as a bottom sheet over the list. */}
      <Sheet
        open={Boolean(selectedId) && !isWide}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
      >
        <SheetContent side="bottom" showCloseButton={false} className="h-[85vh] p-0">
          <SheetTitle className="sr-only">File details</SheetTitle>
          {selectedId && (
            <FileDetail
              key={selectedId}
              objectId={selectedId}
              onClose={closeDetail}
              onDeleted={onDeleted}
            />
          )}
        </SheetContent>
      </Sheet>

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

function SortButton({
  column,
  label,
}: {
  column: Column<KevaObject, unknown>;
  label: string;
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={cn(
        "-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground",
        sorted && "text-foreground",
      )}
    >
      {label}
      {sorted === "asc" ? (
        <IconArrowUp className="size-3.5" />
      ) : sorted === "desc" ? (
        <IconArrowDown className="size-3.5" />
      ) : (
        <IconArrowsSort className="size-3.5 opacity-50" />
      )}
    </button>
  );
}
