# Plan 001: Fail closed on incomplete storage configuration

> **Completed**: The final implementation removed alternative storage modes.
> Every server runtime requires Postgres metadata and S3-compatible blob storage.

## Status

- **Result**: completed
- **Planned at**: commit `ade6455`, 2026-07-12

## Why this matters

The product promises permanent storage, so incomplete database or blob-storage
configuration must stop startup rather than select an ephemeral implementation.

## Implemented state

- `apps/server/src/runtime.ts` always constructs Postgres and S3 stores.
- Node startup requires `DATABASE_URL` and complete `S3_*` configuration.
- Worker startup requires Hyperdrive and complete S3 bindings.
- Partial S3 configuration reports the missing variable and fails closed.

## Maintenance notes

Any new persistent adapter must join the configuration matrix. Keep liveness
cheap and separate from dependency-aware readiness if platform probes require it.
