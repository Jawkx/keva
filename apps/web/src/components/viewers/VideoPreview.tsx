import { useMemo, useState } from "react";
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
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
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

  let mediaProps: NonNullable<VideoPlayerProps["mediaProps"]> = {
    "aria-label": `Video preview of ${fileName}`,
    onLoadedMetadata: (event) => {
      const { videoHeight, videoWidth } = event.currentTarget;
      if (videoHeight > 0 && videoWidth > 0) setAspectRatio(videoWidth / videoHeight);
    },
    playsInline: true,
    preload: "metadata",
  };
  if (posterUrl) mediaProps = { ...mediaProps, poster: posterUrl };

  return (
    <div className="@container flex min-h-0 w-full flex-1 items-start justify-center overflow-hidden">
      <VideoPlayer
        className="overflow-hidden rounded-md bg-black"
        layout="fill"
        loading={loading}
        source={{ id: itemId, title: fileName }}
        mediaProps={mediaProps}
        style={{
          aspectRatio,
          height: `min(100cqh, calc(100cqw / ${aspectRatio}))`,
          marginBottom: "auto",
          marginTop: 0,
          width: `min(100cqw, calc(100cqh * ${aspectRatio}))`,
        }}
        theme="dark"
      />
    </div>
  );
}
