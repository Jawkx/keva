# Thumbnail View and Media Processing Implementation Plan

This document is the handoff for implementing thumbnail grid view in Keva. It records the decisions, repository findings, architecture, rollout plan, and deferred work agreed in the planning session.

## Decisions already made

Do not reopen these unless implementation uncovers a blocking constraint.

- Cloudflare Workers Paid has been activated.
- Use Cloudflare Containers for media processing.
- Use the same code and container image for staging and production, but separate environment bindings, instances, credentials, queues, and logs.
- Start with the Cloudflare `standard-1` instance type: 0.5 vCPU, 4 GiB RAM, and 8 GB disk.
- Configure `sleepAfter` to approximately 15 seconds so provisioned memory is not billed while idle.
- Process one media job concurrently per container initially.
- Use Postgres as the durable source of truth for jobs. A Container request is a wake-up signal, not the queue itself.
- First release supports image thumbnails only.
- First-release image allowlist should be conservative: JPEG, PNG, WebP, and AVIF. GIF first-frame support is optional. Defer SVG because it needs stricter untrusted-document handling.
- Backfill all existing eligible images. The product is pre-launch and has fewer than roughly 200 objects, so a bounded full backfill is safe.
- The list/grid choice is a personal global browser preference, not part of a saved view definition.
- First-release grid UI appears in All Files and saved views.
- Trash and shared-view grid UI are deferred.
- PDF and video worker processing are deferred until the complete image pipeline is proven.
- Keep existing browser-generated video thumbnails during rollout; remove or redesign that path only after generated thumbnails are stable.

## Relevant repository context

Keva is a pnpm/Turborepo monorepo running Node 22+ and pnpm 11+.

- `apps/server`: Hono API deployed as a Cloudflare Worker/Workerd service.
- `apps/web`: React web UI.
- `packages/core`: metadata engine, Postgres schema/store, and S3-compatible blob storage.
- `packages/schema`: wire and domain schemas.
- `packages/sdk`: `KevaClient`.

Required repository checks before finishing code changes:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

React components must not call `useEffect` directly. Use derived state, event handlers, React Query, `useSyncExternalStore`, key-based resets, callback refs, or the existing `useMountEffect` abstraction.

### Current file-browser implementation

- Main page: `apps/web/src/pages/FilesPage.tsx`
- Table components: `apps/web/src/components/file-browser/FileTable.tsx`
- Responsive list/detail frame: `apps/web/src/components/file-browser/FileBrowserFrame.tsx`
- Table columns: `apps/web/src/pages/files/file-columns.tsx`
- Detail preview: `apps/web/src/components/FileDetail.tsx`
- File type predicates: `apps/web/src/lib/preview.ts`
- Page size is 50 in `apps/web/src/pages/files/utils.tsx`.

`FileTableFrame` owns the bordered collection frame, scroll area, and footer. The selected `ScrollAreaViewport` is only a container; thumbnail view should be selected in `FilesPage.tsx` and rendered as a sibling to the table, not implemented inside the scroll-area primitive.

The detail panel already supports images, PDFs, video, text, CSV, Markdown, and HTML. Image/PDF detail previews download the original object. That behavior must not be reused for a 50-card grid because it would download large originals for small thumbnails.

Trash and shared views have separate table implementations:

- `apps/web/src/pages/TrashPage.tsx`
- `apps/web/src/pages/share/ShareItemList.tsx`

They are explicitly outside the first UI release.

### Current thumbnail implementation

Keva already has a video-only thumbnail path:

- Browser generation: `apps/web/src/lib/video-thumbnail.ts`
- Upload integration: `apps/web/src/lib/use-upload-queue.ts`
- Optional URL helper: `apps/web/src/lib/thumbnails.ts`
- SDK methods: `packages/sdk/src/index.ts`
- API routes: `apps/server/src/app.ts`
- Core implementation: `packages/core/src/engine.ts`
- Thumbnail upload schema: `packages/schema/src/upload.ts`

Current behavior:

