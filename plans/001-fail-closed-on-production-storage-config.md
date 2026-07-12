# Plan 001: Fail closed on incomplete production storage

> **Executor instructions**: Run the drift check first. Preserve the documented
> zero-config local mode, but require an explicit choice rather than inference in
> deployed Worker mode.
>
> **Drift check**: `git diff --stat ade6455..HEAD -- apps/server/src/worker.ts apps/server/src/runtime.ts apps/server/src/server-options.ts apps/server/wrangler.toml`

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

The product promises permanent storage, but deployed configuration can silently
select in-memory metadata or blobs. Under Hyperdrive, request-scoped memory blob
grants disappear before the subsequent upload PUT, producing broken uploads,
reserved quota, and misleading health checks.

## Current state

- `apps/server/src/worker.ts:59-80` enables S3 only when all selected bindings are
  truthy; partial configuration silently becomes `undefined`.
- `apps/server/src/runtime.ts:75-92` chooses memory stores whenever database/S3
  configuration is absent.
- `apps/server/src/worker.ts:99-104` creates request-scoped services under
  Hyperdrive, making memory grant state unusable across requests.
- `apps/server/src/app.ts:154` reports health without checking configuration or
  dependencies.

## Scope

**In scope**: Worker/runtime configuration parsing, explicit runtime mode,
health/readiness semantics, env examples and Wrangler bindings.

**Out of scope**: lifecycle scheduling (plan 002) and database-client reuse
(plan 003).

## Steps

1. Introduce an explicit local-memory mode used by local Node environments. Do
   not infer it from missing production bindings.
2. Validate S3 as an all-or-nothing configuration and require persistent
   database plus blob storage in deployed Worker mode.
3. Reject invalid combinations before creating an app/runtime. Error messages
   may name missing variable names but never values.
4. Add a readiness route or strengthen health so staging smoke checks exercise
   runtime construction and safe read-only dependency checks.

## Verification

- `pnpm --filter @keva/server typecheck` -> exit 0.
- `pnpm lint && pnpm format:check` -> exit 0.

## Done criteria

- Worker deployments cannot start with ephemeral metadata/blob adapters.
- Local development still works without Postgres/S3 only through explicit mode.
- Readiness fails when persistent dependencies are unusable.

## STOP conditions

- STOP if Cloudflare bindings cannot be distinguished from local execution
  deterministically; require a configured runtime-mode binding.
- STOP if readiness would mutate storage or expose internal error details.

## Maintenance notes

Any new persistent adapter must join the configuration matrix. Keep liveness
cheap and separate from dependency-aware readiness if platform probes require it.
