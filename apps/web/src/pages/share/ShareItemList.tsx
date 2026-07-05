import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { IconDownload, IconSearch } from "@tabler/icons-react";
import { toast } from "sonner";
import type { SharedItem } from "@keva/sdk";
import { FileTypeIcon } from "../../components/FileTypeIcon";
import { errorMessage } from "../../lib/errors";
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
import { IconFiles } from "@tabler/icons-react";

const PAGE_SIZE = 50;

// Read view of a share: an infinite list of the items matching the grant. The
// server appends the grant conditions server-side, so the client sends
// `where: []` and never learns the conditions.
export function ShareItemList() {
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

  const download = useMutation({
    mutationFn: async (item: SharedItem) => {
      const { url } = await client.getDownloadUrl(item.id);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.name;
      // Keep the secret share URL out of the storage host's Referer.
      anchor.rel = "noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-sm">
        <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or type…"
          className="pl-8"
          value={search}
          onChange={onSearchChange}
        />
      </div>

      {itemsQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFiles />
            </EmptyMedia>
            <EmptyTitle>No files in this share</EmptyTitle>
            <EmptyDescription>
              {activeSearch.trim()
                ? "No files match your search."
                : "There is nothing here yet."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>Properties</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const keys = Object.keys(item.properties).slice(0, 2);
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-3">
                        <FileTypeIcon contentType={item.contentType} />
                        <span className="truncate font-medium">{item.name}</span>
                      </div>
                    </TableCell>
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
                    <TableCell>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Download ${item.name}`}
                        disabled={download.isPending}
                        onClick={() => download.mutate(item)}
                      >
                        <IconDownload />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {itemsQuery.hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={itemsQuery.isFetchingNextPage}
          onClick={() => void itemsQuery.fetchNextPage()}
        >
          {itemsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
