import {
  ArrowDown,
  ArrowUpDown,
  CloudUpload,
  EllipsisVertical,
  Files,
  LoaderCircle,
  Pencil,
  Save,
  Search,
  Share2,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowData,
  type RowSelectionState,
  type VisibilityState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import type { PropertyValue, QueryCondition, QueryOrder, UpdateView } from "@keva/schema";
import { ApiSnippetsPopover } from "../components/ApiSnippetsPopover";
import { FileDetail } from "../components/FileDetail";
import { FileBrowserFrame } from "../components/file-browser/FileBrowserFrame";
import { NumberedPagination } from "../components/file-browser/NumberedPagination";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FilterBar, FilterMenuButton } from "../components/FilterBar";
import { ShareCreateDialog } from "../components/ShareCreateDialog";
import { DEFAULT_VIEW_ICON_KEY, ViewIconPicker, viewIcon } from "../components/view-icons";
import { useAppHeaderSlot } from "../lib/app-header-slot";
import { errorMessage } from "../lib/errors";
import {
  DEFAULT_FILE_ORDER,
  fileOrderFromParam,
  fileSortColumn,
  fileSortDirection,
  nextFileOrder,
  type FileSortColumn,
} from "../lib/file-order";
import { formatPropertyValue, formatBytes, formatRelative } from "../lib/format";
import {
  buildFilterWhere,
  decodeFilterParam,
  draftFromConditions,
  type KindId,
} from "../lib/item-filters";
import { removeDeletedItemsFromCache, itemsQueryKey } from "../lib/items-cache";
import { keva } from "../lib/keva";
import { listShares, sharesQueryKey } from "../lib/shares";
import { uploadStampFrom } from "../lib/upload-stamp";
import { useFileFilters } from "../lib/use-file-filters";
import { type UploadQueueRow, useUploadQueue } from "../lib/use-upload-queue";
import {
  createView,
  deleteView,
  getView,
  updateView,
  viewQueryKey,
  viewsQueryKey,
} from "../lib/views";
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
import { ButtonGroup } from "@/components/ui/button-group";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
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

declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    selectMode: boolean;
    onRetryUpload: (row: FileRow) => void;
    onFilterByProperty: (key: string, value: PropertyValue) => void;
    onOpenItem: (itemId: string) => void;
    order: QueryOrder;
    onSort: (column: FileSortColumn) => void;
  }
}

const propertyChipLabel = (key: string, value: PropertyValue): string => {
  if (value === null) return key;
  return `${key}:${formatPropertyValue(value)}`;
};

const uploadStampDescription = (
  entries: readonly (readonly [string, PropertyValue])[],
  subject = "New uploads will",
): string => {
  const tags = entries.filter(([, value]) => value === null).map(([key]) => key);
  const values = entries
    .filter((entry): entry is readonly [string, Exclude<PropertyValue, null>] => entry[1] !== null)
    .map(([key, value]) => `${key}: ${formatPropertyValue(value)}`);
  if (tags.length > 0 && values.length > 0)
    return `${subject} be tagged ${tags.join(", ")} and receive ${values.join(", ")}`;
  if (tags.length > 0) return `${subject} be tagged ${tags.join(", ")}`;
  return `${subject} receive ${values.join(", ")}`;
};

const PAGE_SIZE = 50;
const QUICK_KINDS: ReadonlyArray<{ id: KindId | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "document", label: "Document" },
  { id: "image", label: "Photo" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
];
const plural = (n: number) => (n === 1 ? "item" : "items");

const canonCondition = (c: QueryCondition) => JSON.stringify([c.key, c.op, c.value ?? null]);
const sameConditions = (a: readonly QueryCondition[], b: readonly QueryCondition[]): boolean =>
  a.length === b.length &&
  a.map(canonCondition).sort().join("|") === b.map(canonCondition).sort().join("|");

type FileRow = UploadQueueRow;

const EMPTY_FILE_ROWS: FileRow[] = [];

const columnHelper = createColumnHelper<FileRow>();

const selectModeOf = (meta: unknown) =>
  Boolean((meta as { selectMode?: boolean } | undefined)?.selectMode);

