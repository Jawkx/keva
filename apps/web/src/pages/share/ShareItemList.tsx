import { Files } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NumberedPagination } from "../../components/file-browser/NumberedPagination";
import {
  formatBytes,
  formatContentType,
  formatPropertyValue,
  formatRelative,
} from "../../lib/format";
import { buildFilterWhere, createFilterDraft, type KindId } from "../../lib/item-filters";
import { shareItemsQueryKey } from "../../lib/items-cache";
import { useShare } from "./share-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const QUICK_KINDS: ReadonlyArray<{ id: KindId | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "document", label: "Document" },
  { id: "image", label: "Photo" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
];

interface ShareItemListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  action?: ReactNode;
  notice?: ReactNode;
}

export function ShareItemList({
  selectedId,
  onSelect,
  collapsed,
  action,
  notice,
}: ShareItemListProps) {
  const { client } = useShare();
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<KindId | "all">("all");
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

  const items = itemsQuery.data?.items ?? [];
  const totalItems = itemsQuery.data?.totalCount ?? items.length;
  const loading = itemsQuery.isLoading;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3">
      <div className="flex w-full shrink-0 flex-col gap-3 px-1">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex w-fit max-w-full flex-wrap items-center rounded-lg border border-border bg-muted/70 p-1"
            aria-label="File type"
          >
            {QUICK_KINDS.map((option) => (
              <Button
                key={option.id}
                variant="ghost"
                size="sm"
                aria-pressed={kind === option.id}
                className={cn(
                  "rounded-md px-4 text-muted-foreground shadow-none hover:text-foreground",
                  kind === option.id &&
                    "bg-background text-foreground hover:bg-background hover:text-foreground",
                )}
                onClick={() => {
                  setKind(option.id);
                  setPage(1);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
          {action && <div className="ml-auto">{action}</div>}
        </div>
        {notice}
      </div>

      <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-xl border">
        {!loading && items.length === 0 ? (
          <Empty className="py-16">
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
          <>
            <Table className="[&_td]:px-3 [&_td]:py-3.5 [&_th]:px-3 [&_tr]:border-0">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Size</TableHead>
                  {!collapsed && (
                    <>
                      <TableHead className="hidden sm:table-cell">Type</TableHead>
                      <TableHead className="hidden md:table-cell">Updated</TableHead>
                      <TableHead className="hidden lg:table-cell">Properties</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={`skeleton-${i}`}>
                        <TableCell>
                          <Skeleton className="h-5 w-full max-w-52" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-5 w-16" />
                        </TableCell>
                        {!collapsed && (
                          <>
                            <TableCell className="hidden sm:table-cell">
                              <Skeleton className="h-5 w-20" />
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              <Skeleton className="h-5 w-20" />
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">
                              <Skeleton className="h-5 w-28 rounded-full" />
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))
                  : items.map((item) => {
                      const keys = Object.keys(item.properties).slice(0, 2);
                      return (
                        <TableRow
                          key={item.id}
                          data-state={item.id === selectedId ? "selected" : undefined}
                          className="group cursor-pointer"
                          onClick={() => onSelect(item.id)}
                        >
                          <TableCell>
                            <button
                              type="button"
                              className="block max-w-full truncate text-left font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              onClick={(event) => {
                                event.stopPropagation();
                                onSelect(item.id);
                              }}
                            >
                              {item.name}
                            </button>
                          </TableCell>
                          <TableCell className="text-muted-foreground tabular-nums">
                            {formatBytes(item.size)}
                          </TableCell>
                          {!collapsed && (
                            <>
                              <TableCell
                                className="hidden text-muted-foreground sm:table-cell"
                                title={item.contentType}
                              >
                                {formatContentType(item.contentType)}
                              </TableCell>
                              <TableCell className="hidden text-muted-foreground md:table-cell">
                                {formatRelative(item.updatedAt)}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell">
                                {keys.length === 0 ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : (
                                  <div className="flex flex-wrap gap-1">
                                    {keys.map((key) => (
                                      <Badge key={key} variant="secondary">
                                        {key}={formatPropertyValue(item.properties[key]!)}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </TableCell>
                            </>
                          )}
                        </TableRow>
                      );
                    })}
              </TableBody>
            </Table>

            <NumberedPagination
              page={page}
              totalItems={totalItems}
              pageSize={PAGE_SIZE}
              disabled={itemsQuery.isFetching}
              onPageChange={setPage}
            />
          </>
        )}
      </div>
    </div>
  );
}
