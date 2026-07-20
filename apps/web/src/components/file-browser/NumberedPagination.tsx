import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    if (typeof previous === "number" && value - previous > 1) result.push("ellipsis");
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
  if (totalPages <= 1) return null;

  return (
    <nav
      className="flex items-center justify-between gap-3 border-t px-3 py-3"
      aria-label="Pagination"
    >
      <p className="hidden text-xs text-muted-foreground sm:block">
        {totalItems.toLocaleString()} {totalItems === 1 ? "item" : "items"}
      </p>
      <div className="flex items-center gap-1 sm:ml-auto">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous page"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        {visiblePaginationItems(page, totalPages).map((value, index) =>
          value === "ellipsis" ? (
            <span
              key={`ellipsis-${index}`}
              className="flex size-8 items-center justify-center text-muted-foreground"
            >
              …
            </span>
          ) : (
            <Button
              key={value}
              variant={value === page ? "secondary" : "ghost"}
              size="icon-sm"
              disabled={disabled}
              aria-label={`Page ${value}`}
              aria-current={value === page ? "page" : undefined}
              className={cn("tabular-nums", value === page && "font-semibold")}
              onClick={() => onPageChange(value)}
            >
              {value}
            </Button>
          ),
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next page"
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
