import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { ArchiveRestore, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
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
import { FileDetail } from "../components/FileDetail";
import { FileBrowserFrame } from "../components/file-browser/FileBrowserFrame";
import {
  FileName,
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
import { errorMessage } from "../lib/errors";
import { formatBytes, formatRelative } from "../lib/format";
import { itemListsQueryKey } from "../lib/items-cache";
import { keva } from "../lib/keva";
import { ACTIVE_METADATA_REFETCH_INTERVAL } from "../lib/query-client";

const trashQueryKey = ["trash"] as const;

export function TrashPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id: itemId } = useParams<{ id: string }>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [purgeOpen, setPurgeOpen] = useState(false);
  const trashQuery = useQuery({
    queryKey: trashQueryKey,
    queryFn: () => keva.listTrash(),
    refetchInterval: ACTIVE_METADATA_REFETCH_INTERVAL,
  });
  const items = trashQuery.data ?? [];
  const selectedIds = useMemo(() => [...selected], [selected]);
  const allSelected = items.length > 0 && selected.size === items.length;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trashQueryKey });
    void queryClient.invalidateQueries({ queryKey: itemListsQueryKey });
  };

  const restoreMutation = useMutation({
    mutationFn: (ids: readonly string[]) => keva.restoreMany(ids),
    onSuccess: (result) => {
      setSelected(new Set());
      refresh();
      if (result.restored.length > 0)
        toast.success(
          `Restored ${result.restored.length} ${result.restored.length === 1 ? "file" : "files"}`,
        );
      if (result.failed.length > 0)
        toast.error(
          `Could not restore ${result.failed.length} ${result.failed.length === 1 ? "file" : "files"}`,
        );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const purgeMutation = useMutation({
    mutationFn: (ids: readonly string[]) => keva.purgeMany(ids),
    onSuccess: (result) => {
      setPurgeOpen(false);
      setSelected(new Set());
      refresh();
      if (result.deleted.length > 0)
        toast.success(
          `Permanently deleted ${result.deleted.length} ${result.deleted.length === 1 ? "file" : "files"}`,
        );
      if (result.failed.length > 0)
        toast.error(
          `Could not delete ${result.failed.length} ${result.failed.length === 1 ? "file" : "files"}`,
        );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300 md:p-4">
      <div className="flex min-w-0 shrink-0 items-center justify-between gap-2 px-1 sm:gap-3">
        <div className="flex max-w-[24rem] min-w-0 items-center text-destructive">
          <div className="flex size-8 shrink-0 items-center justify-center sm:size-9">
            <Trash2 className="size-5 sm:size-6" />
          </div>
          <h1 className="truncate text-lg leading-none font-medium sm:text-[21px]">Trash</h1>
        </div>
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {selectedIds.length} selected
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={restoreMutation.isPending}
              onClick={() => restoreMutation.mutate(selectedIds)}
            >
              <ArchiveRestore data-icon="inline-start" />
              Restore
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={purgeMutation.isPending}
              onClick={() => setPurgeOpen(true)}
            >
              <Trash2 data-icon="inline-start" />
              Delete forever
            </Button>
          </div>
        )}
      </div>

      {trashQuery.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{errorMessage(trashQuery.error)}</AlertTitle>
          <Button variant="outline" size="sm" onClick={() => void trashQuery.refetch()}>
            Retry
          </Button>
        </Alert>
      )}

      <FileBrowserFrame
        detailOpen={Boolean(itemId)}
        onDetailOpenChange={(open) => {
          if (!open) navigate("/trash");
        }}
        detailTitle={items.find((item) => item.id === itemId)?.name ?? "Trash preview"}
        detail={
          itemId ? (
            <FileDetail
              itemId={itemId}
              variant="trash"
              onClose={() => navigate("/trash")}
              onRestored={() => navigate("/trash")}
              onPurged={() => navigate("/trash")}
            />
          ) : null
        }
        list={
          <FileTableFrame
            footer={
              <FileTableFooter className="h-12 justify-end">
                <FileTableItemCount count={items.length} />
              </FileTableFooter>
            }
          >
            {trashQuery.isPending ? (
              <div className="flex flex-col gap-3 p-4" aria-busy="true">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-9 w-full" />
                ))}
              </div>
            ) : items.length === 0 ? (
              <Empty className="h-full py-20">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Trash2 />
                  </EmptyMedia>
                  <EmptyTitle>Trash is empty</EmptyTitle>
                  <EmptyDescription>
                    Deleted files will stay here until you permanently remove them.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <FileTable>
                <FileTableHeader>
                  <FileTableRow>
                    <FileTableHead className="w-10">
                      <Checkbox
                        aria-label="Select all files in Trash"
                        checked={allSelected}
                        onCheckedChange={() =>
                          setSelected(
                            allSelected ? new Set() : new Set(items.map((item) => item.id)),
                          )
                        }
                      />
                    </FileTableHead>
                    <FileTableHead>Name</FileTableHead>
                    <FileTableHead className="hidden sm:table-cell">Size</FileTableHead>
                    <FileTableHead className="hidden md:table-cell">Deleted</FileTableHead>
                    <FileTableHead className="w-40">
                      <span className="sr-only">Actions</span>
                    </FileTableHead>
                  </FileTableRow>
                </FileTableHeader>
                <FileTableBody>
                  {items.map((item) => (
                    <FileTableRow
                      key={item.id}
                      data-state={selected.has(item.id) ? "selected" : undefined}
                      data-current={item.id === itemId ? "true" : undefined}
                      aria-current={item.id === itemId ? "true" : undefined}
                      className="cursor-pointer"
                      onClick={() => navigate(`/trash/items/${item.id}`)}
                    >
                      <FileTableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          aria-label={`Select ${item.name}`}
                          checked={selected.has(item.id)}
                          onCheckedChange={() => toggle(item.id)}
                        />
                      </FileTableCell>
                      <FileTableCell className="min-w-0 overflow-hidden">
                        <FileName name={item.name} contentType={item.contentType} />
                      </FileTableCell>
                      <FileTableCell className="hidden text-muted-foreground sm:table-cell">
                        {formatBytes(item.size)}
                      </FileTableCell>
                      <FileTableCell
                        className="hidden text-muted-foreground md:table-cell"
                        title={new Date(item.deletedAt).toLocaleString()}
                      >
                        {formatRelative(item.deletedAt)}
                      </FileTableCell>
                      <FileTableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={restoreMutation.isPending}
                            onClick={() => restoreMutation.mutate([item.id])}
                          >
                            Restore
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Permanently delete ${item.name}`}
                            title="Delete forever"
                            onClick={() => {
                              setSelected(new Set([item.id]));
                              setPurgeOpen(true);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </FileTableCell>
                    </FileTableRow>
                  ))}
                </FileTableBody>
              </FileTable>
            )}
          </FileTableFrame>
        }
      />

      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {selectedIds.length === 1 ? "this file" : `${selectedIds.length} files`}{" "}
              forever?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the file data and properties permanently. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => purgeMutation.mutate(selectedIds)}
            >
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
