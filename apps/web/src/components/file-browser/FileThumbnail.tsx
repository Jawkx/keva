import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { keva } from "../../lib/keva";
import {
  loadOptionalThumbnail,
  thumbnailRefreshInterval,
  thumbnailQueryKey,
} from "../../lib/thumbnails";
import { fileKindIcon } from "./file-kind-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function FileThumbnail({
  itemId,
  name,
  contentType,
  className,
}: {
  readonly itemId: string;
  readonly name: string;
  readonly contentType: string;
  readonly className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const supportsThumbnail = contentType.startsWith("image/") || contentType.startsWith("video/");
  const thumbnail = useQuery({
    queryKey: thumbnailQueryKey(itemId),
    queryFn: () => loadOptionalThumbnail(() => keva.getThumbnailUrl(itemId)),
    enabled: supportsThumbnail,
    staleTime: (query) => thumbnailRefreshInterval(query.state.data?.expiresAt) || 0,
    refetchInterval: (query) => thumbnailRefreshInterval(query.state.data?.expiresAt),
  });
  const KindIcon = fileKindIcon(contentType);
  const url = thumbnail.data?.url;
  const showImage = Boolean(url && url !== failedUrl);

  return (
    <div
      className={cn(
        "relative flex aspect-4/3 items-center justify-center overflow-hidden bg-muted/55",
        className,
      )}
    >
      {supportsThumbnail && thumbnail.isPending ? (
        <Skeleton className="absolute inset-0 rounded-none" />
      ) : showImage ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailedUrl(url ?? null)}
        />
      ) : (
        <KindIcon aria-label={`${name} file type`} className="size-10 text-muted-foreground/65" />
      )}
    </div>
  );
}
