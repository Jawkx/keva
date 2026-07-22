import { Skeleton } from "@/components/ui/skeleton";

export function FilePreviewSkeleton({
  variant = "content",
}: {
  readonly variant?: "content" | "image" | "viewer";
}) {
  if (variant === "image") {
    return <Skeleton className="aspect-video w-full max-w-full rounded-md" />;
  }

  if (variant === "viewer") {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-md bg-muted/30">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b bg-background px-3 py-2">
          <div className="flex items-center gap-2">
            <Skeleton className="size-7" />
            <Skeleton className="h-7 w-20" />
          </div>
          <div className="flex items-center gap-1">
            <Skeleton className="size-7" />
            <Skeleton className="h-7 w-20" />
            <Skeleton className="size-7" />
          </div>
        </div>
        <Skeleton className="min-h-0 w-full flex-1 rounded-none" />
      </div>
    );
  }

  return <Skeleton className="min-h-0 w-full flex-1" />;
}
