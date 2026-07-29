import {
  File,
  FileAudio,
  FileText,
  FileVideo,
  Image,
  LoaderCircle,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { createColumnHelper, type RowData } from "@tanstack/react-table";
import type { PropertyValue, QueryOrder } from "@keva/schema";
import { formatPropertyValue, formatBytes, formatRelative } from "../../lib/format";
import { type UploadQueueRow } from "../../lib/use-upload-queue";
import { fileSortColumn, fileSortDirection, type FileSortColumn } from "../../lib/file-order";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUpDown } from "lucide-react";

export type FileRow = UploadQueueRow;

declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    onRetryUpload: (row: FileRow) => void;
    onFilterByProperty: (key: string, value: PropertyValue) => void;
    onOpenItem: (itemId: string) => void;
    renamingId: string | null;
    renameDraft: string;
    renameInputRef: (node: HTMLInputElement | null) => void;
    onRenameDraftChange: (value: string) => void;
    onCommitRename: (item: FileRow) => void;
    onCancelRename: () => void;
    order: QueryOrder;
    onSort: (column: FileSortColumn) => void;
  }
}

const filenameParts = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot <= 0
    ? { stem: name, extension: "" }
    : { stem: name.slice(0, dot), extension: name.slice(dot) };
};

const propertyChipLabel = (key: string, value: PropertyValue): string => {
  if (value === null) return key;
  return `${key}:${formatPropertyValue(value)}`;
};

export const fileKindIcon = (contentType: string): LucideIcon => {
  if (contentType.startsWith("image/")) return Image;
  if (contentType.startsWith("video/")) return FileVideo;
  if (contentType.startsWith("audio/")) return FileAudio;
  if (
    contentType.startsWith("text/") ||
    contentType === "application/pdf" ||
    contentType === "application/json" ||
    contentType.includes("word") ||
    contentType.includes("document") ||
    contentType.includes("rtf")
  ) {
    return FileText;
  }
  return File;
};

const columnHelper = createColumnHelper<FileRow>();

export const responsiveColumnClass = (columnId: string) => {
  if (columnId === "name") return "min-w-0 overflow-hidden";
  if (columnId === "size") return "hidden sm:table-cell";
  if (columnId === "updatedAt") return "hidden sm:table-cell";
  if (columnId === "properties") return "hidden lg:table-cell";
  return undefined;
};

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

const columns = [
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all on this page"
        checked={table.getIsAllRowsSelected()}
        indeterminate={table.getIsSomeRowsSelected()}
        onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
        className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
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
            row.getIsSelected()
              ? "opacity-100"
              : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
          )}
        />
      );
    },
  }),
  columnHelper.accessor("name", {
    header: ({ table }) => (
      <SortButton
        label="Name"
        column="name"
        order={table.options.meta!.order}
        onSort={table.options.meta!.onSort}
      />
    ),
    cell: ({ getValue, row, table }) => {
      const meta = table.options.meta;
      if (meta?.renamingId === row.original.id) {
        return (
          <Input
            ref={meta.renameInputRef}
            value={meta.renameDraft}
            aria-label={`Rename ${getValue()}`}
            className="h-7 w-full min-w-0 px-2 py-0"
            onChange={(event) => meta.onRenameDraftChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => meta.onCommitRename(row.original)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                meta.onCancelRename();
              }
            }}
          />
        );
      }
      const KindIcon = fileKindIcon(row.original.contentType);
      const filename = filenameParts(getValue());
      return (
        <div className="flex min-w-0 items-center gap-2.5">
          <KindIcon className="size-4 shrink-0 text-muted-foreground" />
          <button
            type="button"
            className="flex w-full min-w-0 text-left text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={getValue()}
            aria-label={getValue()}
            onClick={(event) => {
              event.stopPropagation();
              meta?.onOpenItem(row.original.id);
            }}
          >
            <span className="min-w-0 truncate">{filename.stem}</span>
            <span className="shrink-0">{filename.extension}</span>
          </button>
        </div>
      );
    },
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
    header: ({ table }) => (
      <SortButton
        label="Updated"
        column="updatedAt"
        order={table.options.meta!.order}
        onSort={table.options.meta!.onSort}
      />
    ),
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
                className="cursor-pointer transition-colors hover:bg-primary/15 hover:text-foreground"
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

export { columns };
