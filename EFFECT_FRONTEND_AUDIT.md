# Frontend Effect Integration Audit

This audit covers `apps/web/src`, focusing on explicit `try` blocks, Promise `.catch()` calls, `unknown` errors, and existing Effect usage.

## Best Effect targets

### 1. Upload workflow — best immediate improvement

**Files**

- `apps/web/src/lib/upload-workflow.ts`
- `apps/web/src/lib/use-upload-queue.ts`
- `apps/web/src/pages/share/use-share-upload.ts`

This area already uses Effect, but its error channel becomes untyped at the most important boundary:

```ts
export interface UploadFailure<S> {
  readonly cause: unknown;
  readonly session: S | undefined;
  readonly phase: UploadPhase;
}
```

It then recovers typing through string-based `_tag` inspection:

```ts
const isRetryable = (error: unknown): boolean => ...
const isQuotaError = (error: unknown): boolean => ...
```

Other failures are silently erased:

- Thumbnail generation uses `.catch(() => null)`.
- Thumbnail upload uses `.catch(() => undefined)`.
- Upload runners use `.catch(() => undefined)`.
- Share identity setup happens outside the Effect workflow.

**Recommended model**

```ts
type UploadStage = "initiate" | "put" | "confirm";

class UploadTimedOut extends Data.TaggedError("UploadTimedOut")<{
  readonly stage: UploadStage;
}> {}

class UploadFailed<E> extends Data.TaggedError("UploadFailed")<{
  readonly cause: E | UploadTimedOut;
  readonly session: ItemUploadSession | undefined;
  readonly stage: UploadStage;
}> {}
```

Change `UploadFailure<S>` to `UploadFailure<S, E>` so the workflow retains `KevaClientError | UploadTimedOut`. Then use `Effect.catchTags` rather than manually examining `_tag`.

This is a small, low-risk migration because the SDK already exposes:

- `startUploadEffect`
- `putUploadEffect`
- `completeUploadEffect`

### 2. Media loading and playback — highest error complexity

**Files**

- `apps/web/src/hooks/limeplay/use-asset.ts`
- `apps/web/src/hooks/limeplay/use-player.ts`
- `apps/web/src/hooks/limeplay/use-playback.ts`
- `apps/web/src/hooks/limeplay/use-picture-in-picture.ts`

The Limeplay area contains **9 explicit try blocks**, plus five Promise catches. More importantly, it has numerous distinct failure modes represented as `unknown`:

- Shaka load failure
- Missing playback source
- Interrupted or stale load
- User or lifecycle cancellation
- Browser `AbortError`
- Preload failure
- Resolver failure
- Custom loader failure
- Autoplay rejection
- Player attachment failure
- Player destruction failure
- Recovery callback failure
- Picture-in-picture rejection

Examples of lost typing include:

- `previousError?: unknown` in `use-asset.ts`
- `previousError: unknown` in asset state
- `error: unknown` in `PlaybackStore`
- `setError(error: unknown)`
- Recovery functions accepting `unknown`
- Load functions returning `Promise<boolean>`, where `false` can mean several unrelated outcomes

This area would benefit from a typed error algebra:

```ts
type MediaLoadError =
  | MediaLoadInterrupted
  | MediaLoadAborted
  | MediaSourceMissing
  | MediaSourceResolutionFailed
  | ShakaLoadFailed
  | AutoplayRejected;

type MediaPreloadError =
  | MediaPreloadAborted
  | MediaSourceMissing
  | MediaSourceResolutionFailed
  | ShakaPreloadFailed;
```

A load could become:

```ts
Effect.Effect<
  LoadedAsset,
  MediaLoadError,
  MediaPlayerService | AssetResolverService
>
```

Interruption and cancellation can then remain distinct from actual failure:

```ts
Effect.catchTags({
  MediaLoadInterrupted: () => Effect.succeed({ outcome: "superseded" }),
  MediaLoadAborted: () => Effect.succeed({ outcome: "cancelled" }),
  ShakaLoadFailed: handleRecovery,
})
```

Do not put large Effect programs directly inside React components. Extract framework-neutral workflows such as:

- `loadAssetEffect`
- `preloadAssetEffect`
- `attachPlayerEffect`
- `enterPictureInPictureEffect`

The hooks should run these programs and translate their typed exits into Zustand or UI state.

This is high payoff but also the highest-risk migration, so it should follow a smaller pilot.

### 3. Video thumbnail generation — best self-contained pilot

**Files**

- `apps/web/src/lib/video-thumbnail.ts`
- `apps/web/src/lib/use-upload-queue.ts`

`generateVideoThumbnail()` only has one `try/finally`, but many potential failures are hidden inside it:

- Metadata timeout
- Video decoding failure
- Seek timeout
- Canvas context unavailable
- Canvas security or pixel-read failure
- WebP encoding unsupported
- JPEG encoding failure
- Object URL cleanup
- Cancellation

The caller currently collapses every error to `null`:

```ts
generateVideoThumbnail(upload.file).catch(() => null);
```

