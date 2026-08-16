import {
  Download,
  Eye,
  LoaderCircle,
  Pencil,
  Share2,
  Tags,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { Row, TableMeta } from "@tanstack/react-table";
import type { FileRow } from "../../pages/files/file-columns";
import { formatBytes, formatRelative } from "../../lib/format";
import { FileProperties } from "./FileTable";
import { FileThumbnail } from "./FileThumbnail";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";

export type FileCardActions = {
  readonly onOpen: (item: FileRow) => void;
  readonly onOpenProperties: (item: FileRow) => void;
  readonly onDownload: (item: FileRow) => void;
  readonly onShare: (item: FileRow) => void;
  readonly onRename: (item: FileRow) => void;
  readonly onDelete: (item: FileRow) => void;
};

const filenameParts = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot <= 0
    ? { stem: name, extension: "" }
    : { stem: name.slice(0, dot), extension: name.slice(dot) };
};

export function FileCard({
  row,
  current,
  actions,
  meta,
}: {
  readonly row: Row<FileRow>;
  readonly current: boolean;
  readonly actions: FileCardActions;
  readonly meta: TableMeta<FileRow>;
}) {
  const item = row.original;
  const filename = filenameParts(item.name);
  const renaming = meta?.renamingId === item.id;
  const upload = item.upload;

  const card = (
    <article
      aria-current={current ? "true" : undefined}
      aria-label={item.name}
      data-state={row.getIsSelected() ? "selected" : undefined}
      data-current={current ? "true" : undefined}
      className="group relative min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-md data-[current=true]:border-primary data-[current=true]:ring-1 data-[current=true]:ring-primary/30 data-[state=selected]:border-primary/70"
      onContextMenu={() => !upload && row.toggleSelected(true)}
    >
      {!upload && (
        <button
          type="button"
          aria-label={`Open ${item.name}`}
          className="absolute inset-0 z-10 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={() => actions.onOpen(item)}
        />
      )}
      <FileThumbnail itemId={item.id} name={item.name} contentType={item.contentType} />
      <div
        className="absolute top-2 left-2 z-20 flex size-4 items-center justify-center rounded bg-background/90 backdrop-blur-sm"
        onClick={(event) => event.stopPropagation()}
      >
        {upload?.status === "uploading" ? (
          <LoaderCircle
            aria-label="Uploading"
            className="size-4 animate-spin text-muted-foreground"
          />
        ) : upload?.status === "error" ? (
          <button
            type="button"
            aria-label={`Upload failed: ${upload.error ?? "unknown error"}. Click to retry`}
            onClick={() => meta?.onRetryUpload(item)}
            className="flex size-full items-center justify-center text-destructive"
          >
            <TriangleAlert className="size-4" />
          </button>
        ) : (
          <Checkbox
            aria-label={`Select ${item.name}`}
            checked={row.getIsSelected()}
            onCheckedChange={(checked) => row.toggleSelected(checked)}
          />
        )}
      </div>
      <div className="pointer-events-none flex min-w-0 flex-col gap-2 rounded-b-xl bg-muted/40 p-3 transition-colors group-hover:bg-muted/70">
        {renaming ? (
          <Input
            ref={meta?.renameInputRef}
            value={meta?.renameDraft ?? ""}
            aria-label={`Rename ${item.name}`}
            className="pointer-events-auto relative z-20 h-7 min-w-0 px-2 py-0"
            onChange={(event) => meta?.onRenameDraftChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => meta?.onCommitRename(item)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") meta?.onCancelRename();
            }}
          />
        ) : (
          <div className="flex min-w-0 text-sm font-medium" title={item.name}>
            <span className="min-w-0 truncate">{filename.stem}</span>
            <span className="shrink-0">{filename.extension}</span>
          </div>
        )}
        <div className="-mx-3 -mb-3 mt-2 px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">{formatBytes(item.size)}</span>
            <span className="truncate">{formatRelative(item.updatedAt)}</span>
          </div>
          <div
            className="pointer-events-auto relative z-20"
            onClick={(event) => event.stopPropagation()}
          >
            <FileProperties
              properties={item.properties}
              limit={2}
              onFilter={meta?.onFilterByProperty}
            />
          </div>
        </div>
      </div>
    </article>
  );

  if (upload) return card;
  return (
    <ContextMenu>
      <ContextMenuTrigger render={card} />
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => actions.onOpen(item)}>
            <Eye />
            Preview
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.onOpenProperties(item)}>
            <Tags />
            Properties
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.onDownload(item)}>
            <Download />
            Download
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.onShare(item)}>
            <Share2 />
            Share
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.onRename(item)}>
            <Pencil />
            Rename
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem variant="destructive" onClick={() => actions.onDelete(item)}>
            <Trash2 />
            Delete
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
