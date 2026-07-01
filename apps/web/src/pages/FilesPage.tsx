import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  IconFilter,
  IconLoader2,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type { QueryCondition } from "@keva/schema";
import type { KevaItem } from "@keva/sdk";
import { FileDetail } from "../components/FileDetail";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { FilterPanel } from "../components/FilterPanel";
import { UploadModal } from "../components/UploadModal";
import { errorMessage } from "../lib/errors";
import { formatPropertyValue, formatBytes, formatContentType, formatRelative } from "../lib/format";
import { createFilterDraft } from "../lib/item-filters";
import {
  itemsQueryKey,
  prependItemToPages,
  removeItemsFromPages,
  type ItemsCache,
} from "../lib/items-cache";
import { keva } from "../lib/keva";
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
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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
    onRetryUpload: (id: string, file: File) => void;
  }
}

const PAGE_SIZE = 50;

const plural = (n: number) => (n === 1 ? "item" : "items");

// A table row is either a real item from the server or an optimistic row for a
// file that is still uploading (or failed). The optimistic row borrows the
// KevaItem shape — only `name`, `contentType` and `size` are real; the rest are
// placeholders that never reach the screen — plus a client-only `upload` marker.
type FileRow = KevaItem & {
  upload?: { status: "uploading" | "error"; file: File; error?: string };
};

// Placeholder fields are never rendered (uploading rows show name/type/size
// only); they exist solely to satisfy the KevaItem shape until the real item
// arrives. `createdAt: now` keeps the row at the top under the default sort.
const optimisticRow = (id: string, file: File): FileRow => {
  const now = new Date().toISOString();
  return {
    id,
    tenantId: "",
    name: file.name,
    contentType: file.type || "application/octet-stream",
    declaredSize: file.size,
    size: file.size,
    etag: null,
    checksum: null,
    source: "upload",
    status: "pending",
    storageKey: "pending",
    stagingKey: "pending",
    createdAt: now,
    updatedAt: now,
    properties: {},
    upload: { status: "uploading", file },
  };
};