Effect is well suited here because this is a resource-oriented pipeline. Use:

- `Effect.acquireRelease` for the object URL and video element
- `Effect.async` for media events
- `Effect.timeoutFail` for metadata and seek operations
- `Effect.try` for canvas operations
- A typed fallback from WebP to JPEG

Possible error channel:

```ts
type ThumbnailError =
  | UnsupportedVideo
  | VideoMetadataTimedOut
  | VideoDecodeFailed
  | VideoSeekTimedOut
  | CanvasUnavailable
  | FrameReadFailed
  | ThumbnailEncodingFailed;
```

The caller can then intentionally decide which failures are ignorable:

```ts
generateVideoThumbnailEffect(file).pipe(
  Effect.catchTags({
    UnsupportedVideo: () => Effect.succeed(Option.none()),
    ThumbnailEncodingFailed: logAndIgnore,
  }),
)
```

This is the recommended first end-to-end Effect pilot.

### 4. Authentication and account actions — most repeated boilerplate

**Files**

- `apps/web/src/pages/LoginPage.tsx`
- `apps/web/src/pages/SignupPage.tsx`
- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/pages/share/use-share-upload.ts`
- `apps/web/src/components/AppShell.tsx`

There are at least seven repeated account operations that must handle both:

1. Better Auth returning `{ error }`
2. The underlying Promise throwing

Each currently repeats this shape:

```ts
try {
  const result = await authClient.updateUser(...);
  if (result.error) {
    // Handle returned error
  }
} catch (error) {
  // Handle thrown error
}
```

Create an adapter around Better Auth:

```ts
type AuthOperationError =
  | AuthRejected
  | AuthTransportError
  | AuthProtocolError;

const updateUserEffect = (...) =>
  Effect.tryPromise({
    try: () => authClient.updateUser(...),
    catch: cause => new AuthTransportError({ cause }),
  }).pipe(
    Effect.flatMap(result =>
      result.error
        ? Effect.fail(new AuthRejected({
            code: result.error.code,
            message: result.error.message,
          }))
        : Effect.succeed(result.data)
    )
  );
```

Login, Signup, Settings, and anonymous share identity can then share one typed adapter rather than duplicating normalization.

This is medium payoff and relatively easy, but it is less operationally complex than uploads or media.

### 5. General SDK-backed mutations

**Files**

- `apps/web/src/pages/FilesPage.tsx`
- `apps/web/src/components/FileDetail.tsx`
- `apps/web/src/components/PropertiesEditor.tsx`
- `apps/web/src/components/GlobalSearch.tsx`

The SDK internally models HTTP failures as:

```ts
KevaError | KevaProtocolError | KevaTransportError
```

Many public SDK methods expose only Promise APIs. Once they enter TanStack Query or component event handlers, their rejection type becomes `unknown`, eventually reaching:

```ts
errorMessage(error: unknown)
```

The SDK already has Effect variants for some operations, but not consistently for all mutations. A useful longer-term direction would be:

- Add `patchEffect`, `restoreEffect`, `getDownloadUrlEffect`, and similar methods.
- Keep Promise methods as compatibility wrappers.
- Use Effect internally for mutation workflows requiring retries, timeouts, or multi-step compensation.
- Continue using TanStack Query as the server-state and UI boundary.

TanStack Query should not be replaced with Effect; they solve different problems.

## Areas that are not strong migration candidates

These catches are simple parsing or browser capability boundaries and are already reasonably modeled:

- `apps/web/src/lib/avatar.ts`
- `apps/web/src/lib/item-filters.ts`
- `apps/web/src/components/GlobalSearch.tsx` local-storage parsing
- `apps/web/src/components/file-browser/FileBrowserFrame.tsx`
- `apps/web/src/components/ui/pdf-viewer.tsx` URI decoding
- `apps/web/src/lib/properties.ts`

For these, `Schema.decodeUnknownOption`, `Either`, or a small discriminated union is probably lighter than introducing Effect programs.

## Suggested migration order

1. **Finish typing `upload-workflow.ts`**
   - Preserve generic `E`.
   - Replace `cause: unknown`.
   - Replace string-based tag checks.
   - Bring share identity into the Effect workflow.

2. **Convert video thumbnail generation**
   - Use it as a self-contained pilot.
   - Introduce typed timeouts and decoding failures.
   - Model resource lifetime and cancellation.

3. **Create a Better Auth Effect adapter**
   - Remove repeated Login, Signup, and Settings try/catch blocks.
   - Normalize returned errors and thrown failures.

4. **Extract the Limeplay loading workflow**
   - Start with `loadAssetEffect`.
   - Separate cancellation, stale generation, interruption, and real failure.
   - Migrate preload and player lifecycle afterward.

5. **Expand SDK Effect methods as needed**
   - Prioritize multi-step mutations and operations needing retry or timeout policies.

## Conclusion

The strongest immediate target is the **upload workflow**, while the strongest architectural target is **Limeplay media loading**. The thumbnail pipeline is the safest place to establish frontend Effect conventions before tackling the media subsystem.