- The web upload queue generates representative video frames in the uploader's browser.
- Generation is best effort and happens only for web uploads.
- The API permits thumbnail operations only for `video/*` items through `videoOrNotFound()`.
- Thumbnails are stored at `thumbnails/{tenantId}/{itemId}`.
- Download authorization already respects normal owner/share visibility.
- Trash thumbnail download exists.
- Permanent purge deletes the legacy thumbnail key.
- Thumbnail uploads are limited to WebP/JPEG/PNG/AVIF and 1 MiB.
- Realtime currently has `thumbnail_deleted`, but no `thumbnail_ready` event.

The canonical worker must cover API, SDK, MCP, and share uploads rather than depending on the uploader's browser.

### Current deployment

Cloudflare configuration is in `apps/server/wrangler.toml`.

- Staging Worker: `keva-staging`
- Production Worker: `keva-production`
- Both use environment-specific Hyperdrive bindings.
- Both currently use R2 through the S3-compatible endpoint and separate buckets:
  - `keva-staging`
  - `keva-production`
- The server has a `RealtimeHub` Durable Object.
- Current cron is daily lifecycle cleanup: `0 0 * * *`.
- Staging deploys from `.github/workflows/deploy-staging.yml`.
- Production deploys from `.github/workflows/deploy-production.yml`.
- `wrangler deploy` can build and push a Dockerfile-backed Container image on the GitHub Ubuntu runner.

The Workers Paid $5 account allowance is shared across Containers in the same Cloudflare account. Separate staging and production instances do not require separate subscriptions, but they must remain separate security boundaries.

## Target architecture

```text
Upload confirmation
  |
  |-- item transitions to ready
  `-- thumbnail job is inserted in the same Postgres transaction
          |
          v
Cloudflare Worker checks for runnable jobs
          |
          v
Environment-specific MediaContainer wakes
          |
          v
Node media worker claims Postgres jobs
  |-- fetches original object from R2
  |-- verifies the actual media type
  |-- generates a bounded WebP with Sharp
  |-- uploads a versioned derivative to R2
  `-- marks the job ready
          |
          v
Cloudflare controller publishes thumbnail_ready
          |
          v
React Query invalidates the card thumbnail
```

The Container should be a stateless processor. Postgres owns pending, processing, retry, ready, and failed state. Container crashes must not lose work.

## Phase 1: Cloudflare Container connectivity spike

Do this before implementing queue or image logic. The main unknown is Container deployment/connectivity, not image resizing.

### Add a Node-only app

Create:

```text
apps/media-worker/
  src/server.ts
  Dockerfile
  package.json
  tsconfig.json
  tsconfig.build.json
```

Initial endpoints:

- `GET /health`
- `POST /drain`

For the spike, `/drain` should only prove:

- It knows whether it is staging or production.
- It can run `select 1` against the correct database.
- It can inspect a harmless object or bucket through the correct R2/S3 configuration.
- It returns a bounded JSON diagnostic response.

### Add the Container controller

Add `@cloudflare/containers` to `apps/server/package.json`.

Create `apps/server/src/media-container.ts` and export its class from `apps/server/src/worker.ts`:

```ts
export class MediaContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "15s";
}
```

Use dynamic start options to pass environment-specific configuration. Never place production credentials in staging configuration.

Expected Container environment variables:

```text
KEVA_ENVIRONMENT
DATABASE_URL
S3_ENDPOINT
S3_REGION
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_BUCKET
S3_FORCE_PATH_STYLE
THUMBNAIL_RECIPE_VERSION=1
THUMBNAIL_BATCH_SIZE=5
```

First try `env.HYPERDRIVE.connectionString` as the Container `DATABASE_URL`. Verify this from a deployed staging Container. If it is not usable from the Node Container, provision a dedicated direct database connection string secret for each environment.

Cloudflare supports passing Worker secrets into Container environment variables. Do not bake any secret into the image or Docker build arguments.

### Wrangler additions

Add a Dockerfile-backed Container, a Durable Object binding, and a new SQLite-class migration. Conceptually:

```toml
[[containers]]
class_name = "MediaContainer"
image = "../media-worker/Dockerfile"
instance_type = "standard-1"
max_instances = 2

[[durable_objects.bindings]]
name = "MEDIA"
class_name = "MediaContainer"

[[migrations]]
tag = "v2_media_container"
new_sqlite_classes = ["MediaContainer"]
```

