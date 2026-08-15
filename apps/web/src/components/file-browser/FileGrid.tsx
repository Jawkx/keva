import type { Row, TableMeta } from "@tanstack/react-table";
import type { FileRow } from "../../pages/files/file-columns";
import { FileCard, type FileCardActions } from "./FileCard";
import { Skeleton } from "@/components/ui/skeleton";

export function FileGrid({
  rows,
  selectedId,
  loading,
  actions,
  meta,
}: {
  readonly rows: readonly Row<FileRow>[];
  readonly selectedId: string | undefined;
  readonly loading: boolean;
  readonly actions: FileCardActions;
  readonly meta: TableMeta<FileRow>;
}) {
  return (
    <ul
      aria-label="Files"
      aria-busy={loading}
      className="grid grid-cols-2 gap-2.5 p-2.5 sm:[grid-template-columns:repeat(auto-fill,minmax(11.5rem,1fr))] sm:gap-3 sm:p-3"
    >
      {loading
        ? Array.from({ length: 8 }, (_, index) => (
            <li key={index} className="overflow-hidden rounded-xl border">
              <Skeleton className="aspect-4/3 rounded-none" />
              <div className="flex flex-col gap-2 p-3">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </li>
          ))
        : rows.map((row) => (
            <li key={row.id} className="min-w-0">
              <FileCard
                row={row}
                current={row.original.id === selectedId}
                actions={actions}
                meta={meta}
              />
            </li>
          ))}
    </ul>
  );
}
