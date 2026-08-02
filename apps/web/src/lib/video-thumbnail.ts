import { Cause, Data, Effect, Exit } from "effect";

const CANDIDATE_POSITIONS = [0.1, 0.2, 0.35, 0.5, 0.65] as const;
const ANALYSIS_MAX_WIDTH = 160;
const ANALYSIS_MAX_HEIGHT = 90;
const OUTPUT_MAX_WIDTH = 640;
const OUTPUT_MAX_HEIGHT = 640;
const SEEK_TIMEOUT_MS = 5_000;
const METADATA_TIMEOUT_MS = 10_000;

export interface FrameMetrics {
  readonly brightPixelRatio: number;
  readonly colorVariation: number;
  readonly darkPixelRatio: number;
  readonly edgeDensity: number;
  readonly luminanceMean: number;
  readonly luminanceStandardDeviation: number;
  readonly rejected: boolean;
  readonly score: number;
}

export interface VideoThumbnail {
  readonly blob: Blob;
  readonly contentType: "image/jpeg" | "image/webp";
}

interface FrameCandidate {
  readonly metrics: FrameMetrics;
  readonly time: number;
}

export class UnsupportedVideo extends Data.TaggedError("UnsupportedVideo")<{
  readonly message: string;
}> {}

export class VideoMetadataTimedOut extends Data.TaggedError("VideoMetadataTimedOut")<{}> {}
export class VideoDecodeFailed extends Data.TaggedError("VideoDecodeFailed")<{
  readonly cause?: unknown;
}> {}
export class VideoSeekTimedOut extends Data.TaggedError("VideoSeekTimedOut")<{
  readonly time: number;
}> {}
export class CanvasUnavailable extends Data.TaggedError("CanvasUnavailable")<{}> {}
export class FrameReadFailed extends Data.TaggedError("FrameReadFailed")<{
  readonly cause: unknown;
}> {}
export class ThumbnailEncodingFailed extends Data.TaggedError("ThumbnailEncodingFailed")<{
  readonly contentType: "image/jpeg" | "image/webp";
}> {}

export type ThumbnailError =
  | UnsupportedVideo
  | VideoMetadataTimedOut
  | VideoDecodeFailed
  | VideoSeekTimedOut
  | CanvasUnavailable
  | FrameReadFailed
  | ThumbnailEncodingFailed;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const dimensionsWithin = (
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { readonly width: number; readonly height: number } => {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

export const videoThumbnailCandidateTimes = (duration: number): number[] => {
  if (!Number.isFinite(duration) || duration <= 0) return [];

  const positions =
    duration <= 3
      ? [0.25, 0.5, 0.75]
      : duration <= 15
        ? [0.1, 0.25, 0.5, 0.75]
        : CANDIDATE_POSITIONS;
  const edge = Math.min(0.5, duration * 0.1);
  const maximum = Math.max(edge, duration - edge);

  return [...new Set(positions.map((position) => clamp(duration * position, edge, maximum)))];
};

export const measureThumbnailFrame = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): FrameMetrics => {
  const startX = Math.floor(width * 0.05);
  const endX = Math.ceil(width * 0.95);
  const startY = Math.floor(height * 0.1);
  const endY = Math.ceil(height * 0.9);
  const luminances = new Float32Array((endX - startX) * (endY - startY));
  let brightPixels = 0;
  let colorVariation = 0;
  let darkPixels = 0;
  let luminanceSum = 0;
  let luminanceSquaredSum = 0;
  let offset = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const pixelOffset = (y * width + x) * 4;
      const red = pixels[pixelOffset] ?? 0;
      const green = pixels[pixelOffset + 1] ?? 0;
      const blue = pixels[pixelOffset + 2] ?? 0;
      const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      luminances[offset] = luminance;
      luminanceSum += luminance;
      luminanceSquaredSum += luminance * luminance;
      colorVariation += Math.max(red, green, blue) - Math.min(red, green, blue);
      if (luminance < 20) darkPixels += 1;
      if (luminance > 240) brightPixels += 1;
      offset += 1;
    }
  }

  const pixelCount = Math.max(1, offset);
  const luminanceMean = luminanceSum / pixelCount;
  const variance = Math.max(0, luminanceSquaredSum / pixelCount - luminanceMean ** 2);
  const luminanceStandardDeviation = Math.sqrt(variance);
  let edgePixels = 0;
  let edgeComparisons = 0;
  const analysisWidth = endX - startX;
  const analysisHeight = endY - startY;

  for (let y = 0; y < analysisHeight; y += 1) {
    for (let x = 0; x < analysisWidth; x += 1) {
      const index = y * analysisWidth + x;
      const current = luminances[index] ?? 0;
      let edgeStrength = 0;
      if (x + 1 < analysisWidth) {
        edgeStrength += Math.abs(current - (luminances[index + 1] ?? current));
        edgeComparisons += 1;
      }
      if (y + 1 < analysisHeight) {
        edgeStrength += Math.abs(current - (luminances[index + analysisWidth] ?? current));
        edgeComparisons += 1;
      }
      if (edgeStrength > 32) edgePixels += 1;
    }
  }

  const darkPixelRatio = darkPixels / pixelCount;
  const brightPixelRatio = brightPixels / pixelCount;
  const edgeDensity = edgePixels / Math.max(1, edgeComparisons / 2);
  const normalizedColorVariation = colorVariation / pixelCount / 255;
  const rejected =
    darkPixelRatio > 0.92 ||
    brightPixelRatio > 0.96 ||
    luminanceStandardDeviation < 8 ||
    edgeDensity < 0.01;
  const contrastScore = Math.min(luminanceStandardDeviation / 64, 1);
  const edgeScore = Math.min(edgeDensity / 0.25, 1);
  const brightnessScore = Math.max(0, 1 - Math.abs(luminanceMean - 120) / 120);
  const score =
    contrastScore * 0.4 +
    edgeScore * 0.35 +
    normalizedColorVariation * 0.15 +
    brightnessScore * 0.1;

  return {
    brightPixelRatio,
    colorVariation: normalizedColorVariation,
    darkPixelRatio,
    edgeDensity,
    luminanceMean,
    luminanceStandardDeviation,
    rejected,
    score,
  };
};

