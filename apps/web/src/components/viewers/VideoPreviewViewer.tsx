import { useMemo } from "react";
import { VideoPlayer, type VideoPlayerProps } from "@/components/video-player/player";

interface VideoPreviewViewerProps {
  readonly fileName: string;
  readonly itemId: string;
  readonly loadSource: () => Promise<{ readonly url: string }>;
}

export function VideoPreviewViewer({ fileName, itemId, loadSource }: VideoPreviewViewerProps) {
  const loading = useMemo<NonNullable<VideoPlayerProps["loading"]>>(
    () => ({
      resolveSource: async ({ signal }) => {
        const source = await loadSource();
        if (signal.aborted) throw new DOMException("Video loading aborted", "AbortError");
        return source.url;
      },
    }),
    [loadSource],
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
        }}
        theme="dark"
      />
    </div>
  );
}
