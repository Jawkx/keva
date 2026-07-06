import { type ReactNode, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { IconFiles, IconSearch } from "@tabler/icons-react";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { formatBytes, formatContentType, formatPropertyValue, formatRelative } from "../../lib/format";
import { useMountEffect } from "../../lib/useMountEffect";
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

const PAGE_SIZE = 50;

interface ShareItemListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Detail is open beside the list (wide screens): drop the secondary columns
  // so the narrower list stays readable.
  collapsed: boolean;
  // Right-aligned toolbar content on the search row — the Upload button for
  // read+write grants.
  action?: ReactNode;
  // Full-width content below the toolbar — upload progress for read+write grants.
  notice?: ReactNode;
}

// Left pane of a share's read view: a search toolbar above a scrollable list of
// the items matching the grant. Clicking a row opens it in the detail panel. The
// server appends the grant conditions server-side, so the client sends
// `where: []` and never learns them.
export function ShareItemList({
  selectedId,
  onSelect,
  collapsed,
  action,
  notice,
}: ShareItemListProps) {
  const { client } = useShare();
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const searchTimer = useRef<number | undefined>(undefined);
  useMountEffect(() => () => window.clearTimeout(searchTimer.current));

  const onSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setSearch(next);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => setActiveSearch(next), 250);
  };

  const itemsQuery = useInfiniteQuery({
    queryKey: ["share-items", activeSearch],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.query({
        where: [],
        ...(activeSearch.trim() ? { search: activeSearch.trim() } : {}),
        order: "created_at_desc",
        limit: PAGE_SIZE,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor,
  });

  const items = itemsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const loading = itemsQuery.isLoading;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="flex shrink-0 flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full min-w-0 sm:w-72">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or type…"
              className="pl-8"
              value={search}
              onChange={onSearchChange}
            />
          </div>
          {action && <div className="sm:ml-auto">{action}</div>}
        </div>
        {notice}
      </div>

      <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto">
        {!loading && items.length === 0 ? (
          <Empty className="py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconFiles />
              </EmptyMedia>
              <EmptyTitle>No files in this share</EmptyTitle>
              <EmptyDescription>
                {activeSearch.trim() ? "No files match your search." : "There is nothing here yet."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Table className="[&_td]:px-3 [&_th]:px-3">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  {!collapsed && (
                    <>
                      <TableHead>Type</TableHead>
                      <TableHead>Size</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead>Properties</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={`skeleton-${i}`}>
                        <TableCell colSpan={collapsed ? 1 : 5}>
                          <Skeleton className="h-5 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : items.map((item) => {
                      const keys = Object.keys(item.properties).slice(0, 2);
                      return (
                        <TableRow
                          key={item.id}
                          data-state={item.id === selectedId ? "selected" : undefined}
                          className="cursor-pointer"
                          onClick={() => onSelect(item.id)}
                        >
                          <TableCell>
                            <div className="flex min-w-0 items-center gap-3">
                              <FileTypeIcon contentType={item.contentType} />
                              <span className="truncate font-medium">{item.name}</span>
                            </div>
                          </TableCell>
                          {!collapsed && (
                            <>
                              <TableCell className="text-muted-foreground" title={item.contentType}>
                                {formatContentType(item.contentType)}
                              </TableCell>
                              <TableCell className="text-muted-foreground tabular-nums">
                                {formatBytes(item.size)}
                              </TableCell>
                              <TableCell className="text-muted-foreground">
                                {formatRelative(item.createdAt)}
                              </TableCell>
                              <TableCell>
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

            {itemsQuery.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  disabled={itemsQuery.isFetchingNextPage}
                  onClick={() => void itemsQuery.fetchNextPage()}
                >
                  {itemsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
