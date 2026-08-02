import { useMemo } from "react";
import { VideoPlayer, type VideoPlayerProps } from "@/components/video-player/player";

interface VideoPreviewProps {
  readonly contentType: string;
  readonly fileName: string;
  readonly itemId: string;
  readonly loadSource: () => Promise<{ readonly url: string }>;
  readonly posterUrl?: string;
}

export default function VideoPreview({
  contentType,
  fileName,
  itemId,
  loadSource,
  posterUrl,
}: VideoPreviewProps) {
  const loading = useMemo<NonNullable<VideoPlayerProps["loading"]>>(
    () => ({
      resolveSource: async ({ signal }) => {
        const source = await loadSource();
        if (signal.aborted) throw new DOMException("Video loading aborted", "AbortError");
        return { src: source.url, mimeType: contentType };
      },
    }),
    [contentType, loadSource],
  );

  return (
    <div className="flex min-h-0 w-full flex-1 items-center overflow-hidden rounded-md bg-black">
      <VideoPlayer
        className="max-h-full w-full"
        layout="fill"
        loading={loading}
        source={{ id: itemId, title: fileName }}
        mediaProps={{
          "aria-label": `Video preview of ${fileName}`,
          playsInline: true,
          preload: "metadata",
          ...(posterUrl ? { poster: posterUrl } : {}),
        }}
        theme="dark"
      />
    </div>
  );
}
