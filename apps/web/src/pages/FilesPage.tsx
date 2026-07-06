import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowData,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconCloudUpload,
  IconDeviceFloppy,
  IconFiles,
  IconFilter,
  IconLoader2,
  IconSearch,
  IconShare3,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import type { QueryCondition, UpdateView } from "@keva/schema";
import type { KevaItem } from "@keva/sdk";
import { FileDetail } from "../components/FileDetail";
import { FileTypeIcon } from "../components/FileTypeIcon";
import { FilterPanel } from "../components/FilterPanel";
import { ShareCreateDialog } from "../components/ShareCreateDialog";
import { errorMessage } from "../lib/errors";
import { formatPropertyValue, formatBytes, formatContentType, formatRelative } from "../lib/format";
import { createFilterDraft, draftFromConditions } from "../lib/item-filters";
import {
  itemsQueryKey,
  prependItemToPages,
  removeItemsFromPages,
  type ItemsCache,
} from "../lib/items-cache";
import { keva } from "../lib/keva";
import { sharesQueryKey } from "../lib/shares";
import { usageQueryKey } from "../lib/use-usage";
import {
  createView,
  deleteView,
  getView,
  updateView,
  viewQueryKey,
  viewsQueryKey,
} from "../lib/views";
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
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
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
const DEFAULT_ORDER = "created_at_desc" as const;

const plural = (n: number) => (n === 1 ? "item" : "items");

