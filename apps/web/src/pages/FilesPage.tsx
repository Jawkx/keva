import {
  CloudUpload,
  Download,
  EllipsisVertical,
  Eye,
  Files,
  LayoutGrid,
  List,
  Pencil,
  Save,
  Search,
  Share2,
  Tags,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type RowSelectionState,
} from "@tanstack/react-table";
import { toast } from "sonner";
import type { PropertyValue, QueryCondition, UpdateView } from "@keva/schema";
import type { UsageResult } from "@keva/sdk";
import { ApiSnippetsPopover } from "../components/ApiSnippetsPopover";
import { BillingRequiredDialog } from "../components/BillingRequiredDialog";
import { FileDetail } from "../components/FileDetail";
import { FileBrowserFrame } from "../components/file-browser/FileBrowserFrame";
import { FileGrid } from "../components/file-browser/FileGrid";
import {
  FileTable,
  FileTableBody,
  FileTableCell,
  FileTableFooter,
  FileTableFrame,
  FileTableHead,
  FileTableHeader,
  FileTableItemCount,
  FileTableRow,
} from "../components/file-browser/FileTable";
import { NumberedPagination } from "../components/file-browser/NumberedPagination";
import { FilterBar, FilterMenuButton } from "../components/FilterBar";
import { ShareCreateDialog } from "../components/ShareCreateDialog";
import { DEFAULT_VIEW_ICON_KEY, ViewIconPicker, viewIcon } from "../components/view-icons";
import { errorMessage } from "../lib/errors";
import {
  DEFAULT_FILE_ORDER,
  fileOrderFromParam,
  fileSortColumn,
  fileSortDirection,
  nextFileOrder,
} from "../lib/file-order";
import { buildFilterWhere, decodeFilterParam, draftFromConditions } from "../lib/item-filters";
import { inferPropertyValue, validateKey } from "../lib/properties";
import {
  cachePatchedItem,
  invalidatePropertyDiscovery,
  removeDeletedItemsFromCache,
  itemsQueryKey,
  usageQueryKey,
} from "../lib/items-cache";
import { keva } from "../lib/keva";
import { setFileLayout, useFileLayout } from "../lib/file-layout";
import { ACTIVE_METADATA_REFETCH_INTERVAL } from "../lib/query-client";
import { listShares, sharesQueryKey } from "../lib/shares";
import { uploadStampFrom } from "../lib/upload-stamp";
import { useFileFilters } from "../lib/use-file-filters";
import { useMountEffect } from "../lib/useMountEffect";
import { useUploadQueue } from "../lib/use-upload-queue";
import { useUsage } from "../lib/use-usage";
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { columns, responsiveColumnClass, type FileRow } from "./files/file-columns";
import {
  EMPTY_FILE_ROWS,
  PAGE_SIZE,
  QUICK_KINDS,
  UploadPropertyBadges,
  extensionStart,
  plural,
  sameConditions,
} from "./files/utils";

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
  const fileLayout = useFileLayout();

  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const rememberFile = (id: string) => sessionStorage.setItem("keva:focused-file", id);
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
  const [bulkPropertiesOpen, setBulkPropertiesOpen] = useState(false);
  const [bulkPropertyKey, setBulkPropertyKey] = useState("");
  const [bulkPropertyValue, setBulkPropertyValue] = useState("");
  const [bulkShareOpen, setBulkShareOpen] = useState(false);
  const [bulkShareKey, setBulkShareKey] = useState(0);
  const [shareItem, setShareItem] = useState<FileRow | null>(null);
  const [renameItem, setRenameItem] = useState<{ id: string; draft: string } | null>(null);
  const [deleteItem, setDeleteItem] = useState<FileRow | null>(null);

  const renameInputRef = (node: HTMLInputElement | null) => {
    if (node) {
      node.focus();
      node.setSelectionRange(0, extensionStart(node.value));
    }
  };

  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [billingRequiredOpen, setBillingRequiredOpen] = useState(false);
  useUsage();
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
    queryFn: () => {
      const search = activeSearch.trim();
      const query = {
        where: activeWhere,
        order,
        limit: PAGE_SIZE,
        offset: pageIndex * PAGE_SIZE,
      };
      return search ? keva.query({ ...query, search }) : keva.query(query);
    },
    placeholderData: (previous) => previous,
    refetchInterval: ACTIVE_METADATA_REFETCH_INTERVAL,
  });

  const loading = itemsQuery.isLoading;
  const error = itemsQuery.error ? errorMessage(itemsQuery.error) : null;
  const serverItems = itemsQuery.data?.items ?? EMPTY_FILE_ROWS;
  const totalItems = itemsQuery.data?.totalCount ?? serverItems.length;

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
  const requestUpload = (files?: File[]) => {
    const usage = queryClient.getQueryData<UsageResult>(usageQueryKey);
    if (usage?.quotaBytes === 0) {
      setBillingRequiredOpen(true);
      return;
    }
    if (files) startUploads(files);
    else uploadInputRef.current?.click();
  };
  useMountEffect(() => {
    const openUpload = () => requestUpload();
    window.addEventListener("keva:upload", openUpload);
    return () => window.removeEventListener("keva:upload", openUpload);
  });
  const tableData = useMemo<FileRow[]>(
    () => [...(pageIndex === 0 ? uploads : []), ...serverItems],
    [pageIndex, serverItems, uploads],
  );

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      keva.patch(id, { set: { name }, unset: [] }),
    onSuccess: (updated) => cachePatchedItem(queryClient, updated),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const commitRename = async (item: FileRow) => {
    if (renameItem?.id !== item.id) return;
    const next = renameItem.draft.trim();
    if (!next || next === item.name) {
      setRenameItem(null);
      return;
    }
    try {
      await renameMutation.mutateAsync({ id: item.id, name: next });
      setRenameItem(null);
    } catch {}
  };

  const table = useReactTable({
    data: tableData,
    columns,
    state: { rowSelection },
    getRowId: (row) => row.id,
    enableRowSelection: (row) => !row.original.upload,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      onRetryUpload: retryUpload,
      onFilterByProperty: filterByProperty,
      onOpenItem: (itemId) => navigate(itemId === selectedId ? listPath : itemPath(itemId)),
      renamingId: renameItem?.id ?? null,
      renameDraft: renameItem?.draft ?? "",
      renameInputRef,
      onRenameDraftChange: (draft) =>
        setRenameItem((current) => (current ? { ...current, draft } : current)),
      onCommitRename: (item) => void commitRename(item),
      onCancelRename: () => setRenameItem(null),
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
    if (dropped.length > 0) requestUpload(dropped);
  };

  const closeDetail = () => {
    if (selectedId) rememberFile(selectedId);
    navigate(listPath);
  };
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
        const deletedIds = [...result.deleted];
        toast.success(`Moved ${deletedIds.length} ${plural(deletedIds.length)} to Trash`, {
          action: {
            label: "Undo",
            onClick: () => {
              void keva
                .restoreMany(deletedIds)
                .then(() => {
                  void queryClient.invalidateQueries({ queryKey: ["items"] });
                  void queryClient.invalidateQueries({ queryKey: ["trash"] });
                  toast.success(`Restored ${deletedIds.length} ${plural(deletedIds.length)}`);
                })
                .catch((error) => toast.error(errorMessage(error)));
            },
          },
        });
      }
      if (result.failed.length > 0) {
        toast.error(`Failed to delete ${result.failed.length} ${plural(result.failed.length)}`);
      }
      setRowSelection({});
      removeDeletedItemsFromCache(queryClient, result.deleted);
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      if (selectedId && result.deleted.includes(selectedId)) {
        navigateAfterDeletion(result.deleted);
      }
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const selectedItems = selectedRows.map((row) => row.original);
  const selectedIds = selectedItems.map((item) => item.id);

  const bulkPatchMutation = useMutation({
    mutationFn: ({ set, unset }: { set: Record<string, PropertyValue>; unset: string[] }) =>
      keva.patchMany(
        selectedItems.map((item) => ({ id: item.id, expectedRevision: item.revision })),
        {
          set,
          unset,
        },
      ),
    onSuccess: (result) => {
      setBulkPropertiesOpen(false);
      setBulkPropertyKey("");
      setBulkPropertyValue("");
      setRowSelection({});
      void queryClient.invalidateQueries({ queryKey: ["items"] });
      if (result.updated.length > 0) {
        invalidatePropertyDiscovery(queryClient);
        toast.success(`Updated ${result.updated.length} ${plural(result.updated.length)}`);
      }
      if (result.failed.length > 0)
        toast.error(`Could not update ${result.failed.length} ${plural(result.failed.length)}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const bulkDownloadMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        selectedItems.map(async (item) => ({ item, target: await keva.getDownloadUrl(item.id) })),
      );
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const anchor = document.createElement("a");
        anchor.href = result.value.target.url;
        anchor.download = result.value.item.name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      }
      return results;
    },
    onSuccess: (results) => {
      const failed = results.filter((result) => result.status === "rejected").length;
      const downloaded = results.length - failed;
      if (downloaded > 0)
        toast.success(`Started ${downloaded} ${downloaded === 1 ? "download" : "downloads"}`);
      if (failed > 0) toast.error(`Could not download ${failed} ${plural(failed)}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onBulkDelete = () => {
    if (selectedIds.length > 0) bulkDeleteMutation.mutate(selectedIds);
  };

  const submitBulkProperty = (remove: boolean) => {
    const key = bulkPropertyKey.trim();
    const keyError = validateKey(key);
    if (keyError) {
      toast.error(keyError);
      return;
    }
    if (remove) {
      bulkPatchMutation.mutate({ set: {}, unset: [key] });
      return;
    }
    const parsed = inferPropertyValue(bulkPropertyValue);
    if (!parsed.ok) {
      toast.error(parsed.error);
      return;
    }
    bulkPatchMutation.mutate({ set: { [key]: parsed.value }, unset: [] });
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

  const downloadItem = async (item: FileRow) => {
    try {
      const target = await keva.getDownloadUrl(item.id);
      const anchor = document.createElement("a");
      anchor.href = target.url;
      anchor.download = item.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const tableInner = (
    <FileTable>
      <FileTableHeader>
        {table.getHeaderGroups().map((group) => (
          <FileTableRow key={group.id} className="group">
            {group.headers.map((header) => (
              <FileTableHead
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
              </FileTableHead>
            ))}
          </FileTableRow>
        ))}
      </FileTableHeader>
      <FileTableBody>
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <FileTableRow key={`skeleton-${i}`}>
                {table.getVisibleLeafColumns().map((col) => (
                  <FileTableCell
                    key={col.id}
                    className={cn(col.id === "select" && "w-10", responsiveColumnClass(col.id))}
                  >
                    {col.id !== "select" && <Skeleton className="h-5 w-full" />}
                  </FileTableCell>
                ))}
              </FileTableRow>
            ))
          : rows.map((row) => {
              const tableRow = (
                <FileTableRow
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  data-current={row.original.id === selectedId ? "true" : undefined}
                  aria-current={row.original.id === selectedId ? "true" : undefined}
                  className={cn("group", !row.original.upload && "cursor-pointer")}
                  onContextMenu={() => {
                    if (!row.original.upload) row.toggleSelected(true);
                  }}
                  onClick={() => {
                    if (row.original.upload) return;
                    rememberFile(row.original.id);
                    navigate(row.original.id === selectedId ? listPath : itemPath(row.original.id));
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <FileTableCell
                      key={cell.id}
                      className={cn(
                        cell.column.id === "select" && "w-10",
                        responsiveColumnClass(cell.column.id),
                      )}
                      onClick={cell.column.id === "select" ? (e) => e.stopPropagation() : undefined}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </FileTableCell>
                  ))}
                </FileTableRow>
              );

              if (row.original.upload) return <Fragment key={row.id}>{tableRow}</Fragment>;

              return (
                <ContextMenu key={row.id}>
                  <ContextMenuTrigger render={tableRow} />
                  <ContextMenuContent>
                    <ContextMenuGroup>
                      <ContextMenuItem onClick={() => navigate(itemPath(row.original.id))}>
                        <Eye />
                        Preview
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => {
                          const target = new URL(itemPath(row.original.id), window.location.origin);
                          target.searchParams.set("panel", "properties");
                          navigate(`${target.pathname}${target.search}`);
                        }}
                      >
                        <Tags />
                        Properties
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => void downloadItem(row.original)}>
                        <Download />
                        Download
                      </ContextMenuItem>
                      <ContextMenuItem onClick={() => setShareItem(row.original)}>
                        <Share2 />
                        Share
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() =>
                          setRenameItem({ id: row.original.id, draft: row.original.name })
                        }
                      >
                        <Pencil />
                        Rename
                      </ContextMenuItem>
                    </ContextMenuGroup>
                    <ContextMenuSeparator />
                    <ContextMenuGroup>
                      <ContextMenuItem
                        variant="destructive"
                        onClick={() => setDeleteItem(row.original)}
                      >
                        <Trash2 />
                        Delete
                      </ContextMenuItem>
                    </ContextMenuGroup>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
      </FileTableBody>
    </FileTable>
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
  const HeaderViewIcon = viewIcon(view?.icon);

  const browserControls = (
    <div className="flex w-full min-w-0 shrink-0 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-3 px-1">
        <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-3">
          {viewId && view ? (
            <div className="flex max-w-[24rem] min-w-0 items-center">
              <ViewIconPicker
                value={view.icon}
                onChange={changeIcon}
                trigger={
                  <button
                    type="button"
                    title="Change icon"
                    aria-label="Change view icon"
                    className="group/vicon relative flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted sm:size-9"
                  >
                    <HeaderViewIcon className="size-5 sm:size-6" />
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
                  className="h-8 w-56 text-lg font-medium sm:h-9 sm:text-[21px]"
                />
              ) : (
                <button
                  type="button"
                  title="Rename view"
                  aria-label="Rename view"
                  onClick={startNameEdit}
                  className="group/vname relative flex min-w-0 items-center rounded-md text-left"
                >
                  <span className="truncate text-lg leading-none font-medium sm:text-[21px]">
                    {view.name}
                  </span>
                  <span className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60 text-muted-foreground opacity-0 backdrop-blur-[1px] transition-opacity group-hover/vname:opacity-100 group-focus-visible/vname:opacity-100">
                    <Pencil className="size-4" />
                  </span>
                </button>
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
            <div className="flex max-w-[24rem] min-w-0 items-center">
              <div className="flex size-8 shrink-0 items-center justify-center sm:size-9">
                <Files className="size-5 sm:size-6" />
              </div>
              <h1 className="truncate text-lg leading-none font-medium sm:text-[21px]">All</h1>
            </div>
          )}
          {!selectMode && (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <ToggleGroup
                variant="outline"
                size="sm"
                value={[fileLayout]}
                onValueChange={(value) => {
                  const next = value[0];
                  if (next === "list" || next === "grid") setFileLayout(next);
                }}
                aria-label="File layout"
              >
                <ToggleGroupItem value="list" aria-label="List view" title="List view">
                  <List />
                </ToggleGroupItem>
                <ToggleGroupItem value="grid" aria-label="Grid view" title="Grid view">
                  <LayoutGrid />
                </ToggleGroupItem>
              </ToggleGroup>
              <FilterMenuButton
                draft={filterDraft}
                onDraftChange={setFilterDraft}
                onApply={applyWhere}
                className="h-7 px-2 text-[0.8rem] sm:h-8 sm:px-2.5 sm:text-sm [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-4"
              />
              {uploadStampEntries.length > 0 ? (
                <HoverCard>
                  <HoverCardTrigger
                    delay={100}
                    closeDelay={100}
                    render={
                      <Button
                        onClick={() => requestUpload()}
                        className="h-7 px-2 text-[0.8rem] sm:h-8 sm:px-2.5 sm:text-sm [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-4"
                      />
                    }
                  >
                    <Upload data-icon="inline-start" />
                    Upload
                  </HoverCardTrigger>
                  <HoverCardContent side="bottom" className="w-80">
                    <div className="flex flex-col gap-2 py-1">
                      <p className="text-muted-foreground">
                        These properties will be added to every file you upload
                      </p>
                      <UploadPropertyBadges entries={uploadStampEntries} />
                    </div>
                  </HoverCardContent>
                </HoverCard>
              ) : (
                <Button
                  onClick={() => requestUpload()}
                  className="h-7 px-2 text-[0.8rem] sm:h-8 sm:px-2.5 sm:text-sm [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-4"
                >
                  <Upload data-icon="inline-start" />
                  Upload
                </Button>
              )}
            </div>
          )}
        </div>
        {!selectMode && (
          <div className="flex min-h-[42px] min-w-0 shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-1.5">
            {!viewId && (
              <div
                className="base-ui-disable-scrollbar flex w-full max-w-full flex-nowrap items-center overflow-x-auto rounded-lg border border-border bg-muted/70 p-1 sm:w-fit sm:flex-wrap sm:overflow-visible"
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
                        "shrink-0 rounded-md px-4 text-muted-foreground shadow-none hover:text-foreground",
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
            {showFilterRow && (
              <>
                <div className="base-ui-disable-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto pb-0.5 sm:overflow-visible sm:pb-0">
                  <FilterBar
                    draft={filterDraft}
                    onDraftChange={setFilterDraft}
                    onApply={applyWhere}
                    onClear={clearFilters}
                  />
                </div>
                <div className="base-ui-disable-scrollbar flex w-full items-center justify-end gap-1.5 overflow-x-auto pb-0.5 sm:ml-auto sm:w-auto sm:overflow-visible sm:pb-0">
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
              </>
            )}
          </div>
        )}
      </div>
      {selectMode && (
        <div className="flex min-h-[42px] shrink-0 flex-wrap items-center gap-2 px-1">
          <span className="text-sm font-medium">{selectedCount} selected</span>
          <Button variant="ghost" size="sm" onClick={() => setRowSelection({})}>
            Clear
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={bulkDownloadMutation.isPending}
              onClick={() => bulkDownloadMutation.mutate()}
            >
              <Download data-icon="inline-start" />
              Download
            </Button>
            <Button variant="outline" size="sm" onClick={() => setBulkPropertiesOpen(true)}>
              <Tags data-icon="inline-start" />
              Properties
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setBulkShareKey((key) => key + 1);
                setBulkShareOpen(true);
              }}
            >
              <Share2 data-icon="inline-start" />
              Share
            </Button>
            <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
              <AlertDialogTrigger
                render={<Button variant="destructive" disabled={bulkDeleteMutation.isPending} />}
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
                    The selected {plural(selectedCount)} will move to Trash, where you can restore
                    them or delete them forever.
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
        </div>
      )}
    </div>
  );

  const gridActions = {
    onOpen: (item: FileRow) => {
      rememberFile(item.id);
      navigate(item.id === selectedId ? listPath : itemPath(item.id));
    },
    onOpenProperties: (item: FileRow) => {
      const target = new URL(itemPath(item.id), window.location.origin);
      target.searchParams.set("panel", "properties");
      navigate(`${target.pathname}${target.search}`);
    },
    onDownload: (item: FileRow) => void downloadItem(item),
    onShare: setShareItem,
    onRename: (item: FileRow) => setRenameItem({ id: item.id, draft: item.name }),
    onDelete: setDeleteItem,
  };

  const collectionPane = (
    <FileTableFrame
      footer={
        <FileTableFooter>
          {pageControls}
          <FileTableItemCount count={totalItems} />
        </FileTableFooter>
      }
    >
      {!loading && rows.length === 0 ? (
        <Empty className="h-full py-16">
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
          {!filtered && !hasItems ? (
            <Button onClick={() => requestUpload()}>
              <Upload data-icon="inline-start" />
              Upload
            </Button>
          ) : filtered ? (
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : emptyPage ? (
            <Button variant="outline" onClick={() => goToPage(1)}>
              Return to first page
            </Button>
          ) : null}
        </Empty>
      ) : fileLayout === "grid" ? (
        <FileGrid
          rows={rows}
          selectedId={selectedId}
          loading={loading}
          actions={gridActions}
          meta={table.options.meta!}
        />
      ) : (
        tableInner
      )}
    </FileTableFrame>
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
      className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col gap-3 overflow-hidden p-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300 md:p-4"
    >
      {pageDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex max-w-lg flex-col items-center gap-4 rounded-xl border-2 border-dashed border-primary px-12 py-10 text-center">
            <CloudUpload className="size-10 text-primary" />
            <p className="font-heading text-4xl font-semibold tracking-tight">Drop to upload</p>
            {uploadStampEntries.length > 0 && (
              <div className="flex flex-col items-center gap-2">
                <p className="text-sm text-muted-foreground">
                  These properties will be added to every file you drop:
                </p>
                <UploadPropertyBadges entries={uploadStampEntries} />
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="shrink-0 p-4">
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{error}</AlertTitle>
            <Button variant="outline" size="sm" onClick={() => void itemsQuery.refetch()}>
              Retry
            </Button>
          </Alert>
        </div>
      )}

      {browserControls}

      <FileBrowserFrame
        list={collectionPane}
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

      <AlertDialog
        open={Boolean(deleteItem)}
        onOpenChange={(open) => {
          if (!open) setDeleteItem(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteItem?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This moves the item to Trash, where you can restore it or delete it forever.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={bulkDeleteMutation.isPending}
              onClick={() => {
                if (!deleteItem) return;
                bulkDeleteMutation.mutate([deleteItem.id]);
                setDeleteItem(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <input
        ref={uploadInputRef}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) requestUpload(files);
          e.target.value = "";
        }}
      />

      <BillingRequiredDialog open={billingRequiredOpen} onOpenChange={setBillingRequiredOpen} />

      <ShareCreateDialog
        key={`share-${shareKey}`}
        open={shareOpen}
        onOpenChange={setShareOpen}
        viewId={viewId ?? ""}
        conditions={activeWhere}
      />

      <ShareCreateDialog
        key={`bulk-share-${bulkShareKey}`}
        open={bulkShareOpen}
        onOpenChange={setBulkShareOpen}
        viewId=""
        conditions={[{ key: "id", op: "in", value: selectedIds }]}
      />

      <ShareCreateDialog
        key={`item-share-${shareItem?.id ?? "none"}`}
        open={Boolean(shareItem)}
        onOpenChange={(open) => {
          if (!open) setShareItem(null);
        }}
        viewId=""
        conditions={shareItem ? [{ key: "id", op: "eq", value: shareItem.id }] : []}
      />

      <Dialog open={bulkPropertiesOpen} onOpenChange={setBulkPropertiesOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Edit properties for {selectedCount} {plural(selectedCount)}
            </DialogTitle>
            <DialogDescription>
              Add, update, or remove one property across every selected file. Separate multiple
              values with commas; leave the value empty to add a tag.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="bulk-property-key">Property key</FieldLabel>
              <Input
                id="bulk-property-key"
                value={bulkPropertyKey}
                onChange={(event) => setBulkPropertyKey(event.target.value)}
                placeholder="project"
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="bulk-property-value">Value</FieldLabel>
              <Input
                id="bulk-property-value"
                value={bulkPropertyValue}
                onChange={(event) => setBulkPropertyValue(event.target.value)}
                placeholder="alpha, beta"
              />
            </Field>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button
              variant="outline"
              disabled={!bulkPropertyKey.trim() || bulkPatchMutation.isPending}
              onClick={() => submitBulkProperty(true)}
            >
              Remove property
            </Button>
            <Button
              disabled={!bulkPropertyKey.trim() || bulkPatchMutation.isPending}
              onClick={() => submitBulkProperty(false)}
            >
              Apply to {selectedCount}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
