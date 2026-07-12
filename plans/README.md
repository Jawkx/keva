# Implementation Plans

Generated from a whole-repository static audit on 2026-07-12 at commit
`ade6455`. Execute in the order below unless dependencies say otherwise. Each
executor must read its plan fully, honor its STOP conditions, run the scoped
checks followed by the repository verification gate, and update its row here.

## Execution order and status

| Plan                                                         | Title                                                | Priority | Effort | Depends on    | Status |
| ------------------------------------------------------------ | ---------------------------------------------------- | -------- | ------ | ------------- | ------ |
| [001](./001-fail-closed-on-production-storage-config.md)     | Fail closed on incomplete production storage         | P1       | M      | -             | DONE   |
| [002](./002-close-storage-lifecycle-cleanup-loop.md)         | Close the storage lifecycle cleanup loop             | P1       | M      | 001           | DONE   |
| [003](./003-share-one-database-unit-of-work.md)              | Share one database unit of work per request          | P1       | L      | -             | DONE   |
| [004](./004-make-share-quotas-atomic.md)                     | Make public-share quota reservation atomic           | P1       | M      | 003           | DONE   |
| [005](./005-validate-property-limits-transactionally.md)     | Validate merged property limits transactionally      | P1       | M      | 003           | DONE   |
| [006](./006-make-upload-retries-resumable.md)                | Make upload retries resume the existing item         | P1       | M      | 002           | DONE   |
| [007](./007-make-view-share-mutations-consistent.md)         | Make view and share mutations consistent             | P1       | L      | 003           | DONE   |
| [008](./008-make-item-history-durable.md)                    | Make item history durable with metadata mutations    | P1       | M      | 003           | DONE   |
| [009](./009-enforce-one-personal-organization.md)            | Enforce one personal organization per user           | P1       | M      | 003           | DONE   |
| [010](./010-make-principal-states-unrepresentable.md)        | Make invalid principal states unrepresentable        | P2       | M      | 009           | DONE   |
| [011](./011-enforce-upload-size-at-storage-boundary.md)      | Enforce upload size at the storage boundary          | P1       | M      | -             | DONE   |
| [012](./012-isolate-public-share-browser-state.md)           | Isolate public-share browser state and secrets       | P1       | M      | -             | DONE   |
| [013](./013-centralize-item-cache-coherence.md)              | Centralize item mutation cache coherence             | P2       | M      | -             | DONE   |
| [014](./014-fix-property-editor-validation-and-conflicts.md) | Fix property editor validation and conflict handling | P2       | L      | 017           | DONE   |
| [015](./015-bound-and-lazy-load-preview-resources.md)        | Bound and lazy-load preview resources                | P2       | M      | -             | DONE   |
| [016](./016-decompose-files-page-state-machine.md)           | Decompose the files-page state machine               | P2       | L      | 013           | DONE   |
| [017](./017-make-shared-schemas-authoritative.md)            | Make shared schemas authoritative across clients     | P2       | L      | -             | DONE   |
| [018](./018-validate-temporal-and-cursor-inputs.md)          | Validate temporal and cursor inputs consistently     | P2       | M      | 017           | DONE   |
| [019](./019-bound-database-aggregation-and-cleanup-scans.md) | Bound database aggregation and cleanup scans         | P2       | M      | -             | DONE   |
| [020](./020-complete-admin-console-boundary.md)              | Harden the local-only admin console                  | P2       | L      | 003, 009, 017 | DONE   |
| [021](./021-harden-browser-responses-and-file-navigation.md) | Harden browser responses and file navigation         | P2       | M      | 012           | DONE   |
| [022](./022-contain-vendored-viewer-debt.md)                 | Contain vendored viewer type and lifecycle debt      | P3       | L      | 015           | DONE   |
| [023](./023-separate-public-item-dtos.md)                    | Separate public item DTOs from persistence records   | P3       | L      | 017           | DONE   |

Status values: `TODO`, `DECISION REQUIRED`, `IN PROGRESS`, `DONE`,
`BLOCKED: <reason>`, or `REJECTED: <reason>`.

## Dependency notes

- Plan 003 introduces the shared transaction boundary required by plans
  004-005, 007-009, and 020. Do not emulate transactions with compensating
  frontend calls.
- Plans 007, 009, and 020 are groomed around their recorded product decisions.
- Plan 013 creates the cache-maintenance seam used by the `FilesPage`
  decomposition in plan 016.
- Plan 017 makes `@keva/schema` authoritative before property-editor and public
  DTO work. Avoid adding another client-only validator while it is pending.
- Plan 012 owns public-share cache lifetime and secret handling. Plan 021 may add
  response headers, but must not duplicate token-lifecycle logic.

## Audit coverage

The audit covered every workspace package and application, root scripts,
checked-in migrations, CI/deployment workflows, tests, and product intent in
`VISION.md`. It used source review and git history; `pnpm format:check` passed and
`pnpm audit --audit-level high` reported no high/critical advisory (one moderate
advisory remains below the reporting threshold).

Not audited dynamically: the live staging database, Cloudflare/R2 settings,
real OAuth-provider behavior, browser bundle measurements, load profiles, and
third-party registry source history. Plans touching those surfaces contain STOP
conditions and require contract tests or measurements before rollout.

## Findings considered and rejected

- Build a portable export/restore product: strongly supported by `VISION.md`,
  but it is product direction rather than code-quality remediation.
- Replace all Better Auth casts immediately: the casts are concentrated at an
  upstream library boundary; broad replacement is not justified without
  upstream-compatible types.
- Treat unknown IDs in batch delete as failures: current tests intentionally
  specify idempotent deletion, so changing it would be a behavior change rather
  than a quality fix.
- Remove the `useMountEffect` wrapper: it is the repository's explicit lifecycle
  convention. The debt is in vendored exclusions and state ownership, covered by
  plans 016 and 022.
- Report dependency upgrades from the lockfile: no high/critical reachable
  advisory was found, and version churn without a concrete failure is noise.
