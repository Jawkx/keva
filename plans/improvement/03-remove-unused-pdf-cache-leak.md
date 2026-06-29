# Plan 03: Remove the unused PDF thumbnail/document caches (latent blob-URL leak)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/improvement/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9c454b4..HEAD -- apps/web/src/components/pdf-thumbnail-utils.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt (dead code) + latent bug (resource leak)
- **Planned at**: commit `9c454b4`, 2026-06-30

## Why this matters

`apps/web/src/components/pdf-thumbnail-utils.ts` contains two module-level caches
(`pdfDocumentCache`, `thumbnailUrlCache`) and three functions
(`loadPdfDocument`, `getPdfPageCount`, `renderPdfThumbnailUrl`).
`renderPdfThumbnailUrl` calls `URL.createObjectURL(blob)` and stores the result
in `thumbnailUrlCache` **forever** — the cache has no eviction and never calls
`URL.revokeObjectURL`, and `pdfDocumentCache` likewise retains every parsed PDF
document indefinitely. That is a textbook unbounded-memory leak.

**However**, none of those three functions or two caches are called anywhere in
the app. The only export of this file that is actually used is
`loadSharedPdfEngine` (imported by `components/ui/pdf-viewer.tsx`), and the real
PDF viewer renders its own thumbnails via `@embedpdf/plugin-thumbnail` — not via
`renderPdfThumbnailUrl`. So the leak is **latent dead code**, not a live leak.

The right fix for unbounded-leak dead code is to delete it: it removes the latent
bug and ~50 lines that would otherwise rot or get wired up incorrectly. The
project already has a *correct* reference for bounded object-URL caching
(`apps/web/src/lib/object-url-cache.ts`, an LRU that revokes on eviction) if
thumbnails are ever wanted — see Maintenance notes.

## Current state

`apps/web/src/components/pdf-thumbnail-utils.ts` (full file today):
```ts
import type { PdfDocumentObject, PdfEngine } from "@embedpdf/models"

const PDFIUM_VERSION = "2.14.4"
const PDFIUM_WASM_URL = `https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@${PDFIUM_VERSION}/dist/pdfium.wasm`

let sharedEnginePromise: Promise<PdfEngine> | null = null
const pdfDocumentCache = new Map<string, Promise<PdfDocumentObject>>()
const thumbnailUrlCache = new Map<string, Promise<string | null>>()

export function loadSharedPdfEngine() { /* uses PDFIUM_WASM_URL */ }
export async function loadPdfDocument(url: string) { /* fills pdfDocumentCache */ }
export async function getPdfPageCount(url: string) { /* uses loadPdfDocument */ }
export function renderPdfThumbnailUrl({ … }) { /* createObjectURL, never revoked */ }
```

**Proof the deletion is safe** (run these yourself in Step 1; they should match):
- `loadSharedPdfEngine` is imported once, by `apps/web/src/components/ui/pdf-viewer.tsx`.
- `renderPdfThumbnailUrl`, `getPdfPageCount`, `loadPdfDocument`, `pdfDocumentCache`,
  and `thumbnailUrlCache` have **no references** outside `pdf-thumbnail-utils.ts`
  itself.

## Commands you will need

| Purpose            | Command                                | Expected |
|--------------------|----------------------------------------|----------|
| Install            | `pnpm install`                         | exit 0   |
| Typecheck (web)    | `pnpm --filter @keva/web typecheck`    | exit 0   |
| Build (web)        | `pnpm --filter @keva/web build`        | exit 0   |
| Lint (whole repo)  | `pnpm lint`                            | exit 0   |

(`apps/web` has no test runner; verification is typecheck + build + lint + the
reference greps below. That is sufficient — this is a deletion of unreferenced code.)

## Scope

**In scope** (the only files you may modify):
- `apps/web/src/components/pdf-thumbnail-utils.ts`
- `plans/improvement/README.md` (status row only)

**Out of scope** (do NOT touch):
- `apps/web/src/components/ui/pdf-viewer.tsx` — it must keep working; you are not
  changing how it imports `loadSharedPdfEngine`.
- `apps/web/src/lib/object-url-cache.ts` — the correct LRU cache; leave it.
- Any dependency in `package.json`.

## Git workflow

- Branch: `advisor/03-remove-pdf-cache-deadcode`.
- One commit. Short imperative message (match `git log`),
  e.g. `Remove unused PDF thumbnail/document caches`.
- Do NOT push or open a PR unless the operator asks.

## Steps

### Step 1: Confirm the code is truly unused (gate)