const responsiveColumnClass = (columnId: string) => {
  if (columnId === "updatedAt") return "hidden sm:table-cell";
  if (columnId === "properties") return "hidden lg:table-cell";
  return undefined;
};

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
          <LoaderCircle
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
            onClick={() => table.options.meta?.onRetryUpload(row.original)}
            className="flex size-5 items-center justify-center rounded text-destructive hover:bg-destructive/10"
          >
            <TriangleAlert className="size-4" />
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
    cell: ({ getValue, row, table }) => (
      <button
        type="button"
        className="block max-w-full truncate text-left text-muted-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => {
          event.stopPropagation();
          table.options.meta?.onOpenItem(row.original.id);
        }}
      >
        {getValue()}
      </button>
    ),
  }),
  columnHelper.accessor((o) => o.size ?? 0, {
    id: "size",
    header: ({ table }) => (
      <SortButton
        label="Size"
        column="size"
        order={table.options.meta!.order}
        onSort={table.options.meta!.onSort}
      />
    ),
    cell: (ctx) => (
      <span className="text-muted-foreground tabular-nums">
        {formatBytes(ctx.row.original.size)}
      </span>
    ),
  }),
  columnHelper.accessor((o) => new Date(o.updatedAt).getTime(), {
    id: "updatedAt",
    header: "Updated",
    cell: (ctx) => (
      <span className="text-muted-foreground">{formatRelative(ctx.row.original.updatedAt)}</span>
    ),
  }),
  columnHelper.display({
    id: "properties",
    header: "Properties",
    cell: (ctx) => {
      const { properties } = ctx.row.original;
      const keys = Object.keys(properties).slice(0, 3);
      if (keys.length === 0) return null;
      const onFilter = ctx.table.options.meta?.onFilterByProperty;
      return (
        <div className="flex flex-wrap gap-1">
          {keys.map((key) => {
            const value = properties[key]!;
            return (
              <Badge
                key={key}
                variant="secondary"
                render={<button type="button" />}
                title={`Filter by ${propertyChipLabel(key, value)}`}
                className="cursor-pointer hover:bg-primary hover:text-primary-foreground dark:hover:bg-primary! dark:hover:text-primary-foreground!"
                onClick={(e) => {
                  e.stopPropagation();
                  onFilter?.(key, value);
                }}
              >
                {propertyChipLabel(key, value)}
              </Badge>
            );
          })}
        </div>
      );
    },
  }),
];

export function FilesPage() {
  const { viewId } = useParams<{ viewId: string }>();
  const [searchParams] = useSearchParams();
  const initialWhere = viewId ? [] : decodeFilterParam(searchParams.get("filter"));
  // Keyed by view identity only. A root-mode filter change updates the URL in
  // place; the session must not remount (that would discard the filter draft,
  // selection, and in-flight uploads).
  const routeKey = viewId ? `view:${viewId}` : "root";
  return <FilesPageSession key={routeKey} viewId={viewId} initialWhere={initialWhere} />;
}

function FilesPageSession({
  viewId,
  initialWhere,
}: {
  readonly viewId?: string | undefined;
  readonly initialWhere: readonly QueryCondition[];
}) {
  const viewQuery = useQuery({
    queryKey: viewId ? viewQueryKey(viewId) : ["views", "none"],
    queryFn: () => getView(viewId!),
    enabled: Boolean(viewId),
  });

  if (viewId && viewQuery.isPending) {
    return <div className="flex min-h-0 flex-1" aria-busy="true" />;
  }

  return (
    <FilesPageContent
      initialWhere={viewQuery.data?.conditions ?? initialWhere}
      view={viewQuery.data}
    />
  );
}

