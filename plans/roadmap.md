# Roadmap

Each phase ends with a concrete, testable deliverable. Deployment is the
operator's responsibility and is intentionally not a phase — the architecture
(see [`architecture.md`](./architecture.md)) keeps the app deployable to Workers
or Node at any point.

## Phase 0 — Scaffold + the shared core

- Root workspace: pnpm + turborepo, shared `@keva/tsconfig` in `tooling/`, root
  scripts (`build`/`dev`/`typecheck`/`test`/`lint`).
- **`@keva/schema`** with Effect Schema: `KevaObject` (system + attributes
  split), attribute value types & limits, the `Query` model, the error taxonomy,
  and `Principal`. This is the source of truth every other package imports.
- **`@keva/core`** with Effect: `Authenticator`, `BlobStore`, and
  `MetadataStore` as `Context.Tag` services; `KevaEngine` returning `Effect`s
  with tenancy scoping built in; in-memory `Layer`s for all three.
- **Done when:** `pnpm install` + `turbo build` + `typecheck` pass; an in-memory
  create → query → get-attributes roundtrip works in a unit test, already scoped
  by a `Principal` prefix (no HTTP yet).

## Phase 1 — Local API + SDK + auth

- Hono `app.ts` running core Effects per route via `runPromiseExit`; the error
  serialization seam + `statusFor` mapping (see [`api.md`](./api.md)).
- **Auth from the start:** `StaticTokenAuthLive` at the edge (one env secret →
  a single-tenant root `Principal`) gating every route; tenancy-scoping (by
  `tenantId`) enforced in the engine. The API is never reachable
  unauthenticated. Authentication is edge-side; the core only authorizes.
- **Dev-only loopback blob path:** the in-memory `BlobStore`'s `presignUpload` /
  `presignDownload` return loopback URLs to a dev-only server route that accepts
  / serves bytes from memory. This exercises the full initiate → upload → confirm
  → download flow locally before real S3 exists. *Explicitly not the production
  path* (prod bytes never transit the server) and replaced in Phase 2.
- **`@keva/sdk`** (plain Promises) that decodes `KevaError` into typed errors.
- **Done when:** through the SDK, against a locally running server, a client can
  authenticate, run the full create → upload → confirm → query → download
  roundtrip, and a forced `NotFound` / `Unauthorized` arrives as a typed error.

## Phase 2 — Persistent metadata (Postgres)

Durable metadata **before** real blobs: the reaper/sweeper can only discover
orphans from durable records, so persistence comes first.

- **`PostgresMetaStore`** with Drizzle + `postgres.js`: schema + migrations,
  JSONB attribute filtering implementing the full operator × type matrix and
  cursor pagination (see [`data-model.md`](./data-model.md)); indexes (btree on
  system columns, **`jsonb_ops`** GIN on `attributes`, `tenant_id`-leading
  composites).
- The lifecycle states (`pending | ready | deleting`) and their **conditional,
  atomic transitions** (see [`lifecycle.md`](./lifecycle.md)) — still over the
  in-memory/loopback blob, so the state machine is exercised before real storage.
- The Layer takes a connection **config**, never a binding.
- **Done when:** objects + attributes persist across restarts; queries are
  correct, paginated, tenant-scoped; concurrent confirm/reaper transitions
  resolve cleanly via conditional updates — verified via `node.ts` against local
  Postgres.

## Phase 3 — Real blobs (S3-compatible) + lifecycle jobs

- **`S3BlobStoreLive`** using aws4fetch: `presignUpload` (staging key, exact
  `Content-Length`), `presignDownload` (final key), `head`, **`copy`** (staging →
  final), `delete`. Config: `{ endpoint, region, accessKeyId, secretAccessKey,
  bucket, forcePathStyle }`.
- The real staging → copy → immutable-final confirm path; the **reaper**
  (expire `pending`) and **sweeper** (finish `deleting`) jobs.
- **Done when:** a file uploads to staging in a real bucket (R2 or local MinIO),
  confirm copies it to an immutable final key, the server never touches the
  bytes, an abandoned `pending` is reaped, a delete is swept to completion, and
  **replaying a staging URL cannot alter a `ready` object**.