Wrangler environment bindings are not uniformly inherited. Explicitly inspect/dry-run both environments and repeat bindings under environment sections where required:

```bash
pnpm exec wrangler deploy --config apps/server/wrangler.toml --env staging --dry-run
pnpm exec wrangler deploy --config apps/server/wrangler.toml --env production --dry-run
```

Use one stable instance identity per environment, such as:

- `keva-media-staging`
- `keva-media-production`

The same class/image is deployed to both environments, but each environment sees only its own Hyperdrive, R2 bucket, and secrets.

### Spike acceptance criteria

- Staging Container deploys from the monorepo.
- `GET /health` wakes it successfully.
- The Container can query the staging database.
- The Container can access only the staging bucket.
- It automatically sleeps after about 15 seconds idle.
- Cloudflare dashboard confirms awake time stops accumulating.
- Production configuration dry-run does not expose staging values, and vice versa.

Do not proceed to media processing until these are proven.

## Phase 2: Durable Postgres thumbnail jobs

### Schema

Add `thumbnailJobs` to `packages/core/src/postgres/schema.ts` and generate a Drizzle migration.

Recommended fields:

```text
tenant_id
item_id
recipe_version
state                 pending | processing | ready | failed
attempts
next_attempt_at
lease_token           nullable
lease_expires_at      nullable
source_etag           nullable
output_key            nullable
output_content_type   nullable
output_size           nullable
output_width          nullable
output_height         nullable
error_code            nullable
created_at
updated_at
completed_at          nullable
```

Use `(tenant_id, item_id)` as the primary key for the current thumbnail and add a composite foreign key to `items(tenant_id, id)` with `ON DELETE CASCADE`.

Indexes:

```text
(state, next_attempt_at)
(state, lease_expires_at)
```

Store only a bounded internal error code in the row. Do not store unlimited FFmpeg/decoder output.

### Eligibility

Add a shared core predicate such as `supportsGeneratedThumbnail(contentType)`.

First release should return true only for the selected image types. Keep the function shaped for future PDF/video support.

The declared content type only decides whether to enqueue. The worker must sniff and validate actual bytes before decoding.

### Atomic enqueue

When upload confirmation transitions an item from `confirming` to `ready`, insert/reset its thumbnail job in the same Postgres transaction as the item transition and upload event.

This avoids the failure case where an upload becomes ready but a process crashes before separately creating its job.

Conceptual upsert:

```sql
insert into thumbnail_jobs (...)
values (...)
on conflict (tenant_id, item_id)
do update set
  recipe_version = excluded.recipe_version,
  state = 'pending',
  attempts = 0,
  next_attempt_at = now(),
  source_etag = excluded.source_etag;
```

Only enqueue eligible content types.

### Job-store API

Implement and export a small Postgres job store, preferably from `@keva/core/postgres`:

```text
hasRunnableJobs
claimNext
markReady
markRetry
markFailed
releaseExpiredLeases
enqueueMissing
```

Claim with `FOR UPDATE SKIP LOCKED` and set a random lease token plus lease expiry. Every finalize/retry/fail operation must compare the lease token so an expired worker cannot overwrite the result of a newer worker.

Recommended initial retry schedule:

```text
1 minute
5 minutes
30 minutes
2 hours
then failed
```

Retry storage/database/timeouts. Permanently fail corrupt, unsupported, or limit-violating sources.

## Phase 3: Image processor

### Dependencies

The media worker will likely need:

```text
sharp
file-type
postgres
effect
@keva/core
```

Reuse Keva's existing S3-compatible presigning where practical:

- Claim returns the item's known storage key.
- Use a presigned GET to fetch the source.
- Render to a local temporary file.
- Determine output byte size.
- Use a presigned PUT to upload the derivative.

This avoids introducing a second S3 implementation into the first release.

### Processing algorithm

For each claimed job:

