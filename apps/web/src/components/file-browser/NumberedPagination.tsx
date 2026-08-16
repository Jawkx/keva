import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

export const visiblePaginationItems = (
  page: number,
  totalPages: number,
): Array<number | "ellipsis"> => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages]
    .filter((value) => value > 0 && value <= totalPages)
    .sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  for (const value of sorted) {
    const previous = result.at(-1);
    if (previous !== undefined && previous !== "ellipsis" && value - previous > 1)
      result.push("ellipsis");
    result.push(value);
  }
  return result;
};

export function NumberedPagination({
  page,
  totalItems,
  pageSize,
  onPageChange,
  disabled = false,
}: {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const previousDisabled = disabled || page <= 1;
  const nextDisabled = disabled || page >= totalPages;
  let ellipsisCount = 0;
  const paginationItems = visiblePaginationItems(page, totalPages).map((value) => ({
    value,
    key: value === "ellipsis" ? `ellipsis-${++ellipsisCount}` : `page-${value}`,
  }));

  return (
    <Pagination className="justify-start px-3 py-3">
      <PaginationContent>
        <PaginationItem key="previous">
          <PaginationPrevious
            href="#"
            aria-disabled={previousDisabled}
            tabIndex={previousDisabled ? -1 : undefined}
            className={cn(previousDisabled && "pointer-events-none opacity-50")}
            onClick={(event) => {
              event.preventDefault();
              if (!previousDisabled) onPageChange(page - 1);
            }}
          />
        </PaginationItem>
        {paginationItems.map(({ value, key }) =>
          value === "ellipsis" ? (
            <PaginationItem key={key}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={key}>
              <PaginationLink
                href="#"
                isActive={value === page}
                aria-label={`Page ${value}`}
                aria-disabled={disabled}
                tabIndex={disabled ? -1 : undefined}
                className={cn("tabular-nums", disabled && "pointer-events-none opacity-50")}
                onClick={(event) => {
                  event.preventDefault();
                  if (!disabled) onPageChange(value);
                }}
              >
                {value}
              </PaginationLink>
            </PaginationItem>
          ),
        )}
        <PaginationItem key="next">
          <PaginationNext
            href="#"
            aria-disabled={nextDisabled}
            tabIndex={nextDisabled ? -1 : undefined}
            className={cn(nextDisabled && "pointer-events-none opacity-50")}
            onClick={(event) => {
              event.preventDefault();
              if (!nextDisabled) onPageChange(page + 1);
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
