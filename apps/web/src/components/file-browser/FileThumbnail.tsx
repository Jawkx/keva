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
  const [failedImage, setFailedImage] = useState<{
    readonly url: string;
    readonly dataUpdatedAt: number;
  } | null>(null);
  const supportsThumbnail = contentType.startsWith("image/") || contentType.startsWith("video/");
  const hasDurableId = !itemId.startsWith("upload:");
  const thumbnail = useQuery({
    queryKey: thumbnailQueryKey(itemId),
    queryFn: () => loadOptionalThumbnail(() => keva.getThumbnailUrl(itemId)),
    enabled: supportsThumbnail && hasDurableId,
    staleTime: Infinity,
    refetchInterval: (query) => thumbnailRefreshInterval(query.state.data?.expiresAt),
  });
  const KindIcon = fileKindIcon(contentType);
  const url = thumbnail.data?.url;
  const showImage = Boolean(
    url && (failedImage?.url !== url || failedImage.dataUpdatedAt !== thumbnail.dataUpdatedAt),
  );

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
          onError={() => url && setFailedImage({ url, dataUpdatedAt: thumbnail.dataUpdatedAt })}
        />
      ) : (
        <KindIcon aria-label={`${name} file type`} className="size-10 text-muted-foreground/65" />
      )}
    </div>
  );
}