1. Re-read the item and verify it still exists.
2. Verify item status is still `ready`.
3. Verify source ETag matches the job.
4. Download the source into a unique temporary directory with a byte limit.
5. Sniff the actual file type.
6. Decode with Sharp using a maximum input pixel limit.
7. Apply EXIF orientation using Sharp rotation.
8. Resize within `640x640` without enlargement.
9. Encode WebP at approximately quality 80.
10. Verify dimensions, content type, and maximum output size.
11. Recheck item eligibility and lease ownership.
12. Upload to a versioned R2 key.
13. Mark the job ready using the lease token.
14. Delete all temporary files in `finally`.

Suggested Sharp shape:

```ts
sharp(inputPath, { limitInputPixels: 100_000_000 })
  .rotate()
  .resize({
    width: 640,
    height: 640,
    fit: "inside",
    withoutEnlargement: true,
  })
  .webp({ quality: 80 });
```

Initial limits:

```text
Maximum decoded pixels: 100 million
Maximum output dimensions: 640x640
Maximum output bytes: 1 MiB
Image processing timeout: 30 seconds
Concurrency: 1 per Container
Batch size: 5 jobs per drain request
```

All limits should be constants/configuration, not scattered literals.

### Object keys

Generated thumbnails must be versioned:

```text
thumbnails/{tenantId}/{itemId}/v1.webp
```

The existing browser video thumbnail remains at:

```text
thumbnails/{tenantId}/{itemId}
```

Keeping generated and legacy keys separate avoids races during rollout.

### Purge race

A purge can race with processing:

1. Worker validates item.
2. User purges item.
3. Purge removes metadata/thumbnail.
4. Worker uploads after purge.

Mitigation:

- Recheck item/lease immediately before upload and finalization.
- If upload succeeds but DB finalization fails, delete the uploaded object as compensation.
- Keep an eventual orphan sweep as a backstop.
- Permanent purge must delete both the current generated output key and legacy thumbnail key.

## Phase 4: Wake-up and recovery

A Container request is only a wake-up. The Postgres row is the durable job.

### Immediate wake-up

Successful confirmations happen through routes including:

```text
POST /api/items/:id/confirm
POST /api/shared-views/:grantId/items/:id/confirm
```

After the confirmation transaction commits, schedule a best-effort wake-up. Before starting the Container, call `hasRunnableJobs()`. Do not wake it for unsupported uploads or when another processor already drained the queue.

Send an internal `POST /drain` request. The request must not contain arbitrary URLs or shell commands. The Container claims all work from Postgres.

A drain request should stop when any condition is met:

```text
No runnable jobs remain
Five jobs were attempted
An eight-minute drain deadline was reached
The Container is shutting down
```

Return a bounded summary, including ready item IDs, so the Cloudflare controller can publish realtime changes.

### Recovery cron

Add a five-minute recovery cron while retaining daily lifecycle cleanup:

```toml
[triggers]
crons = ["*/5 * * * *", "0 0 * * *"]
```

Update `scheduled()` in `apps/server/src/worker.ts` to inspect the triggering cron:

- Every five minutes: query for runnable media jobs and wake only if work exists.
- Daily: run existing lifecycle cleanup, release expired leases, and enqueue missing jobs.

Do not accidentally run the current full lifecycle cleanup every five minutes.

The preflight database check is important. Starting an empty `standard-1` Container every five minutes and leaving it awake for 15 seconds would waste included memory hours.

### Realtime

Add `thumbnail_ready` and optionally `thumbnail_failed` to `packages/schema/src/realtime.ts`.

Update `apps/web/src/lib/realtime-cache.ts` to invalidate:

```text
["thumbnail", itemId]
["trash-thumbnail", itemId]
```

Failure should settle to a generic icon rather than a destructive UI error.

## Phase 5: Generalize thumbnail delivery

The existing core thumbnail download path is restricted by `videoOrNotFound()` in `packages/core/src/engine.ts`.

For GET/download operations, allow generated-thumbnail-supported images now and PDF/video later. Keep client thumbnail upload restricted to its current behavior during the first rollout unless intentionally redesigning that public SDK feature.

Lookup order during migration:

1. Current generated versioned key.
2. Legacy video key.
3. `NotFound`.

Permanent purge must remove both generated and legacy objects.

### Signed URL caching