export const bestThumbnailCandidate = <T extends FrameCandidate>(
  candidates: readonly T[],
): T | null => {
  const accepted = candidates.filter((candidate) => !candidate.metrics.rejected);
  const pool = accepted.length > 0 ? accepted : candidates;
  return pool.reduce<T | null>(
    (best, candidate) => (!best || candidate.metrics.score > best.metrics.score ? candidate : best),
    null,
  );
};

const waitForMediaEvent = (
  target: EventTarget,
  successEvent: string,
  trigger?: () => void,
): Effect.Effect<void, VideoDecodeFailed> =>
  Effect.async<void, VideoDecodeFailed>((resume) => {
    const cleanup = () => {
      target.removeEventListener(successEvent, onSuccess);
      target.removeEventListener("error", onError);
    };
    const onSuccess = () => {
      cleanup();
      resume(Effect.void);
    };
    const onError = (event: Event) => {
      cleanup();
      resume(Effect.fail(new VideoDecodeFailed({ cause: event })));
    };
    target.addEventListener(successEvent, onSuccess, { once: true });
    target.addEventListener("error", onError, { once: true });
    const triggered = Effect.runSyncExit(Effect.sync(() => trigger?.()));
    if (Exit.isFailure(triggered)) {
      cleanup();
      resume(Effect.fail(new VideoDecodeFailed({ cause: Cause.squash(triggered.cause) })));
    }
    return Effect.sync(cleanup);
  });

const seekVideoEffect = (
  video: HTMLVideoElement,
  time: number,
): Effect.Effect<void, VideoDecodeFailed | VideoSeekTimedOut> => {
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return Effect.void;

  return waitForMediaEvent(video, "seeked", () => {
    video.currentTime = time;
  }).pipe(
    Effect.timeoutFail({
      duration: SEEK_TIMEOUT_MS,
      onTimeout: () => new VideoSeekTimedOut({ time }),
    }),
  );
};

