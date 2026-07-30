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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileDetail } from "../components/FileDetail";
import { FileBrowserFrame } from "../components/file-browser/FileBrowserFrame";
import { errorMessage } from "../lib/errors";
import { formatBytes, formatRelative } from "../lib/format";
import { itemListsQueryKey } from "../lib/items-cache";
import { keva } from "../lib/keva";
import { fileKindIcon } from "./files/file-columns";

const trashQueryKey = ["trash"] as const;

export function TrashPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id: itemId } = useParams<{ id: string }>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [purgeOpen, setPurgeOpen] = useState(false);
  const trashQuery = useQuery({ queryKey: trashQueryKey, queryFn: () => keva.listTrash() });
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
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-4">
      <div className="flex min-h-10 items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2 text-destructive">
          <Trash2 className="size-5" />
          <h1 className="font-heading text-xl font-medium">Trash</h1>
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
          <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border">
            <div className="min-h-0 flex-1 overflow-auto">
              {trashQuery.isPending ? (
                <div className="flex flex-col gap-3 p-4" aria-busy="true">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-9 w-full" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <Empty className="py-20">
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          aria-label="Select all files in Trash"
                          checked={allSelected}
                          onCheckedChange={() =>
                            setSelected(
                              allSelected ? new Set() : new Set(items.map((item) => item.id)),
                            )
                          }
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden sm:table-cell">Size</TableHead>
                      <TableHead className="hidden md:table-cell">Deleted</TableHead>
                      <TableHead className="w-40">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => {
                      const KindIcon = fileKindIcon(item.contentType);
                      return (
                        <TableRow
                          key={item.id}
                          data-state={
                            selected.has(item.id) || item.id === itemId ? "selected" : undefined
                          }
                          className="cursor-pointer"
                          onClick={() => navigate(`/trash/items/${item.id}`)}
                        >
                          <TableCell onClick={(event) => event.stopPropagation()}>
                            <Checkbox
                              aria-label={`Select ${item.name}`}
                              checked={selected.has(item.id)}
                              onCheckedChange={() => toggle(item.id)}
                            />
                          </TableCell>
                          <TableCell className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <KindIcon className="size-4 shrink-0 text-muted-foreground" />
                              <span className="block max-w-[30rem] truncate" title={item.name}>
                                {item.name}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="hidden text-muted-foreground sm:table-cell">
                            {formatBytes(item.size)}
                          </TableCell>
                          <TableCell
                            className="hidden text-muted-foreground md:table-cell"
                            title={new Date(item.deletedAt).toLocaleString()}
                          >
                            {formatRelative(item.deletedAt)}
                          </TableCell>
                          <TableCell onClick={(event) => event.stopPropagation()}>
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
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
            <div className="flex h-12 shrink-0 items-center justify-end border-t px-3 text-sm text-muted-foreground tabular-nums">
              {items.length} {items.length === 1 ? "item" : "items"}
            </div>
          </div>
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