`apps/web/src/lib/thumbnails.ts` currently returns only a URL and discards `expiresAt`. Refactor thumbnail query data to retain expiry. Do not cache a signed URL indefinitely; refresh it before expiration with a safety margin.

### CSP requirement

`withBrowserSecurityHeaders()` in `apps/server/src/worker.ts` currently defines:

```text
img-src 'self' blob: data:
```

Signed R2 image URLs will be blocked. Add the configured storage origin to `img-src`, and verify video poster behavior too.

## Phase 6: Backfill all existing images

Because there are fewer than about 200 pre-launch objects, backfill all eligible images after staging validation and before enabling the production grid.

Add an idempotent command, for example:

```bash
pnpm --filter @keva/media-worker backfill --limit=200
```

The command should enqueue missing/outdated jobs, not process objects outside the normal job path. Run in bounded batches and reuse normal leases/retries.

A recipe-version bump should make the same command capable of enqueueing outdated thumbnails later.

## Phase 7: Grid UI

Create dedicated components rather than attempting to reinterpret TanStack table columns as cards:

```text
apps/web/src/components/file-browser/FileGrid.tsx
apps/web/src/components/file-browser/FileCard.tsx
apps/web/src/components/file-browser/FileThumbnail.tsx
```

Either rename `FileTableFrame` to a collection-neutral frame or add a sibling frame so table and grid share:

- Scroll area
- Border/radius
- Footer
- Pagination
- Item count
- Empty and loading states

### View preference

Use:

```ts
type FileLayout = "list" | "grid";
```

Persist one personal browser preference under a key such as:

```text
keva:file-layout:v1
```

Do not add layout to saved-view conditions or view metadata. Saved views and All Files honor the same personal preference.

Add a compact List/Grid toggle beside the current file-browser controls.

### Card behavior

Recommended card:

- Fixed 4:3 media area to avoid layout shift.
- Image thumbnails use `object-cover`.
- Generic file-kind icon for missing, pending, failed, or unsupported thumbnails.
- Filename with stem and extension behavior equivalent to the table.
- Size or updated time.
- At most two property badges.
- Selection checkbox.
- Context menu.
- Current/detail-selected state.
- Rename behavior matching the table.

Use native image hints:

```tsx
<img loading="lazy" decoding="async" />
```

Do not wrap the entire card in a `<button>` because the card contains nested interactive controls. Preserve accessible focus, `aria-current`, selection state, and context-menu behavior.

The grid should reuse the same data and TanStack row model for selection, but use a dedicated card renderer. Preserve callbacks for:

- Open detail
- Select
- Rename
- Filter by property
- Download
- Share
- Delete
- Retry upload

Responsive behavior:

- Approximately two columns on narrow mobile widths.
- CSS grid `auto-fill/minmax()` on larger widths.
- Column count should naturally respond when the detail panel opens/resizes.

First UI release applies only to All Files and saved views.

## Testing plan

### Core/Postgres

- Eligible upload confirmation atomically enqueues one job.
- Unsupported content does not enqueue.
- Repeated confirmation/upsert is idempotent.
- Concurrent claimers cannot claim the same job.
- Expired processing leases are reclaimable.
- Stale lease token cannot finalize.
- Retry delays are correct.
- Backfill is idempotent.
- Purge cascades job metadata and deletes generated objects.

### Media worker

Keep small fixtures under `apps/media-worker/test/fixtures`:

```text
normal.jpg
rotated-exif.jpg
transparent.png
small.webp
small.avif
corrupt.jpg
oversized-dimensions image
```

Verify:

- Output is WebP.
- Output dimensions are within 640x640.
- Output is below 1 MiB.
- EXIF orientation is applied.
- Transparent sources have intentional output behavior.
- Corrupt/unsupported input fails permanently.
- Storage/database failures retry.
- Timeout cleans up the child/task and temporary directory.
- Worker termination allows lease recovery.

### Server

- Generated image thumbnail authorization for owner and share principals.
- Trash thumbnail visibility remains correct.
- Versioned then legacy lookup order.
- Purge cleanup.
- `thumbnail_ready` event validation/publication.
- CSP permits the R2 image origin.

### Web

