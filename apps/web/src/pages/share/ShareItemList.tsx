import { Download, Files, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SharedItem } from "@keva/sdk";
import { toast } from "sonner";
import {
  FileName,
  FileProperties,
  FileTable,
  FileTableBody,
  FileTableCell,
  FileTableFooter,
  FileTableFrame,
  FileTableHead,
  FileTableHeader,
  FileTableItemCount,
  FileTableRow,
} from "../../components/file-browser/FileTable";
import { NumberedPagination } from "../../components/file-browser/NumberedPagination";
import { errorMessage } from "../../lib/errors";
import { formatBytes, formatRelative } from "../../lib/format";
import { buildFilterWhere, createFilterDraft, type KindId } from "../../lib/item-filters";
import { removeDeletedShareItemFromCache, shareItemsQueryKey } from "../../lib/items-cache";
import { useShare } from "./share-context";
import type { UploadState } from "./use-share-upload";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const QUICK_KINDS: ReadonlyArray<{ id: KindId | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "document", label: "Document" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
];

type ShareRow = SharedItem & { readonly upload?: UploadState };

const optimisticRow = (upload: UploadState): ShareRow => {
  const now = new Date().toISOString();
  return {
    id: upload.id,
    name: upload.file.name,
    contentType: upload.file.type || "application/octet-stream",
    declaredSize: upload.file.size,
    size: upload.file.size,
    etag: null,
    source: "upload",
    status: "pending",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    properties: {},
    canDelete: false,
    upload,
  };
};

function ShareItemsTable({
  rows,
  loading,
  collapsed,
  selected,
  selectedId,
  onSelect,
  onSelectionChange,
  onRetryUpload,
}: {
  rows: readonly ShareRow[];
  loading: boolean;
  collapsed: boolean;
  selected: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSelectionChange: (selected: ReadonlySet<string>) => void;
  onRetryUpload: (entry: UploadState) => void;
}) {
  const selectableRows = rows.filter((row) => !row.upload);
  const selectedItems = selectableRows.filter((row) => selected.has(row.id));
  const allSelected = selectableRows.length > 0 && selectedItems.length === selectableRows.length;
  const someSelected = selectedItems.length > 0 && !allSelected;
  const toggleSelected = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onSelectionChange(next);
  };

  return (
    <FileTable>
      <FileTableHeader>
        <FileTableRow className="group">
          <FileTableHead className="w-10">
            <Checkbox
              aria-label="Select all on this page"
              checked={allSelected}
              indeterminate={someSelected}
              disabled={selectableRows.length === 0}
              onCheckedChange={(checked) =>
                onSelectionChange(
                  checked ? new Set(selectableRows.map((row) => row.id)) : new Set(),
                )
              }
              className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
            />
          </FileTableHead>
          <FileTableHead className="min-w-0 overflow-hidden">Name</FileTableHead>
          <FileTableHead className="hidden sm:table-cell">Size</FileTableHead>
          {!collapsed && (
            <>
              <FileTableHead className="hidden sm:table-cell">Updated</FileTableHead>
              <FileTableHead className="hidden lg:table-cell">Properties</FileTableHead>
            </>
          )}
        </FileTableRow>
      </FileTableHeader>
      <FileTableBody>
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <FileTableRow key={`skeleton-${i}`}>
                <FileTableCell className="w-10">
                  <Skeleton className="size-4" />
                </FileTableCell>
                <FileTableCell className="min-w-0 overflow-hidden">
                  <Skeleton className="h-5 w-full" />
                </FileTableCell>
                <FileTableCell className="hidden sm:table-cell">
                  <Skeleton className="h-5 w-full" />
                </FileTableCell>
                {!collapsed && (
                  <>
                    <FileTableCell className="hidden sm:table-cell">
                      <Skeleton className="h-5 w-full" />
                    </FileTableCell>
                    <FileTableCell className="hidden lg:table-cell">
                      <Skeleton className="h-5 w-full" />
                    </FileTableCell>
                  </>
                )}
              </FileTableRow>
            ))
          : rows.map((item) => (
              <FileTableRow
                key={item.id}
                data-state={
                  selected.has(item.id) || item.id === selectedId ? "selected" : undefined
                }
                className={cn("group", !item.upload && "cursor-pointer")}
                onClick={() => {
                  if (!item.upload) onSelect(item.id);
                }}
              >
                <FileTableCell className="w-10" onClick={(event) => event.stopPropagation()}>
                  {item.upload?.status === "uploading" ? (
                    <LoaderCircle
                      aria-label="Uploading"
                      className="size-4 animate-spin text-muted-foreground"
                    />
                  ) : item.upload?.status === "error" ? (
                    <button
                      type="button"
                      aria-label={`Upload failed: ${item.upload.error ?? "unknown error"}. Click to retry`}
                      title={`${item.upload.error ?? "Upload failed"} — click to retry`}
                      onClick={() => onRetryUpload(item.upload!)}
                      className="flex size-5 items-center justify-center rounded text-destructive hover:bg-destructive/10"
                    >
                      <TriangleAlert className="size-4" />
                    </button>
                  ) : (
                    <Checkbox
                      aria-label={`Select ${item.name}`}
                      checked={selected.has(item.id)}
                      onCheckedChange={(checked) => toggleSelected(item.id, checked)}
                      className={cn(
                        "transition-opacity",
                        selected.has(item.id)
                          ? "opacity-100"
                          : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
                      )}
                    />
                  )}
                </FileTableCell>
                <FileTableCell className="min-w-0 overflow-hidden">
                  <FileName
                    name={item.name}
                    contentType={item.contentType}
                    {...(item.upload ? {} : { onOpen: () => onSelect(item.id) })}
                  />
                </FileTableCell>
                <FileTableCell className="hidden text-muted-foreground tabular-nums sm:table-cell">
                  {formatBytes(item.size)}
                </FileTableCell>
                {!collapsed && (
                  <>
                    <FileTableCell className="hidden text-muted-foreground sm:table-cell">
                      {formatRelative(item.updatedAt)}
                    </FileTableCell>
                    <FileTableCell className="hidden lg:table-cell">
                      <FileProperties properties={item.properties} />
                    </FileTableCell>
                  </>
                )}
              </FileTableRow>
            ))}
      </FileTableBody>
    </FileTable>
  );
}

