# Plan 002: Stream Uploads and Downloads Instead of Buffering Whole Files

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat a471073..HEAD -- packages/sdk/src/index.ts packages/sdk/src/index.test.ts apps/web/src/components/UploadModal.tsx apps/web/src/components/FileDetail.tsx`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf, correctness
- **Planned at**: commit `a471073`, 2026-06-27

## Why this matters

Keva advertises direct-to-storage uploads and supports single PUT objects up to 5 GB. The current browser and SDK flow reads each file fully into JS memory, copies the bytes again in the SDK, and downloads full objects into memory even for normal save-to-disk. That will hang or crash clients on large files and undermines the direct-storage architecture.

## Current state

- `packages/sdk/src/index.ts` accepts only `Uint8Array` for high-level upload and copies it:

```ts
// packages/sdk/src/index.ts:114-124
async upload(input: InitiateUploadType, bytes: Uint8Array): Promise<KevaObjectType> {
  const initiated = await this.initiate(input);
  const response = await this.#fetch(initiated.uploadUrl, {
    method: "PUT",
    headers: initiated.headers,
    body: bytes.slice().buffer as ArrayBuffer,
  });
  if (!response.ok) {
    throw new KevaProtocolError(`Blob upload failed with ${response.status}`);
  }
  return this.confirm(initiated.object.id);
}
```

- `apps/web/src/components/UploadModal.tsx` reads every `File` into memory:

```ts
// apps/web/src/components/UploadModal.tsx:47-59
for (const target of files) {
  try {
    const bytes = new Uint8Array(await target.arrayBuffer());
    await keva.upload(
      {
        name: target.name,
        contentType: target.type || "application/octet-stream",
        size: target.size,
        source: "upload",
        attributes: {},
      },
      bytes,
    );
```

- `apps/web/src/components/FileDetail.tsx` buffers normal downloads before creating a Blob:

```ts
// apps/web/src/components/FileDetail.tsx:125-140
const bytes = await keva.download(object.id);
const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
  type: object.contentType,
});
const url = URL.createObjectURL(blob);
const anchor = document.createElement("a");
anchor.href = url;
anchor.download = object.name;
document.body.appendChild(anchor);
anchor.click();
anchor.remove();
URL.revokeObjectURL(url);
```

- Design constraint from the architecture docs: bytes should go client to storage directly, and the server should not stream file content in production.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| SDK tests | `pnpm --filter @keva/sdk test` | all tests pass |
| SDK typecheck | `pnpm --filter @keva/sdk typecheck` | exit 0 |
| Web typecheck | `pnpm --filter @keva/web typecheck` | exit 0 |
| Server integration tests | `pnpm --filter @keva/server test` | all tests pass |

## Scope

**In scope**:
- `packages/sdk/src/index.ts`
- `packages/sdk/src/index.test.ts`
- `apps/web/src/components/UploadModal.tsx`
- `apps/web/src/components/FileDetail.tsx`

**Out of scope**:
- S3 signing policy changes in `packages/core/src/s3.ts`. Plan 004 covers real S3 compatibility gates.
- Multipart upload.
- Resumable upload.
- UI redesign.
- API route changes.

## Git workflow

- Branch: `advisor/002-stream-file-io`
- Commit message style: plain imperative, for example `Add streaming SDK file helpers`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Split SDK metadata and byte operations

In `packages/sdk/src/index.ts`, keep `initiate` and `confirm` as public methods. Add a public method that returns the presigned download URL without fetching bytes:

```ts
getDownloadUrl(id: string): Promise<DownloadResultType>
```

You will need to export the `DownloadResult` type from `@keva/sdk` if consumers need it.

**Verify**: `pnpm --filter @keva/sdk typecheck` -> exit 0.

### Step 2: Add a body-friendly upload helper

Replace the `Uint8Array`-only upload path with an API that accepts a fetch body directly. Suggested shape:

```ts
type UploadBody = BodyInit;

