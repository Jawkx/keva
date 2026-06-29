import { useCallback, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type RowData,
  type RowSelectionState,
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
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type { KevaObject } from "@keva/sdk";
import { FileDetail } from "../components/FileDetail";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { UploadModal } from "../components/UploadModal";
import {
  formatAttributeValue,
  formatBytes,
  formatContentType,
  formatRelative,
} from "../lib/format";
import { keva } from "../lib/keva";
import { useApiError } from "../lib/useApiError";
import { useMediaQuery } from "../lib/useMediaQuery";
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
import { Checkbox } from "@/components/ui/checkbox";
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

declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    selectMode: boolean;
  }
}

const PAGE_SIZE = 50;

const plural = (n: number) => (n === 1 ? "object" : "objects");

const columnHelper = createColumnHelper<KevaObject>();

// Selection column stays out of the way until a row is hovered or selection
// mode is active (anything selected); the table meta carries that flag.
const selectModeOf = (meta: unknown) =>
  Boolean((meta as { selectMode?: boolean } | undefined)?.selectMode);

const columns = [
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all on this page"
        checked={table.getIsAllRowsSelected()}
        indeterminate={table.getIsSomeRowsSelected()}
        onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
        className={cn(
          "transition-opacity",
          selectModeOf(table.options.meta)
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100",
        )}
      />
    ),
    cell: ({ row, table }) => (
      <Checkbox
        aria-label="Select row"
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked)}
        className={cn(
          "transition-opacity",
          row.getIsSelected() || selectModeOf(table.options.meta)
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100",
        )}
      />
    ),
  }),
  columnHelper.accessor("name", {
    header: ({ column }) => <SortButton column={column} label="Name" />,
    cell: (ctx) => (
      <div className="flex min-w-0 items-center gap-3">
        <FileTypeIcon contentType={ctx.row.original.contentType} />
        <span className="truncate font-medium">{ctx.getValue()}</span>
      </div>
    ),
  }),
  columnHelper.accessor("contentType", {
    header: "Type",
    cell: (ctx) => (
      <span className="text-muted-foreground" title={ctx.getValue()}>
        {formatContentType(ctx.getValue())}
      </span>
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
  const [activeSearch, setActiveSearch] = useState("");
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

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
          ...(activeSearch.trim() ? { search: activeSearch.trim() } : {}),
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
    [activeSearch, cursor, handleError],
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

  const selectMode = Object.values(rowSelection).some(Boolean);

  const table = useReactTable({
    data: objects as KevaObject[],
    columns,
    state: { sorting, columnVisibility, rowSelection },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    meta: { selectMode },
  });

  const rows = table.getRowModel().rows;
  // Intersect selection with currently loaded rows so a stale id (e.g. after a
  // search narrows the list) never counts toward the action bar.
  const selectedRows = table.getSelectedRowModel().rows;
  const selectedCount = selectedRows.length;

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

  const onBulkDelete = async () => {
    const ids = table.getSelectedRowModel().rows.map((r) => r.original.id);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const result = await keva.deleteMany(ids);
      if (result.deleted.length > 0) {
        toast.success(
          `Deleted ${result.deleted.length} ${plural(result.deleted.length)}`,
        );
      }
      if (result.failed.length > 0) {
        toast.error(
          `Failed to delete ${result.failed.length} ${plural(result.failed.length)}`,
        );
      }
      setRowSelection({});
      // The open detail may have been one of the deleted rows.
      if (selectedId && ids.includes(selectedId)) navigate("/");
      await load(true);
    } catch (err) {
      toast.error(handleError(err));
    } finally {
      setBulkBusy(false);
    }
  };

  const runSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = search.trim();
    setActiveSearch(next);
    setCursor(undefined);
    setRowSelection({});
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const result = await keva.query({
          where: [],
          ...(next ? { search: next } : {}),
          limit: PAGE_SIZE,
        });
        setObjects(result.objects);
        setCursor(result.nextCursor);
      } catch (err) {
        setError(handleError(err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    })();
  };

  const tableInner = (
    <Table className="[&_td]:px-3 [&_th]:px-3">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="group">
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                className={header.column.id === "select" ? "w-10" : undefined}
              >
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
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={`skeleton-${i}`}>
                {table.getVisibleLeafColumns().map((col) => (
                  <TableCell
                    key={col.id}
                    className={col.id === "select" ? "w-10" : undefined}
                  >
                    {col.id !== "select" && <Skeleton className="h-5 w-full" />}
                  </TableCell>
                ))}
              </TableRow>
            ))
          : rows.map((row) => (
          <TableRow
            key={row.id}
            data-state={
              row.getIsSelected() || row.original.id === selectedId
                ? "selected"
                : undefined
            }
            className="group cursor-pointer"
            onClick={() =>
              navigate(
                row.original.id === selectedId
                  ? "/"
                  : `/objects/${row.original.id}`,
              )
            }
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell
                key={cell.id}
                className={cell.column.id === "select" ? "w-10" : undefined}
                // The checkbox cell toggles selection; don't also open detail.
                onClick={
                  cell.column.id === "select"
                    ? (e) => e.stopPropagation()
                    : undefined
                }
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const loadMore = cursor && (
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
      <div className="flex shrink-0 flex-wrap items-center gap-3 p-3">
        {selectMode ? (
          <>
            <span className="text-sm font-medium">
              {selectedCount} selected
            </span>
            <Button variant="ghost" onClick={() => setRowSelection({})}>
              Clear
            </Button>
            <AlertDialog
              open={bulkConfirmOpen}
              onOpenChange={setBulkConfirmOpen}
            >
              <AlertDialogTrigger
                render={
                  <Button
                    variant="destructive"
                    className="ml-auto"
                    disabled={bulkBusy}
                  />
                }
              >
                <IconTrash data-icon="inline-start" />
                Delete
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Delete {selectedCount} {plural(selectedCount)}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the selected{" "}
                    {plural(selectedCount)} and their attributes. This cannot be
                    undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      setBulkConfirmOpen(false);
                      void onBulkDelete();
                    }}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <>
            <form
              className="flex w-full items-center gap-2 sm:w-72"
              onSubmit={runSearch}
            >
              <div className="relative min-w-0 flex-1">
                <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name or type…"
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
            <Button className="sm:ml-auto" onClick={() => openUpload([])}>
              <IconUpload data-icon="inline-start" />
              Upload
            </Button>
          </>
        )}
      </div>
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto">
        {!loading && rows.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconSearch />
              </EmptyMedia>
              <EmptyTitle>No matches</EmptyTitle>
              <EmptyDescription>
                No objects match “{activeSearch}”.
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

      {!loading && !hasObjects ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Empty>
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
