import type { ComponentProps, ReactNode } from "react";
import type { PropertyValue } from "@keva/schema";
import { formatPropertyValue } from "../../lib/format";
import { fileKindIcon } from "./file-kind-icon";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function FileTableFrame({
  children,
  footer,
  className,
  ...props
}: ComponentProps<"div"> & { footer?: ReactNode }) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-xl border",
        className,
      )}
      {...props}
    >
      <ScrollArea className="h-auto min-h-0 flex-1">{children}</ScrollArea>
      {footer}
    </div>
  );
}

export function FileTable({
  className,
  containerClassName,
  ...props
}: ComponentProps<typeof Table>) {
  return (
    <Table
      containerClassName={cn("overflow-visible", containerClassName)}
      className={cn(
        "table-fixed sm:table-auto [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_tr]:border-0",
        className,
      )}
      {...props}
    />
  );
}

export function FileTableHeader({ className, ...props }: ComponentProps<typeof TableHeader>) {
  return (
    <TableHeader
      className={cn(
        "[&_tr]:border-0 [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted/50 [&_th]:shadow-[inset_0_-1px_0_var(--border)]",
        className,
      )}
      {...props}
    />
  );
}

export function FileTableFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 items-center border-t", className)} {...props} />;
}

export function FileTableItemCount({ count }: { count: number }) {
  return (
    <span className="shrink-0 pr-3 text-sm text-muted-foreground tabular-nums">
      {count} {count === 1 ? "item" : "items"}
    </span>
  );
}

const filenameParts = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot <= 0
    ? { stem: name, extension: "" }
    : { stem: name.slice(0, dot), extension: name.slice(dot) };
};

export function FileName({
  name,
  contentType,
  onOpen,
}: {
  name: string;
  contentType: string;
  onOpen?: () => void;
}) {
  const KindIcon = fileKindIcon(contentType);
  const filename = filenameParts(name);
  const label = (
    <>
      <span className="min-w-0 truncate">{filename.stem}</span>
      <span className="shrink-0">{filename.extension}</span>
    </>
  );

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <KindIcon className="size-4 shrink-0 text-muted-foreground" />
      {onOpen ? (
        <button
          type="button"
          className="flex w-full min-w-0 text-left text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={name}
          aria-label={name}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          {label}
        </button>
      ) : (
        <span className="flex w-full min-w-0" title={name}>
          {label}
        </span>
      )}
    </div>
  );
}

const propertyLabel = (key: string, value: PropertyValue) =>
  value === null ? key : `${key}:${formatPropertyValue(value)}`;

export function FileProperties({
  properties,
  limit = 3,
  onFilter,
}: {
  properties: Readonly<Record<string, PropertyValue>>;
  limit?: number;
  onFilter?: (key: string, value: PropertyValue) => void;
}) {
  const keys = Object.keys(properties).slice(0, limit);
  if (keys.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((key) => {
        const value = properties[key]!;
        const label = propertyLabel(key, value);
        return (
          <Badge
            key={key}
            variant="secondary"
            render={onFilter ? <button type="button" /> : undefined}
            title={onFilter ? `Filter by ${label}` : undefined}
            className={cn(
              onFilter &&
                "cursor-pointer transition-colors hover:bg-primary/15 hover:text-foreground",
            )}
            onClick={
              onFilter
                ? (event) => {
                    event.stopPropagation();
                    onFilter(key, value);
                  }
                : undefined
            }
          >
            {label}
          </Badge>
        );
      })}
    </div>
  );
}

export { TableBody as FileTableBody };
export { TableCell as FileTableCell };
export { TableHead as FileTableHead };
export { TableRow as FileTableRow };