async uploadBody(input: InitiateUploadType, body: UploadBody): Promise<KevaObjectType>
```

Use `body` directly in `fetch` and do not call `arrayBuffer()`, `slice()`, or `new Uint8Array()` in this path. Preserve `initiated.headers` for now so existing Node/server tests continue to exercise the signed-header contract.

Add a convenience browser helper:

```ts
async uploadFile(
  file: File,
  options?: { attributes?: InitiateUploadType["attributes"]; source?: string },
): Promise<KevaObjectType>
```

`uploadFile` should call `uploadBody` with `{ name: file.name, contentType: file.type || "application/octet-stream", size: file.size, source: options?.source ?? "upload", attributes: options?.attributes ?? {} }` and pass the `File` itself as the body.

**Verify**: `pnpm --filter @keva/sdk typecheck` -> exit 0.

### Step 3: Preserve a bounded byte-read helper for previews and tests

Keep or introduce an explicitly named small-object helper:

```ts
downloadBytes(id: string): Promise<Uint8Array>
```

This may fetch the presigned URL and call `arrayBuffer()`. It should no longer be the method used by normal download UI. If you keep the method name `download`, make sure the web code clearly uses the non-buffering method for normal downloads. Because backward compatibility is not required, prefer clearer names: `getDownloadUrl`, `downloadResponse`, `downloadBytes`.

**Verify**: `pnpm --filter @keva/sdk test` -> all tests pass after updating tests in the next step.

### Step 4: Update SDK tests

In `packages/sdk/src/index.test.ts`, add or update tests to assert:

- `uploadFile` or `uploadBody` passes the original body object through to fetch. Use a `Blob` or `File` where available; if `File` is unavailable in the test runtime, use `Blob`.
- `getDownloadUrl` returns the decoded URL payload and does not fetch the blob URL.
- `downloadBytes` still buffers only when explicitly called.

Model the current test style, which constructs `KevaClient` with a custom `fetch`.

**Verify**: `pnpm --filter @keva/sdk test` -> all tests pass, including the new assertions.

### Step 5: Update web upload to pass `File` directly

In `apps/web/src/components/UploadModal.tsx`, remove `await target.arrayBuffer()` and call the SDK file/body helper with the original `File`.

Target behavior:

```ts
await keva.uploadFile(target, { attributes: {}, source: "upload" });
```

or equivalent if you chose a different method name in Step 2.

**Verify**: `pnpm --filter @keva/web typecheck` -> exit 0.

### Step 6: Update normal download to avoid buffering

In `apps/web/src/components/FileDetail.tsx`, update the normal Download button to call `keva.getDownloadUrl(object.id)`, create an anchor pointing directly at the returned URL, set `anchor.download = object.name`, click it, and remove it. Do not fetch the bytes and do not create an object URL for normal download.

Keep previews bounded: image/text previews are already gated by `IMAGE_MAX` and `TEXT_MAX`, so they may continue to use the explicit `downloadBytes` helper.

**Verify**: `pnpm --filter @keva/web typecheck` -> exit 0.

### Step 7: Run server acceptance tests

The server loopback upload flow should still work through the SDK/web contract changes.

**Verify**: `pnpm --filter @keva/server test` -> all tests pass.

## Test plan

- Update `packages/sdk/src/index.test.ts` with body pass-through, URL-only download, and explicit byte download tests.
- Existing server tests cover the HTTP roundtrip and dev loopback byte path.
- Existing web typecheck is the available web verification gate.

## Done criteria

- [ ] No production upload path calls `File.arrayBuffer()` before uploading.
- [ ] SDK high-level upload passes `File`/`Blob`/`BodyInit` directly as fetch body.
- [ ] Normal web download uses a presigned URL directly instead of buffering into `Uint8Array`.
- [ ] Preview buffering remains size-gated.
- [ ] `pnpm --filter @keva/sdk test` exits 0.
- [ ] `pnpm --filter @keva/sdk typecheck` exits 0.
- [ ] `pnpm --filter @keva/web typecheck` exits 0.
- [ ] `pnpm --filter @keva/server test` exits 0.
- [ ] `plans/improvement/README.md` status row for plan 002 is updated.

## STOP conditions

Stop and report if:

- Avoiding buffering requires changing server API routes.
- The browser cannot send the current signed upload headers with a `File` body and fixing that requires editing `packages/core/src/s3.ts`; that belongs with Plan 004 or a follow-up storage signing plan.
- TypeScript's DOM types are unavailable in the SDK build in a way that requires broad tsconfig changes.

## Maintenance notes

After this lands, reviewers should reject new app code that calls `arrayBuffer()` for whole-object uploads or normal downloads. Keep `downloadBytes` only for intentionally bounded preview/test paths.