type FileRow = KevaItem & {
  upload?: { status: "uploading" | "error"; file: File; error?: string };
};

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
    header: "Name",
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
    header: "Size",
    cell: (ctx) => (
      <span className="text-muted-foreground tabular-nums">
        {formatBytes(ctx.row.original.size)}
      </span>
    ),
  }),
  columnHelper.accessor((o) => new Date(o.createdAt).getTime(), {
    id: "createdAt",
    header: () => <SortButton label="Created" />,
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
  const { id: selectedId, viewId } = useParams<{ id: string; viewId: string }>();
  const queryClient = useQueryClient();
  const isWide = useMediaQuery("(min-width: 1024px)");

  // View mode: the open view supplies the filter. Its conditions are read live,
  // so editing the view (below) updates the list and any share link built on it.
  const viewQuery = useQuery({
    queryKey: viewId ? viewQueryKey(viewId) : ["views", "none"],
    queryFn: () => getView(viewId!),
    enabled: Boolean(viewId),
  });
  const view = viewQuery.data;

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
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // Optimistic upload rows (uploading / failed-with-retry). Kept separate from
  // the React Query list cache: failed uploads must persist with a retry
  // affordance rather than roll back, and survive list refetches.
  const [uploads, setUploads] = useState<FileRow[]>([]);

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareKey, setShareKey] = useState(0);
  const openShare = () => {
    setShareKey((k) => k + 1);
    setShareOpen(true);
  };

  const [pageDragging, setPageDragging] = useState(false);
  const dragDepth = useRef(0);

  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const [deleteViewOpen, setDeleteViewOpen] = useState(false);

  // Seed the filter from the active view whenever the view (or its saved
  // conditions) changes, or reset to empty on the root list — adjusting state
  // during render rather than via an effect (repo rule: no direct useEffect).
  const seedKey = viewId ? `${viewId}:${view?.updatedAt ?? "loading"}` : "root";
  const [seededKey, setSeededKey] = useState(seedKey);
  if (seedKey !== seededKey) {
    setSeededKey(seedKey);
    setRowSelection({});
    if (viewId) {
      if (view) {
        setActiveWhere([...view.conditions]);
        setFilterDraft(draftFromConditions(view.conditions));
      }
    } else {
      setActiveWhere([]);
      setFilterDraft(createFilterDraft());
      setSearch("");
      setActiveSearch("");
    }
  }

  // Navigation stays within the active view so selecting/closing an item keeps
  // you on /v/:viewId rather than dropping back to the root list.
  const listPath = viewId ? `/v/${viewId}` : "/";
  const itemPath = (itemId: string) =>
    viewId ? `/v/${viewId}/items/${itemId}` : `/items/${itemId}`;

  const updateViewMutation = useMutation({
    mutationFn: (input: UpdateView) => updateView(viewId!, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(viewQueryKey(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: viewsQueryKey });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const createViewMutation = useMutation({
    mutationFn: (name: string) => createView({ name, conditions: activeWhere }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: viewsQueryKey });
      setSaveViewOpen(false);
      setSaveViewName("");
      navigate(`/v/${created.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteViewMutation = useMutation({
    mutationFn: () => deleteView(viewId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: viewsQueryKey });
      // Grants on this view were cascade-deleted server-side; refresh the roster.
      void queryClient.invalidateQueries({ queryKey: sharesQueryKey });
      setDeleteViewOpen(false);
      toast.success("View deleted");
      navigate("/");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const itemsQuery = useInfiniteQuery({
    queryKey: itemsQueryKey(activeSearch, activeWhere, DEFAULT_ORDER),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      keva.query({
        where: activeWhere,
        ...(activeSearch.trim() ? { search: activeSearch.trim() } : {}),
        order: DEFAULT_ORDER,
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
  const tableData = useMemo<FileRow[]>(() => [...uploads, ...serverItems], [uploads, serverItems]);

  const splitOpen = Boolean(selectedId) && isWide;
  const columnVisibility: VisibilityState = {
    contentType: !splitOpen,
    createdAt: !splitOpen,
    properties: !splitOpen,
  };

  const selectMode = Object.values(rowSelection).some(Boolean);
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
          queryClient.setQueryData<ItemsCache>(
            itemsQueryKey(activeSearch, activeWhere, DEFAULT_ORDER),
            (old) => (old ? prependItemToPages(old, item) : old),
          );
        }
        void queryClient.invalidateQueries({ queryKey: usageQueryKey });
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
    state: { columnVisibility, rowSelection },
    getRowId: (row) => row.id,
    enableRowSelection: (row) => !row.original.upload,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    meta: { selectMode, onRetryUpload: retryUpload },
  });

  const rows = table.getRowModel().rows;
  const selectedRows = table.getSelectedRowModel().rows;
  const selectedCount = selectedRows.length;

  const onPageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setPageDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length > 0) startUploads(dropped);
  };

  const closeDetail = () => navigate(listPath);
  const onDeleted = () => navigate(listPath);

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
      if (result.deleted.length > 0) {
        void queryClient.invalidateQueries({ queryKey: usageQueryKey });
      }
      setRowSelection({});
      if (selectedId && ids.includes(selectedId)) navigate(listPath);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onBulkDelete = () => {
    const ids = table.getSelectedRowModel().rows.map((r) => r.original.id);
    if (ids.length > 0) bulkDeleteMutation.mutate(ids);
  };

  const onSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      setActiveSearch(value.trim());
      setRowSelection({});
    }, 300);
  };

  const applyFilters = (where: QueryCondition[]) => {
    setActiveWhere(where);
    setRowSelection({});
    // On a saved view, applying edits the view in place (live) so any share link
    // built on it reflects the change.
    if (viewId) updateViewMutation.mutate({ conditions: where });
  };

  const clearFilters = () => {
    window.clearTimeout(searchTimer.current);
    setSearch("");
    setActiveSearch("");
    setRowSelection({});
    // On a view, "Clear" only drops the free-text search — the saved view filter
    // stays intact (delete the view to remove it). On the root list it resets all.
    if (!viewId) {
      setActiveWhere([]);
      setFilterDraft(createFilterDraft());
    }
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
                  if (row.original.upload) return;
                  navigate(row.original.id === selectedId ? listPath : itemPath(row.original.id));
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cell.column.id === "select" ? "w-10" : undefined}
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
            {viewId && view && (
              <span className="mr-1 truncate text-sm font-medium" title={view.name}>
                {view.name}
              </span>
            )}
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
            <div className="flex items-center gap-3 sm:ml-auto">
              {viewId ? (
                <>
                  <Button variant="outline" onClick={openShare}>
                    <IconShare3 data-icon="inline-start" />
                    Share
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteViewOpen(true)}
                  >
                    <IconTrash data-icon="inline-start" />
                    Delete view
                  </Button>
                </>
              ) : (
                activeWhere.length > 0 && (
                  <Button variant="outline" onClick={() => setSaveViewOpen(true)}>
                    <IconDeviceFloppy data-icon="inline-start" />
                    Save as view
                  </Button>
                )
              )}
              <Button onClick={() => uploadInputRef.current?.click()}>
                <IconUpload data-icon="inline-start" />
                Upload
              </Button>
            </div>
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
            <Button onClick={() => uploadInputRef.current?.click()}>
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

      <input
        ref={uploadInputRef}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) startUploads(files);
          // Reset so selecting the same file again still fires onChange.
          e.target.value = "";
        }}
      />

      <ShareCreateDialog
        key={shareKey}
        open={shareOpen}
        onOpenChange={setShareOpen}
        viewId={viewId ?? ""}
        conditions={activeWhere}
      />

      <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as view</DialogTitle>
            <DialogDescription>
              Save the current filters as a named view. It appears in the sidebar and can be shared.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="save-view-name">Name</FieldLabel>
            <Input
              id="save-view-name"
              value={saveViewName}
              onChange={(e) => setSaveViewName(e.target.value)}
              placeholder="Diving trip"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && saveViewName.trim()) {
                  createViewMutation.mutate(saveViewName.trim());
                }
              }}
            />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button
              onClick={() => createViewMutation.mutate(saveViewName.trim())}
              disabled={!saveViewName.trim() || createViewMutation.isPending}
            >
              {createViewMutation.isPending ? "Saving…" : "Save view"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteViewOpen} onOpenChange={setDeleteViewOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this view?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the view “{view?.name}” and revokes any share links built on it. Your
              files are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => deleteViewMutation.mutate()}>
              Delete view
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SortButton({ label }: { label: string }) {
  return (
    <span className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-foreground">
      {label}
      <IconArrowDown className="size-3.5" />
    </span>
  );
}