function FilesPageContent({
  initialWhere,
  view,
}: {
  readonly initialWhere: readonly QueryCondition[];
  readonly view: Awaited<ReturnType<typeof getView>> | undefined;
}) {
  const navigate = useNavigate();
  const { id: selectedId, viewId } = useParams<{ id: string; viewId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const headerSlot = useAppHeaderSlot();

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pagination, setPagination] = useState({ identity: "", pageIndex: 0 });
  const resetQueryState = useCallback(() => {
    setRowSelection({});
    setPagination({ identity: "", pageIndex: 0 });
  }, []);
  const {
    activeSearch,
    activeWhere,
    setActiveWhere,
    filterDraft,
    setFilterDraft,
    applyWhere,
    filterByProperty,
    clearFilters,
  } = useFileFilters({ viewId, initialWhere, onQueryChange: resetQueryState });
  const order = fileOrderFromParam(searchParams.get("sort"));
  const queryIdentity = JSON.stringify([activeSearch, activeWhere, order]);
  const pageIndex = pagination.identity === queryIdentity ? pagination.pageIndex : 0;
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

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
  const [saveViewIcon, setSaveViewIcon] = useState<string | null>(null);
  const [deleteViewOpen, setDeleteViewOpen] = useState(false);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const viewEdited = Boolean(viewId && view && !sameConditions(activeWhere, view.conditions));

  const sharesQuery = useQuery({
    queryKey: sharesQueryKey,
    queryFn: listShares,
    enabled: Boolean(viewId),
  });
  const viewShares = useMemo(
    () => (viewId ? (sharesQuery.data ?? []).filter((s) => s.viewId === viewId) : []),
    [sharesQuery.data, viewId],
  );

  const withSearchParams = (path: string, includePanel: boolean) => {
    const params = new URLSearchParams(searchParams);
    if (!includePanel) params.delete("panel");
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  };
  const listPath = withSearchParams(viewId ? `/v/${viewId}` : "/", false);
  const itemPath = (itemId: string) =>
    withSearchParams(viewId ? `/v/${viewId}/items/${itemId}` : `/items/${itemId}`, true);

  const updateViewMutation = useMutation({
    mutationFn: (input: UpdateView) => updateView(viewId!, input),
    onSuccess: (updated) => {
      queryClient.setQueryData(viewQueryKey(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: viewsQueryKey });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const createViewMutation = useMutation({
    mutationFn: (name: string) =>
      createView({ name, conditions: activeWhere, icon: saveViewIcon ?? undefined }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: viewsQueryKey });
      setSaveViewOpen(false);
      setSaveViewName("");
      setSaveViewIcon(null);
      navigate(`/v/${created.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteViewMutation = useMutation({
    mutationFn: () => deleteView(viewId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: viewsQueryKey });
      void queryClient.invalidateQueries({ queryKey: sharesQueryKey });
      setDeleteViewOpen(false);
      toast.success("View deleted");
      navigate("/");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const itemsQuery = useQuery({
    queryKey: itemsQueryKey(activeSearch, activeWhere, order, pageIndex * PAGE_SIZE),
    queryFn: () =>
      keva.query({
        where: activeWhere,
        ...(activeSearch.trim() ? { search: activeSearch.trim() } : {}),
        order,
        limit: PAGE_SIZE,
        offset: pageIndex * PAGE_SIZE,
      }),
    placeholderData: (previous) => previous,
  });

  const loading = itemsQuery.isLoading;
  const error = itemsQuery.error ? errorMessage(itemsQuery.error) : null;
  const serverItems = itemsQuery.data?.items ?? EMPTY_FILE_ROWS;
  const totalItems = itemsQuery.data?.totalCount ?? serverItems.length;

  const columnVisibility: VisibilityState = {
    updatedAt: !selectedId,
    properties: !selectedId,
  };

  const selectMode = Object.values(rowSelection).some(Boolean);
  const filtered = activeSearch.trim().length > 0 || activeWhere.length > 0;
  const draftActive =
    filterDraft.kinds.length > 0 || filterDraft.size !== "any" || filterDraft.rows.length > 0;
  const showFilterRow = Boolean(viewId) || filtered || draftActive;

  const uploadStamp = useMemo(() => uploadStampFrom(activeWhere), [activeWhere]);
  const uploadStampEntries = Object.entries(uploadStamp);
  const { uploads, startUploads, retryUpload } = useUploadQueue({
    queryClient,
    activeSearch,
    activeWhere,
    order,
    uploadStamp,
  });
  const tableData = useMemo<FileRow[]>(
    () => [...(pageIndex === 0 ? uploads : []), ...serverItems],
    [pageIndex, serverItems, uploads],
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: { columnVisibility, rowSelection },
    getRowId: (row) => row.id,
    enableRowSelection: (row) => !row.original.upload,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      selectMode,
      onRetryUpload: retryUpload,
      onFilterByProperty: filterByProperty,
      onOpenItem: (itemId) => navigate(itemId === selectedId ? listPath : itemPath(itemId)),
      order,
      onSort: (column) => {
        const nextOrder = nextFileOrder(order, column);
        resetQueryState();
        setSearchParams(
          (previous) => {
            const params = new URLSearchParams(previous);
            if (nextOrder === DEFAULT_FILE_ORDER) params.delete("sort");
            else params.set("sort", nextOrder);
            return params;
          },
          { replace: true },
        );
      },
    },
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
  const navigateAfterDeletion = (deletedIds: Iterable<string>) => {
    const deleted = new Set(deletedIds);
    const selectedIndex = rows.findIndex((row) => row.original.id === selectedId);
    const nextRow =
      rows.slice(selectedIndex + 1).find((row) => !row.original.upload && !deleted.has(row.id)) ??
      rows
        .slice(0, Math.max(0, selectedIndex))
        .reverse()
        .find((row) => !row.original.upload && !deleted.has(row.id));

    navigate(nextRow ? itemPath(nextRow.original.id) : listPath, { replace: true });
  };
  const onDeleted = () => navigateAfterDeletion(selectedId ? [selectedId] : []);

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => keva.deleteMany(ids),
    onSuccess: (result) => {
      if (result.deleted.length > 0) {
        toast.success(`Deleted ${result.deleted.length} ${plural(result.deleted.length)}`);
      }
      if (result.failed.length > 0) {
        toast.error(`Failed to delete ${result.failed.length} ${plural(result.failed.length)}`);
      }
      setRowSelection({});
      removeDeletedItemsFromCache(queryClient, result.deleted);
      if (selectedId && result.deleted.includes(selectedId)) {
        navigateAfterDeletion(result.deleted);
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onBulkDelete = () => {
    const ids = table.getSelectedRowModel().rows.map((r) => r.original.id);
    if (ids.length > 0) bulkDeleteMutation.mutate(ids);
  };

  const saveViewEdits = () => {
    updateViewMutation.mutate(
      { conditions: activeWhere },
      { onSuccess: () => toast.success("View updated") },
    );
  };

  const discardViewEdits = () => {
    if (!view) return;
    resetQueryState();
    setActiveWhere([...view.conditions]);
    setFilterDraft(draftFromConditions(view.conditions));
  };

  const startNameEdit = () => {
    if (!view) return;
    setNameDraft(view.name);
    setNameEditing(true);
  };

  const commitName = () => {
    const next = nameDraft.trim();
    setNameEditing(false);
    if (!next || next === view?.name) return;
    updateViewMutation.mutate({ name: next });
  };

  const changeIcon = (key: string) => {
    if (key === (view?.icon ?? DEFAULT_VIEW_ICON_KEY)) return;
    updateViewMutation.mutate({ icon: key });
  };

  const goToPage = (nextPage: number) => {
    setRowSelection({});
    setPagination({ identity: queryIdentity, pageIndex: nextPage - 1 });
  };

  const tableInner = (
    <Table
      containerClassName="overflow-visible"
      className="[&_td]:px-3 [&_td]:py-3.5 [&_th]:px-3 [&_tr]:border-0"
    >
      <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-background [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="group">
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                className={cn(
                  header.column.id === "select" && "w-10",
                  responsiveColumnClass(header.column.id),
                )}
                aria-sort={
                  fileSortColumn(order) === header.column.id ? fileSortDirection(order) : undefined
                }
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
                  <TableCell
                    key={col.id}
                    className={cn(col.id === "select" && "w-10", responsiveColumnClass(col.id))}
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
                    className={cn(
                      cell.column.id === "select" && "w-10",
                      responsiveColumnClass(cell.column.id),
                    )}
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

  const pageControls = (
    <NumberedPagination
      page={pageIndex + 1}
      totalItems={totalItems}
      pageSize={PAGE_SIZE}
      disabled={itemsQuery.isFetching}
      onPageChange={goToPage}
    />
  );

  const hasItems = uploads.length > 0 || totalItems > 0;
  const emptyPage = pageIndex > 0;

  const browserControls = (
    <div className="flex w-full min-w-0 shrink-0 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-3 px-1">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Files className="size-5 shrink-0 text-muted-foreground" />
            <h1 className="truncate font-heading text-xl font-semibold">{view?.name ?? "All"}</h1>
          </div>
          {!selectMode && (
            <div className="flex items-center gap-2">
              <FilterMenuButton
                draft={filterDraft}
                onDraftChange={setFilterDraft}
                onApply={applyWhere}
              />
              <Button onClick={() => uploadInputRef.current?.click()}>
                <Upload data-icon="inline-start" />
                Upload
              </Button>
            </div>
          )}
        </div>
        {!selectMode && (
          <div
            className="flex w-fit max-w-full flex-wrap items-center rounded-lg border border-border bg-muted/70 p-1"
            aria-label="File type"
          >
            {QUICK_KINDS.map((kind) => {
              const active =
                kind.id === "all"
                  ? filterDraft.kinds.length === 0
                  : filterDraft.kinds[0] === kind.id && filterDraft.kinds.length === 1;
              return (
                <Button
                  key={kind.id}
                  variant="ghost"
                  size="sm"
                  aria-pressed={active}
                  className={cn(
                    "rounded-md px-4 text-muted-foreground shadow-none hover:text-foreground",
                    active &&
                      "bg-background text-foreground hover:bg-background hover:text-foreground",
                  )}
                  onClick={() => {
                    const nextDraft = {
                      ...filterDraft,
                      kinds: kind.id === "all" ? [] : [kind.id],
                    };
                    setFilterDraft(nextDraft);
                    applyWhere(buildFilterWhere(nextDraft));
                  }}
                >
                  {kind.label}
                </Button>
              );
            })}
          </div>
        )}
      </div>
      {selectMode && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 px-1">
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
              <Trash2 data-icon="inline-start" />
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
        </div>
      )}
      {!selectMode && showFilterRow && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-1">
          <FilterBar
            draft={filterDraft}
            onDraftChange={setFilterDraft}
            onApply={applyWhere}
            onClear={clearFilters}
          />
          <div className="ml-auto flex items-center gap-1.5">
            {filtered && <ApiSnippetsPopover search={activeSearch} where={activeWhere} />}
            {viewId ? (
              viewEdited && (
                <>
                  <Badge variant="secondary">Edited</Badge>
                  <Button variant="ghost" size="sm" onClick={discardViewEdits}>
                    Discard
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={saveViewEdits}
                    disabled={updateViewMutation.isPending}
                  >
                    <Save data-icon="inline-start" />
                    Save
                  </Button>
                </>
              )
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setSaveViewOpen(true)}>
                <Save data-icon="inline-start" />
                Save as view
              </Button>
            )}
            <ButtonGroup>
              <Button
                variant="outline"
                size="sm"
                onClick={() => (viewId ? navigate(`/v/${viewId}/shares`) : openShare())}
              >
                <Share2 data-icon="inline-start" />
                Share
              </Button>
              {viewShares.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link to={`/v/${viewId}/shares`} />}
                  aria-label={`View ${viewShares.length} share ${viewShares.length === 1 ? "link" : "links"} for this view`}
                  title="Share links for this view"
                >
                  <span className="tabular-nums">{viewShares.length}</span>
                </Button>
              )}
            </ButtonGroup>
          </div>
        </div>
      )}
      {!selectMode && uploadStampEntries.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-1">
          <span className="text-xs text-muted-foreground">
            {uploadStampDescription(uploadStampEntries)}
          </span>
        </div>
      )}
    </div>
  );

  const tablePane = (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border">
      <ScrollArea className="h-auto min-h-0 flex-1">
        {!loading && rows.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {!filtered && !hasItems ? <Files /> : <Search />}
              </EmptyMedia>
              <EmptyTitle>
                {emptyPage
                  ? "No items on this page"
                  : !filtered && !hasItems
                    ? "No items yet"
                    : "No matches"}
              </EmptyTitle>
              <EmptyDescription>
                {emptyPage
                  ? "Items on this page may have been deleted. Use the pagination controls to continue browsing."
                  : !filtered && !hasItems
                    ? "Upload your first file, or drop one anywhere on this page."
                    : "No items match your search and filters."}
              </EmptyDescription>
            </EmptyHeader>
            {!filtered && !hasItems && (
              <Button onClick={() => uploadInputRef.current?.click()}>
                <Upload data-icon="inline-start" />
                Upload
              </Button>
            )}
          </Empty>
        ) : (
          tableInner
        )}
      </ScrollArea>
      <div className="flex shrink-0 items-center border-t">
        {pageControls}
        <span className="shrink-0 pr-3 text-sm text-muted-foreground tabular-nums">
          {totalItems} {plural(totalItems)}
        </span>
      </div>
    </div>
  );

  const HeaderViewIcon = viewIcon(view?.icon);
  const headerControls = (
    <>
      {viewId && view ? (
        <div className="flex max-w-[24rem] min-w-0 items-center gap-1">
          <ViewIconPicker
            value={view.icon}
            onChange={changeIcon}
            trigger={
              <button
                type="button"
                title="Change icon"
                aria-label="Change view icon"
                className="group/vicon relative flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-muted"
              >
                <HeaderViewIcon className="size-6" />
                <span className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60 opacity-0 backdrop-blur-[1px] transition-opacity group-hover/vicon:opacity-100">
                  <Pencil className="size-3.5" />
                </span>
              </button>
            }
          />
          {nameEditing ? (
            <Input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                else if (e.key === "Escape") setNameEditing(false);
              }}
              className="h-9 w-56 text-[21px] font-medium"
            />
          ) : (
            <div className="group/vname flex min-w-0 items-center gap-1">
              <span className="truncate px-1 text-[21px] leading-none font-medium">
                {view.name}
              </span>
              <button
                type="button"
                title="Rename view"
                aria-label="Rename view"
                onClick={startNameEdit}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/vname:opacity-100 focus-visible:opacity-100"
              >
                <Pencil className="size-4" />
              </button>
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" aria-label="View options" />}
            >
              <EllipsisVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={startNameEdit}>
                <Pencil />
                Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteViewOpen(true)}>
                <Trash2 />
                Delete view
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : (
        <span className="flex items-center gap-2.5 px-2.5 py-1.5 text-[21px] leading-none font-medium">
          <Files className="size-6 shrink-0" />
          All
        </span>
      )}
    </>
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
      className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 md:p-4"
    >
      {headerSlot && viewId && createPortal(headerControls, headerSlot)}

      {pageDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary px-10 py-8 text-center">
            <CloudUpload className="size-7 text-primary" />
            <p className="font-medium">Drop to upload</p>
            {uploadStampEntries.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {uploadStampDescription(uploadStampEntries, "Files will")}
              </p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="shrink-0 p-4">
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        </div>
      )}

      {browserControls}

      <FileBrowserFrame
        list={tablePane}
        detailOpen={Boolean(selectedId)}
        onDetailOpenChange={(open) => {
          if (!open) closeDetail();
        }}
        detailTitle="File details"
        detail={
          selectedId ? (
            <FileDetail
              key={selectedId}
              itemId={selectedId}
              onClose={closeDetail}
              onDeleted={onDeleted}
            />
          ) : null
        }
      />

      <input
        ref={uploadInputRef}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) startUploads(files);
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
            <div className="flex items-center gap-2">
              <ViewIconPicker value={saveViewIcon} onChange={setSaveViewIcon} />
              <Input
                id="save-view-name"
                className="flex-1"
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
            </div>
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

function SortButton({
  label,
  column,
  order,
  onSort,
}: {
  label: string;
  column: FileSortColumn;
  order: QueryOrder;
  onSort: (column: FileSortColumn) => void;
}) {
  const active = fileSortColumn(order) === column;
  const direction = active ? fileSortDirection(order) : null;
  return (
    <button
      type="button"
      className="-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={
        active
          ? `${label}, sorted ${direction}. Sort ${direction === "ascending" ? "descending" : "ascending"}`
          : `Sort by ${label.toLowerCase()}`
      }
      onClick={() => onSort(column)}
    >
      {label}
      {active ? (
        <ArrowDown
          className={cn("size-3.5 transition-transform", direction === "ascending" && "rotate-180")}
        />
      ) : (
        <ArrowUpDown className="size-3.5 text-muted-foreground/70" />
      )}
    </button>
  );
}