- List/grid preference persists without direct `useEffect`.
- Grid and table selection stay equivalent.
- Missing thumbnail falls back to file-kind icon.
- `thumbnail_ready` invalidates and reloads the card.
- Signed URL is refreshed before expiry.
- Detail panel opens from cards.
- Responsive grid behaves with the resizable detail pane.
- Keyboard and screen-reader behavior remains usable.

### Repository checks

Run:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Also run Wrangler dry-runs for staging and production and a real staging Container smoke test.

## Deployment and rollout

Suggested feature controls:

```text
THUMBNAIL_JOBS_ENABLED
THUMBNAIL_GRID_ENABLED
```

Rollout order:

1. Merge/deploy the database migration.
2. Deploy the Container/controller with job creation disabled.
3. Prove staging database/R2 connectivity and 15-second sleep.
4. Enable image job enqueueing in staging.
5. Upload representative images and test retries/purge races.
6. Run the full staging backfill.
7. Enable grid UI in staging.
8. Monitor Container awake time, memory, errors, and R2 operations.
9. Enable production image jobs.
10. Backfill all existing production images in a bounded batch.
11. Enable production grid UI.
12. Remove feature flags only after stable operation.

Initial Container settings:

```text
Instance type: standard-1
Max instances: 2 across the environment configuration
Processing concurrency: 1 per instance
Batch size: 5
Idle sleep: 15 seconds
Drain deadline: 8 minutes
```

Start with one stable active instance identity per environment even if `max_instances` permits future expansion.

Monitor:

```text
Pending job count
Oldest pending age
Jobs completed/failed/retried
Processing duration
Container awake time
Memory and temporary disk
Output byte size
R2 request errors
Lease recoveries
```

The most useful operational alert is oldest pending job age.

## Cost context

Cloudflare Containers require Workers Paid. The activated $5 plan currently includes monthly Container usage shared across the account:

```text
25 GiB-hours memory
375 vCPU-minutes
200 GB-hours disk
```

For `standard-1`, memory is the first likely included-resource limit:

```text
25 GiB-hours / 4 GiB = approximately 6.25 awake container-hours/month
```

Overages are relatively inexpensive, but idle awake time consumes memory and disk allowance. Keep `sleepAfter` short and drain multiple queued jobs per startup.

Both Keva environments use R2, which avoids the external S3 egress concern discussed for non-Cloudflare storage providers.

## Deferred work

Do not include these in the first image release unless required by a blocker.

### PDF thumbnails

- Install MuPDF or Poppler in the Container.
- Render only page one with a strict timeout.
- Pass the rendered raster through the same Sharp WebP output pipeline.
- Handle encrypted/corrupt/complex PDFs as permanent failures.

### Video thumbnails

- Install/use `ffprobe` and `ffmpeg`.
- Stream from an internally generated presigned R2 URL so large videos are not fully downloaded.
- Sample several candidate frames and reject black/blank frames.
- Reuse the frame-scoring ideas in `apps/web/src/lib/video-thumbnail.ts`.
- Process one video at a time with a 60-90 second timeout.

### Additional UI surfaces

- Trash grid.
- Shared-view grid.
- Any per-view layout preference; current decision is personal global preference.

### Delivery optimization

The first grid may perform one thumbnail-control request per supported item, up to the current 50-item page size. This is acceptable for launch but can later be optimized with:

- Thumbnail availability in item query results.
- A batch signed-URL endpoint.
- Same-origin redirect delivery.

### Legacy video thumbnails

After generated image/PDF/video processing is stable:

- Stop browser generation in `apps/web/src/lib/use-upload-queue.ts`.
- Decide whether SDK custom-thumbnail upload remains a supported feature.
- Remove legacy key fallback only after migration/cleanup.

## Recommended first development task

The next session should implement only the Cloudflare Container connectivity spike:

> Add a minimal `apps/media-worker` Node HTTP service and `MediaContainer` controller, deploy it to staging as `standard-1`, pass staging-only configuration, verify Hyperdrive and R2 access, and verify that it sleeps after 15 seconds.

This isolates Cloudflare platform/configuration risk before introducing database migrations, Sharp, job semantics, or UI work.