const canvasBlobEffect = (
  canvas: HTMLCanvasElement,
  contentType: "image/jpeg" | "image/webp",
  quality: number,
): Effect.Effect<Blob, ThumbnailEncodingFailed> =>
  Effect.async<Blob, ThumbnailEncodingFailed>((resume) => {
    canvas.toBlob(
      (blob) =>
        resume(
          blob ? Effect.succeed(blob) : Effect.fail(new ThumbnailEncodingFailed({ contentType })),
        ),
      contentType,
      quality,
    );
  });

interface VideoResource {
  readonly sourceUrl: string;
  readonly video: HTMLVideoElement;
}

const acquireVideo = (file: File): Effect.Effect<VideoResource> =>
  Effect.sync(() => {
    const video = document.createElement("video");
    const sourceUrl = URL.createObjectURL(file);
    video.muted = true;
    video.preload = "metadata";
    video.playsInline = true;
    return { sourceUrl, video };
  });

const releaseVideo = ({ sourceUrl, video }: VideoResource): Effect.Effect<void> =>
  Effect.sync(() => {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(sourceUrl);
  });

export const generateVideoThumbnailEffect = (
  file: File,
): Effect.Effect<VideoThumbnail, ThumbnailError> => {
  if (!file.type.startsWith("video/")) {
    return Effect.fail(new UnsupportedVideo({ message: "The file is not a video" }));
  }

  return Effect.acquireUseRelease(
    acquireVideo(file),
    ({ sourceUrl, video }) =>
      Effect.gen(function* () {
        yield* waitForMediaEvent(video, "loadedmetadata", () => {
          video.src = sourceUrl;
        }).pipe(
          Effect.timeoutFail({
            duration: METADATA_TIMEOUT_MS,
            onTimeout: () => new VideoMetadataTimedOut(),
          }),
        );

        if (!video.videoWidth || !video.videoHeight) {
          return yield* new UnsupportedVideo({ message: "The video has no decodable dimensions" });
        }
        const times = videoThumbnailCandidateTimes(video.duration);
        if (times.length === 0) {
          return yield* new UnsupportedVideo({ message: "The video has no usable duration" });
        }

        const canvas = document.createElement("canvas");
        const analysisSize = dimensionsWithin(
          video.videoWidth,
          video.videoHeight,
          ANALYSIS_MAX_WIDTH,
          ANALYSIS_MAX_HEIGHT,
        );
        canvas.width = analysisSize.width;
        canvas.height = analysisSize.height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return yield* new CanvasUnavailable();

        const candidates = yield* Effect.forEach(times, (time) =>
          Effect.gen(function* () {
            yield* seekVideoEffect(video, time);
            const frame = yield* Effect.try({
              try: () => {
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                return context.getImageData(0, 0, canvas.width, canvas.height);
              },
              catch: (cause) => new FrameReadFailed({ cause }),
            });
            return {
              time,
              metrics: measureThumbnailFrame(frame.data, frame.width, frame.height),
            } satisfies FrameCandidate;
          }),
        );

        const winner = bestThumbnailCandidate(candidates);
        if (!winner) {
          return yield* new UnsupportedVideo({ message: "The video has no usable frame" });
        }
        yield* seekVideoEffect(video, winner.time);

        const outputSize = dimensionsWithin(
          video.videoWidth,
          video.videoHeight,
          OUTPUT_MAX_WIDTH,
          OUTPUT_MAX_HEIGHT,
        );
        canvas.width = outputSize.width;
        canvas.height = outputSize.height;
        yield* Effect.try({
          try: () => context.drawImage(video, 0, 0, canvas.width, canvas.height),
          catch: (cause) => new FrameReadFailed({ cause }),
        });

        const webp = yield* canvasBlobEffect(canvas, "image/webp", 0.8).pipe(
          Effect.catchTag("ThumbnailEncodingFailed", () => Effect.succeed(null)),
        );
        if (webp?.type === "image/webp") return { blob: webp, contentType: "image/webp" };

        const jpeg = yield* canvasBlobEffect(canvas, "image/jpeg", 0.82);
        return { blob: jpeg, contentType: "image/jpeg" };
      }),
    releaseVideo,
  );
};

export const generateVideoThumbnail = (file: File): Promise<VideoThumbnail | null> =>
  Effect.runPromise(
    generateVideoThumbnailEffect(file).pipe(
      Effect.catchTag("UnsupportedVideo", () => Effect.succeed(null)),
    ),
  );