const columnHelper = createColumnHelper<FileRow>();

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
          selectModeOf(table.options.meta) ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      />
    ),
    cell: ({ row, table }) => {
      const upload = row.original.upload;
      if (upload?.status === "uploading") {
        return (
          <IconLoader2
            aria-label="Uploading"
            className="size-4 animate-spin text-muted-foreground"
          />
        );
      }
      if (upload?.status === "error") {
        return (
          <button
            type="button"
            aria-label={`Upload failed: ${upload.error ?? "unknown error"}. Click to retry`}
            title={`${upload.error ?? "Upload failed"} — click to retry`}
            onClick={() => table.options.meta?.onRetryUpload(row.original.id, upload.file)}
            className="flex size-5 items-center justify-center rounded text-destructive hover:bg-destructive/10"
          >
            <IconAlertTriangle className="size-4" />
          </button>
        );
      }
      return (
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
      );
    },
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
      <span className="text-muted-foreground">{formatRelative(ctx.row.original.createdAt)}</span>
    ),
  }),
  columnHelper.display({
    id: "properties",
    header: "Properties",
    cell: (ctx) => {
      const keys = Object.keys(ctx.row.original.properties).slice(0, 2);
      if (keys.length === 0) return <span className="text-muted-foreground">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {keys.map((key) => (
            <Badge key={key} variant="secondary">
              {key}={formatPropertyValue(ctx.row.original.properties[key]!)}
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
  const queryClient = useQueryClient();
  // Split layout only makes sense once there's room for two panes side by side.
  const isWide = useMediaQuery("(min-width: 1024px)");

  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [activeWhere, setActiveWhere] = useState<QueryCondition[]>([]);
  const [filterDraft, setFilterDraft] = useState(createFilterDraft);
  const [showFilters, setShowFilters] = useState(false);
  // Debounce timer for free-text search; scheduled from the change handler (an
  // event, not a lifecycle effect) and cleared on unmount so a late tick can't
  // set state after the page is gone.
  const searchTimer = useRef<number | undefined>(undefined);
  useMountEffect(() => () => window.clearTimeout(searchTimer.current));
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // Optimistic upload rows (uploading / failed-with-retry). Kept separate from
  // the React Query list cache: failed uploads must persist with a retry
  // affordance rather than roll back, and survive list refetches.
  const [uploads, setUploads] = useState<FileRow[]>([]);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadKey, setUploadKey] = useState(0);

  const [pageDragging, setPageDragging] = useState(false);
  const dragDepth = useRef(0);

  const itemsQuery = useInfiniteQuery({
    queryKey: itemsQueryKey(activeSearch, activeWhere),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      keva.query({
        where: activeWhere,
        ...(activeSearch.trim() ? { search: activeSearch.trim() } : {}),
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor,
  });

  const loading = itemsQuery.isLoading;
  const error = itemsQuery.error ? errorMessage(itemsQuery.error) : null;
  const serverItems = useMemo(
    () => itemsQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [itemsQuery.data],
  );
  // Upload rows sit on top of the server list; memoized so react-table doesn't
  // rebuild its row model every render.
  const tableData = useMemo<FileRow[]>(() => [...uploads, ...serverItems], [uploads, serverItems]);

  // Detail open in the side panel; collapse secondary columns so the list
  // stays readable in the narrower remaining space.
  const splitOpen = Boolean(selectedId) && isWide;
  const columnVisibility: VisibilityState = {
    contentType: !splitOpen,
    createdAt: !splitOpen,
    properties: !splitOpen,
  };

  const selectMode = Object.values(rowSelection).some(Boolean);
  // Whether anything is narrowing the list — drives the toolbar "Clear" button.
  const filtered = activeSearch.trim().length > 0 || activeWhere.length > 0;

  // Upload lifecycle. Files appear instantly as optimistic rows; each upload
  // runs independently and reconciles its own row — moving the real item into
  // the list cache on success, or flipping to a retryable error on failure.
  const uploadOne = useCallback(
    async (id: string, file: File) => {
      try {
        const item = await keva.uploadFile(file, {
          properties: {},
          source: "upload",
        });
        // Prepend into the (unfiltered) list and drop the optimistic row in the
        // same tick so the row swaps in place — no refetch, no flicker. With a
        // search active we can't know if the item matches, so refetch instead.
        if (activeSearch.trim() || activeWhere.length > 0) {
          void queryClient.invalidateQueries({ queryKey: ["items"] });
        } else {
          queryClient.setQueryData<ItemsCache>(itemsQueryKey(activeSearch, activeWhere), (old) =>
            old ? prependItemToPages(old, item) : old,
          );
        }
        setUploads((prev) => prev.filter((r) => r.id !== id));
      } catch (err) {
        const error = errorMessage(err);
        setUploads((prev) =>
          prev.map((r) => (r.id === id ? { ...r, upload: { status: "error", file, error } } : r)),
        );
      }
    },
    [activeSearch, activeWhere, queryClient],
  );

  const startUploads = useCallback(
    (files: File[]) => {
      const entries = files.map((file) => ({
        id: `upload:${crypto.randomUUID()}`,
        file,
      }));
      setUploads((prev) => [...entries.map((e) => optimisticRow(e.id, e.file)), ...prev]);
      for (const { id, file } of entries) void uploadOne(id, file);
    },
    [uploadOne],
  );

  const retryUpload = useCallback(
    (id: string, file: File) => {
      setUploads((prev) =>
        prev.map((r) => (r.id === id ? { ...r, upload: { status: "uploading", file } } : r)),
      );
      void uploadOne(id, file);
    },
    [uploadOne],
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, columnVisibility, rowSelection },
    getRowId: (row) => row.id,
    // In-flight / failed uploads aren't real items yet, so they can't be
    // selected or bulk-deleted.
    enableRowSelection: (row) => !row.original.upload,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    meta: { selectMode, onRetryUpload: retryUpload },
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
  // The delete itself (and its list-cache removal) happens in FileDetail; here
  // we just close the panel.
  const onDeleted = () => navigate("/");

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => keva.deleteMany(ids),
    onSuccess: (result, ids) => {
      if (result.deleted.length > 0) {
        toast.success(`Deleted ${result.deleted.length} ${plural(result.deleted.length)}`);
      }
      if (result.failed.length > 0) {
        toast.error(`Failed to delete ${result.failed.length} ${plural(result.failed.length)}`);
      }
      // Remove only the ids that actually deleted, from every cached list, with
      // no refetch (keeps loaded pages and scroll).
      queryClient.setQueriesData<ItemsCache>({ queryKey: ["items"] }, (old) =>
        old ? removeItemsFromPages(old, result.deleted) : old,
      );
      setRowSelection({});
      // The open detail may have been one of the deleted rows.
      if (selectedId && ids.includes(selectedId)) navigate("/");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onBulkDelete = () => {
    const ids = table.getSelectedRowModel().rows.map((r) => r.original.id);
    if (ids.length > 0) bulkDeleteMutation.mutate(ids);
  };

  // Update the controlled value instantly; commit the active search — which
  // swaps the query key and auto-refetches — after a short pause. No submit.
  const onSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      setActiveSearch(value.trim());
      setRowSelection({});
    }, 300);
  };

  // Advanced conditions + quick facets commit here; swapping activeWhere swaps
  // the query key so the list refetches.
  const applyFilters = (where: QueryCondition[]) => {
    setActiveWhere(where);
    setRowSelection({});
  };

  // One-click back to the full list: drop the search text, conditions, facets,
  // and any pending search debounce.
  const clearFilters = () => {
    window.clearTimeout(searchTimer.current);
    setSearch("");
    setActiveSearch("");
    setActiveWhere([]);
    setFilterDraft(createFilterDraft());
    setRowSelection({});
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
                  : flexRender(header.column.columnDef.header, header.getContext())}
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
                  <TableCell key={col.id} className={col.id === "select" ? "w-10" : undefined}>
                    {col.id !== "select" && <Skeleton className="h-5 w-full" />}
                  </TableCell>
                ))}
              </TableRow>
            ))
          : rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={
                  row.getIsSelected() || row.original.id === selectedId ? "selected" : undefined
                }
                className={cn("group", !row.original.upload && "cursor-pointer")}
                onClick={() => {
                  // Uploading / failed rows aren't real items — nothing to open.
                  if (row.original.upload) return;
                  navigate(row.original.id === selectedId ? "/" : `/items/${row.original.id}`);
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cell.column.id === "select" ? "w-10" : undefined}
                    // The checkbox cell toggles selection; don't also open detail.
                    onClick={cell.column.id === "select" ? (e) => e.stopPropagation() : undefined}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
      </TableBody>
    </Table>
  );

  const loadMore = itemsQuery.hasNextPage && (
    <div className="mt-4 flex justify-center">
      <Button
        variant="outline"
        disabled={itemsQuery.isFetchingNextPage}
        onClick={() => void itemsQuery.fetchNextPage()}
      >
        {itemsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
      </Button>
    </div>
  );

  const hasItems = tableData.length > 0;

  // Left pane: its own toolbar (filter + upload) above the scrollable table.
  // Used full-width when no detail is open, and as the left side of the split.
  const leftPane = (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 p-3">
        {selectMode ? (
          <>
            <span className="text-sm font-medium">{selectedCount} selected</span>
            <Button variant="ghost" onClick={() => setRowSelection({})}>
              Clear
            </Button>
            <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="destructive"
                    className="ml-auto"
                    disabled={bulkDeleteMutation.isPending}
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
                    This permanently removes the selected {plural(selectedCount)} and their
                    properties. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      setBulkConfirmOpen(false);
                      onBulkDelete();
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
            <div className="relative w-full min-w-0 sm:w-72">
              <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name or type…"
                className="pl-8"
                value={search}
                onChange={onSearchChange}
              />
            </div>
            <Button variant="outline" onClick={() => setShowFilters((v) => !v)}>
              <IconFilter data-icon="inline-start" />
              Filters
              {activeWhere.length > 0 && <Badge className="ml-1">{activeWhere.length}</Badge>}
            </Button>
            {filtered && (
              <Button variant="ghost" onClick={clearFilters}>
                <IconX data-icon="inline-start" />
                Clear
              </Button>
            )}
            <Button className="sm:ml-auto" onClick={() => openUpload([])}>
              <IconUpload data-icon="inline-start" />
              Upload
            </Button>
          </>
        )}
      </div>
      <FilterPanel
        open={showFilters}
        search={activeSearch}
        draft={filterDraft}
        onDraftChange={setFilterDraft}
        onApply={applyFilters}
        onClear={clearFilters}
        onClose={() => setShowFilters(false)}
      />
      <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto">
        {!loading && rows.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconSearch />
              </EmptyMedia>
              <EmptyTitle>No matches</EmptyTitle>
              <EmptyDescription>No items match your search and filters.</EmptyDescription>
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

      {!loading && !hasItems && !filtered ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconFiles />
              </EmptyMedia>
              <EmptyTitle>No items yet</EmptyTitle>
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
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 w-full min-w-0 flex-1">
          <ResizablePanel defaultSize={58} minSize={35} className="min-w-0">
            {leftPane}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={42} minSize={28} className="min-w-0">
            <FileDetail
              key={selectedId}
              itemId={selectedId!}
              onClose={closeDetail}
              onDeleted={onDeleted}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-hidden">{leftPane}</div>
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
              itemId={selectedId}
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
        onUpload={startUploads}
      />
    </div>
  );
}

function SortButton({ column, label }: { column: Column<FileRow, unknown>; label: string }) {
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