## Phase 4 — Web app + human auth (control plane)

- **`apps/web`**: the consumer dashboard, with **Better Auth** (server-side
  sessions) for login/social/reset; Better Auth tables in the same Postgres.
- **`SessionAuthLive`** + **`TokenAuthLive`** wired into the `Authenticator` so
  both a session and a `keva_sk_…` token resolve to a `Principal`. Organizations
  plugin → `tenantId`.
- **Token management UI**: mint / list / revoke API tokens (the bridge to agents
  and the SDK).
- Core file UX: upload, browse, see/edit attributes, query.
- **Done when:** a human can sign up, log in, upload and tag a file in the
  browser, mint an API token, and use that token from the SDK to reach the same
  files.

## Phase 5 — Agent surface (MCP) + multi-tenant

- **`apps/mcp`**: an MCP server exposing query / read / write-attributes as
  tools, authenticated with a `keva_sk_…` token, backed by the same core.
- Harden multi-tenant isolation across many organizations.
- **Done when:** an external agent (e.g. Claude over MCP) can list, query by
  attribute, read a file, and write attributes back — all confined to its
  token's prefix and scopes.

## Phase 6 — Later / optional

- Warm **vector index** (pgvector) if semantic search earns its place —
  embeddings written by agents (BYOA), ANN search served by keva.
- **OAuth 2.1** for the hosted MCP endpoint.
- **Provenance** on attributes (who/when).
- Evaluate the **`@effect/platform` HttpApi** migration (derived client +
  OpenAPI) if it proves clean on the target runtime.

---

## Guardrails

- **Authenticate at the edge, authorize in the core.** `apps/server` turns a
  credential into a `Principal`; `@keva/core` only ever receives a `Principal`
  and enforces scopes/tenancy. Credentials never reach the core.
- **Rules live in `@keva/core`.** HTTP handlers stay thin; the web app, MCP, and
  SDK never re-implement validation, tenancy, or the object lifecycle.
- **Tenancy is solely `tenantId`, enforced in the core, in both stores** — metadata
  `WHERE tenant_id =` and a derived blob key prefix. No route can reach another
  tenant's data; tokens cannot select a tenant or sub-prefix.
- **Never authenticate-late.** Any endpoint that mints presigned URLs requires a
  `Principal`; there is no unauthenticated data-plane route.
- **Bytes never transit the server in production** — always presign. The Phase-1
  loopback is a dev-only exception, clearly isolated.
- **Final keys are never client-writable.** Presigned PUTs target staging only;
  confirm copies to the immutable final key, so a `ready` object can't be
  replayed/overwritten. Size pinned by exact signed `Content-Length` (not
  `content-length-range`, which is POST-policy only) + HEAD-confirm.
- **Durable metadata precedes real blobs.** The reaper/sweeper need durable
  records to find orphans; deletion is **two-phase** (durable intent → blob
  delete → row removal) and the jobs are idempotent.
- **Never leak internals.** Defects map to a generic `500`; stack traces and
  causes are never serialized.
- **The SDK exposes no Effect API and no Effect *peer* dependency.** A bundled
  internal `effect` for decoding is acceptable; drop it via codegen if bundle
  size matters.
- **`null` is a value, not a tombstone.** Attribute removal uses `unset`.
- **No JWT.** Server-side sessions for people, opaque hashed tokens for machines.
- **Runtime-specifics stay in the entry point.** Hyperdrive, Workers bindings,
  `env`, `process.env` live only in `worker.ts` / `node.ts`; the core and
  `app.ts` Layers receive plain config, so a Node deployment is a config swap,
  never a port.

## Open questions

- **Postgres host:** Neon vs. Supabase (vs. self-hosted). Both standard Postgres;
  pick on free-tier limits + Hyperdrive compatibility. (Supabase would also bring
  its own auth, but Better Auth is chosen for portability.)
- **Query depth:** structured attribute filters only, or eventual NL→query +
  semantic/vector search. Determines whether vectors are needed at all.
- **Edge framework:** Hono permanently, or migrate to HttpApi later.
- **Scopes at launch:** ship `read`/`write` only, or include `delete`/`admin`
  granularity immediately. (Enum is defined richly regardless.)