Run:
```sh
grep -rn "renderPdfThumbnailUrl\|getPdfPageCount\|loadPdfDocument" apps/web/src \
  | grep -v "components/pdf-thumbnail-utils.ts:"
```
**Expected**: no output (the three functions are referenced only inside the file
being deleted from).

Also confirm the one export you must KEEP is used:
```sh
grep -rn "loadSharedPdfEngine" apps/web/src | grep -v "components/pdf-thumbnail-utils.ts:"
```
**Expected**: exactly one hit, in `apps/web/src/components/ui/pdf-viewer.tsx`.

If the first grep prints anything, **STOP** (see STOP conditions).

### Step 2: Reduce the file to just the engine singleton

Replace the entire contents of `apps/web/src/components/pdf-thumbnail-utils.ts`
with:

```ts
import type { PdfEngine } from "@embedpdf/models"

const PDFIUM_VERSION = "2.14.4"
const PDFIUM_WASM_URL = `https://cdn.jsdelivr.net/npm/@embedpdf/pdfium@${PDFIUM_VERSION}/dist/pdfium.wasm`

let sharedEnginePromise: Promise<PdfEngine> | null = null

export function loadSharedPdfEngine() {
  sharedEnginePromise ??= import("@embedpdf/engines/pdfium-worker-engine").then(
    ({ createPdfiumEngine }) => createPdfiumEngine(PDFIUM_WASM_URL, {}),
  )

  return sharedEnginePromise
}
```

This deletes `pdfDocumentCache`, `thumbnailUrlCache`, `loadPdfDocument`,
`getPdfPageCount`, `renderPdfThumbnailUrl`, and the now-unused `PdfDocumentObject`
import — keeping only `loadSharedPdfEngine` (and the pdfium constants it needs).

**Verify**:
- `pnpm --filter @keva/web typecheck` → exit 0 (no unused-import or
  missing-symbol errors; `pdf-viewer.tsx` still resolves `loadSharedPdfEngine`).
- `pnpm --filter @keva/web build` → exit 0.

### Step 3: Confirm no dangling references and the rule still holds

```sh
grep -rn "thumbnailUrlCache\|pdfDocumentCache\|renderPdfThumbnailUrl\|getPdfPageCount\|loadPdfDocument" apps/web/src
```
**Expected**: no output.

`pnpm lint` → exit 0 (the no-direct-`useEffect` check and per-package `tsc` pass).

## Test plan

No automated tests exist for `apps/web` (no test runner is configured), and this
change removes unreferenced code, so verification is static:
- typecheck + build prove nothing referenced the deleted symbols and the bundle
  still compiles;
- the Step 3 grep proves the symbols are gone repo-wide.

Adding a web test runner is a worthwhile but separate effort (out of scope here).

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @keva/web typecheck` exits 0
- [ ] `pnpm --filter @keva/web build` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `grep -rn "thumbnailUrlCache\|pdfDocumentCache\|renderPdfThumbnailUrl\|getPdfPageCount\|loadPdfDocument" apps/web/src`
      returns no matches
- [ ] `grep -rn "loadSharedPdfEngine" apps/web/src/components/ui/pdf-viewer.tsx`
      still returns its import (the viewer is unbroken)
- [ ] `git status` shows only `apps/web/src/components/pdf-thumbnail-utils.ts`
      and `plans/improvement/README.md` changed
- [ ] `plans/improvement/README.md` status row for plan 03 updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's grep finds **any** reference to `renderPdfThumbnailUrl`,
  `getPdfPageCount`, or `loadPdfDocument` outside `pdf-thumbnail-utils.ts`. That
  means the code is actually used and must NOT be deleted — instead it needs the
  bounded-cache fix (see Maintenance notes), which is a different change. Report
  the references and stop.
- The "Current state" excerpt doesn't match the live file (it has drifted).
- typecheck fails after Step 2 citing `loadSharedPdfEngine` — the viewer's import
  path may differ from what this plan assumed; report it.

## Maintenance notes

- For the reviewer: verify `pdf-viewer.tsx` only ever imported
  `loadSharedPdfEngine` from this module (it renders thumbnails through
  `@embedpdf/plugin-thumbnail`, not this file).
- **If PDF thumbnails are wanted later**: do NOT resurrect the deleted code as-is
  — it leaks. Implement the cache with the LRU + `revokeObjectURL` pattern in
  `apps/web/src/lib/object-url-cache.ts` (a `Map` capped at `MAX_ENTRIES` that
  revokes the least-recently-used blob URL on eviction). That file even
  references this one in a comment as the cache it "mirrors" — update that
  comment if you remove this module's caches.
