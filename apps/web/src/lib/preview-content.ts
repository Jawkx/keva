import { Effect } from "effect";

export type PreviewContent = { kind: "blob"; blob: Blob } | { kind: "text"; text: string };

export class PreviewTimeoutError extends Error {
  readonly _tag = "PreviewTimeoutError";
}

export const loadPreviewContent = <E>(
  bytes: Effect.Effect<Uint8Array, E>,
  contentType: string,
  binary: boolean,
): Effect.Effect<PreviewContent, E | PreviewTimeoutError> =>
  bytes.pipe(
    Effect.timeoutOrElse({
      duration: 2 * 60_000,
      orElse: () => Effect.fail(new PreviewTimeoutError("Preview download timed out")),
    }),
    Effect.map((content) =>
      binary
        ? ({
            kind: "blob",
            blob: new Blob([new Uint8Array(content)], { type: contentType }),
          } satisfies PreviewContent)
        : ({
            kind: "text",
            text: new TextDecoder().decode(content).slice(0, 5000),
          } satisfies PreviewContent),
    ),
  );