interface ShareItemListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  action?: ReactNode;
  uploads: readonly UploadState[];
  onRetryUpload: (entry: UploadState) => void;
}

export function ShareItemList({
  selectedId,
  onSelect,
  collapsed,
  action,
  uploads,
  onRetryUpload,
}: ShareItemListProps) {
  const { client } = useShare();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<KindId | "all">("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const where = buildFilterWhere({
    ...createFilterDraft(),
    kinds: kind === "all" ? [] : [kind],
  });

  const itemsQuery = useQuery({
    queryKey: [...shareItemsQueryKey(""), kind, page],
    queryFn: () =>
      client.query({
        where,
        order: "created_at_desc",
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
    placeholderData: (previous) => previous,
  });

  const serverItems = itemsQuery.data?.items ?? [];
  const uploadRows = useMemo<ShareRow[]>(
    () =>
      page === 1
        ? uploads.map((upload) => (upload.item ? upload.item : optimisticRow(upload)))
        : [],
    [page, uploads],
  );
  const uploadedItemIds = new Set<string>();
  for (const row of uploadRows) {
    if (!row.upload) uploadedItemIds.add(row.id);
  }
  const rows: ShareRow[] = [
    ...uploadRows,
    ...serverItems.filter((item) => !uploadedItemIds.has(item.id)),
  ];
  const totalItems =
    (itemsQuery.data?.totalCount ?? serverItems.length) +
    uploadRows.filter((row) => row.upload).length;
  const loading = itemsQuery.isLoading;
  const selectableRows = rows.filter((row) => !row.upload);
  const selectedItems = selectableRows.filter((row) => selected.has(row.id));
  const deletableItems = selectedItems.filter((item) => item.canDelete);
  const canDeleteSelection =
    selectedItems.length > 0 && deletableItems.length === selectedItems.length;

  const clearSelection = () => setSelected(new Set());
  const downloadMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        selectedItems.map(async (item) => ({ item, target: await client.getDownloadUrl(item.id) })),
      );
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const anchor = document.createElement("a");
        anchor.href = result.value.target.url;
        anchor.download = result.value.item.name;
        anchor.rel = "noreferrer";
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
      if (failed > 0)
        toast.error(`Could not download ${failed} ${failed === 1 ? "file" : "files"}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        deletableItems.map(async (item) => {
          await client.delete(item.id);
          return item;
        }),
      );
      return results;
    },
    onSuccess: (results) => {
      const deleted = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = results.length - deleted.length;
      for (const item of deleted) removeDeletedShareItemFromCache(queryClient, item.id);
      setSelected((current) => {
        const next = new Set(current);
        for (const item of deleted) next.delete(item.id);
        return next;
      });
      if (deleted.length > 0) {
        toast.success(
          `Moved ${deleted.length} ${deleted.length === 1 ? "upload" : "uploads"} to the owner’s Trash`,
        );
      }
      if (failed > 0)
        toast.error(`Could not remove ${failed} ${failed === 1 ? "upload" : "uploads"}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3">
      <div className="flex w-full shrink-0 flex-col gap-3 px-1">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="base-ui-disable-scrollbar flex w-full max-w-full flex-nowrap items-center overflow-x-auto rounded-lg border border-border bg-muted/70 p-1 sm:w-fit sm:flex-wrap sm:overflow-visible"
            aria-label="File type"
          >
            {QUICK_KINDS.map((option) => (
              <Button
                key={option.id}
                variant="ghost"
                size="sm"
                aria-pressed={kind === option.id}
                className={cn(
                  "shrink-0 rounded-md px-4 text-muted-foreground shadow-none hover:text-foreground",
                  kind === option.id &&
                    "bg-background text-foreground hover:bg-background hover:text-foreground",
                )}
                onClick={() => {
                  setKind(option.id);
                  setPage(1);
                  clearSelection();
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {action && <div className="ml-auto">{action}</div>}
        </div>
        {selectedItems.length > 0 && (
          <div className="flex min-h-10 flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{selectedItems.length} selected</span>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Clear
            </Button>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={downloadMutation.isPending}
                onClick={() => downloadMutation.mutate()}
              >
                <Download data-icon="inline-start" />
                Download
              </Button>
              {canDeleteSelection && (
                <AlertDialog>
                  <AlertDialogTrigger
                    render={<Button variant="destructive" disabled={deleteMutation.isPending} />}
                  >
                    <Trash2 data-icon="inline-start" />
                    Delete
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Delete {deletableItems.length}{" "}
                        {deletableItems.length === 1 ? "upload" : "uploads"}?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        The selected {deletableItems.length === 1 ? "upload" : "uploads"} will move
                        to the owner’s Trash.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => deleteMutation.mutate()}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        )}
      </div>

      <FileTableFrame
        footer={
          <FileTableFooter>
            <NumberedPagination
              page={page}
              totalItems={totalItems}
              pageSize={PAGE_SIZE}
              disabled={itemsQuery.isFetching}
              onPageChange={(nextPage) => {
                setPage(nextPage);
                clearSelection();
              }}
            />
            <FileTableItemCount count={totalItems} />
          </FileTableFooter>
        }
      >
        {!loading && rows.length === 0 ? (
          <Empty className="h-full py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Files />
              </EmptyMedia>
              <EmptyTitle>No files in this share</EmptyTitle>
              <EmptyDescription>
                {kind === "all" ? "There is nothing here yet." : "No files match this type."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ShareItemsTable
            rows={rows}
            loading={loading}
            collapsed={collapsed}
            selected={selected}
            selectedId={selectedId}
            onSelect={onSelect}
            onSelectionChange={setSelected}
            onRetryUpload={onRetryUpload}
          />
        )}
      </FileTableFrame>
    </div>
  );
}
