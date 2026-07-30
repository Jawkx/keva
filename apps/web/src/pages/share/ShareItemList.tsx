import { Files } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { formatBytes, formatRelative } from "../../lib/format";
import { buildFilterWhere, createFilterDraft, type KindId } from "../../lib/item-filters";
import { shareItemsQueryKey } from "../../lib/items-cache";
import { useShare } from "./share-context";
import { Button } from "@/components/ui/button";
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

      <FileTableFrame
        footer={
          <FileTableFooter>
            <NumberedPagination
              page={page}
              totalItems={totalItems}
              pageSize={PAGE_SIZE}
              disabled={itemsQuery.isFetching}
              onPageChange={setPage}
            />
            <FileTableItemCount count={totalItems} />
          </FileTableFooter>
        }
      >
        {!loading && items.length === 0 ? (
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
          <FileTable>
            <FileTableHeader>
              <FileTableRow>
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
                : items.map((item) => (
                    <FileTableRow
                      key={item.id}
                      data-state={item.id === selectedId ? "selected" : undefined}
                      className="group cursor-pointer"
                      onClick={() => onSelect(item.id)}
                    >
                      <FileTableCell className="min-w-0 overflow-hidden">
                        <FileName
                          name={item.name}
                          contentType={item.contentType}
                          onOpen={() => onSelect(item.id)}
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
        )}
      </FileTableFrame>
    </div>
  );
}
