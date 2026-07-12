# Plan 011: Enforce upload size at the storage boundary

> **Executor instructions**: Run the drift check first. Verify behavior against
> the supported R2/S3-compatible provider; do not assume AWS-only POST policies.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- packages/core/src/s3.ts packages/core/src/services.ts apps/server/r2-cors.staging.json packages/sdk/src/index.ts`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

Upload limits trust the declared size until after bytes reach staging storage.
An oversized body consumes bandwidth/storage and can persist after confirmation
rejects it. Public-share limits therefore do not bound resource consumption at
the actual upload boundary.

## Current state

- `packages/core/src/s3.ts:78-81` accepts `size` but signs only content type.
- `packages/core/src/s3.test.ts:15-26` explicitly expects content length not to
  be signed.
- `packages/core/src/engine.ts:121-139` checks caller-declared share limits;
  `190-197` verifies actual size only after upload.
- `packages/sdk/src/index.ts:183-187` sends browser PUTs with returned headers.

## Scope

**In scope**: provider-supported size enforcement, signed request contract,
SDK/browser compatibility, CORS, and cleanup defense.

**Out of scope**: multipart uploads and increasing the 5 GB product limit.

## Steps

1. Verify R2 support for signed `content-length`, checksum, or a constrained
   upload policy. Record the compatibility decision.
2. Implement the strongest provider-supported pre-storage bound. Returned
   headers must be browser-usable and included in CORS configuration.
3. If exact length cannot be enforced for browser PUT, route uploads through a
   bounded streaming service or choose a documented provider mechanism; do not
   claim post-upload HEAD is prevention.
4. Retain confirm-time HEAD validation and staging lifecycle cleanup as defense
   in depth.

## Verification

- A manual provider check -> oversized body is rejected before persistence.
- `pnpm typecheck && pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Storage rejects bodies outside the authorized size contract before retaining
  them, or uploads stream through a server-side hard limit.
- Browser clients can complete valid uploads under configured CORS.

## STOP conditions

- STOP if the selected mechanism works in MinIO/AWS but not Cloudflare R2.
- STOP if it requires exposing storage credentials or buffering multi-gigabyte
  bodies in Worker memory.

## Maintenance notes

Keep confirm-time validation and bucket lifecycle even after prevention lands;
they protect against provider drift and interrupted cleanup.
