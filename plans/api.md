# API & contracts

The HTTP edge is deliberately thin: authenticate → parse → run a core Effect →
map the result (or typed error) to a response. All rules live in `@keva/core`.
This document covers the error contract, the upload/download flows, and the
endpoint surface.

## The error contract

Effect's error *channel* (`Effect<A, E, R>`) is compile-time and in-process — it
does **not** cross HTTP. The frontend gets typed errors anyway by treating errors
as a **shared, serializable contract**:

1. Errors are defined once in `@keva/schema` as `Schema.TaggedError` — each
   carries a `_tag` discriminator plus fields — and unioned into `KevaError`.
2. The Hono edge maps the Effect failure channel to `{ status, body }` via a
   single `statusFor` helper. Unexpected defects become a generic `500` — stack
   traces, causes, and internals are **never** serialized to clients.
3. `@keva/sdk` decodes the body with the *same* `KevaError` schema into a typed
   discriminated union, so callers can `switch (err._tag)`.

Because both sides import the error definitions from the shared package, the
contract **cannot drift** — that is the sync mechanism, enforced by the compiler.

> **SDK & Effect:** the SDK exposes no Effect API and takes no Effect *peer*
> dependency. It may bundle `effect` *internally* to run the decode; consumers
> never see or install it. If that bundle weight matters, replace the decode with
> a generated/hand-written validator so the SDK is fully Effect-free.

### Taxonomy & status mapping (`statusFor`)

| `_tag` | HTTP | Meaning |
|---|---|---|
| `ValidationError` | 400 | malformed input / bad query / bad attribute |
| `Unauthorized` | 401 | missing or invalid credential |
| `Forbidden` | 403 | authenticated but scope/prefix disallows it |
| `NotFound` | 404 | object (within the caller's prefix) doesn't exist |
| `Conflict` | 409 | e.g. confirm on an object not in `pending` |
| `QuotaExceeded` | 413 / 429 | size or attribute limits exceeded |
| `StorageUnavailable` | 502 | the blob backend failed |
| `Internal` | 500 | catch-all for unexpected defects (no detail leaked) |

## Upload flow (direct-to-storage, staging → copy → final)

Bytes go **client → storage directly** and never pass through the server. A
presigned PUT is **replayable until expiry** — it could overwrite a key even
after confirmation, and an exact `Content-Length` doesn't stop a same-sized
replacement — so the presigned PUT only ever targets a **staging** key, and
confirm copies to an **immutable final** key the client can never write to. The
full state machine, idempotency, and crash-recovery rules are in
[`lifecycle.md`](./lifecycle.md); the request path is:

1. **Initiate** — `POST /objects` with `{ name, contentType, size }`. The server
   authorizes (scope `write`), creates a `pending` record, and returns
   `{ id, uploadUrl, expiresAt }`. The presigned PUT targets
   `staging/<tenantId>/<id>`, signed for an **exact `Content-Length` = `size`**,
   short TTL.
2. **Upload** — the client `PUT`s the bytes directly to the staging key via
   `uploadUrl`, sending exactly that `Content-Length`. (Requires a one-time
   bucket CORS rule allowing `PUT` from the app origin — owned by the operator.)
3. **Confirm** — `POST /objects/:id/confirm`. The server `HEAD`s the staging
   object, validates declared vs. real `size`/`etag`, **`CopyObject`s staging →
   `objects/<tenantId>/<id>`** (the immutable final key, never presigned for
   write), atomically flips the record to `ready`, and deletes staging. Confirm
   is idempotent and retry-safe.

**Integrity & cleanup**

- No presigned PUT is ever issued for the final key, so a `ready` object's bytes
  are immutable. `CopyObject` is server-side (no bytes transit the server).
- A **reaper** expires stale `pending` uploads; a **sweeper** finishes deletions.
  Both rely on durable Postgres metadata — which is why metadata persistence
  precedes real blob storage (see [`roadmap.md`](./roadmap.md)).
- If true range enforcement (unknown size up front) is ever needed, that path can
  switch to a **presigned POST** policy with `content-length-range`.
- Single PUT + single `CopyObject` cover files up to 5 GB; multipart is deferred.

## Download flow

`GET /objects/:id/content` returns a redirect (or `{ url }`) to a short-TTL
**presigned GET** — bytes stream client ← storage, never through the server (no
egress through the worker; free on R2).

## Endpoint surface (v0)

Every route authenticates to a `Principal` and is scoped by its prefix + scopes.

| Method & path | Scope | Purpose |
|---|---|---|
| `POST /objects` | write | initiate: create `pending` record, return presigned PUT |
| `POST /objects/:id/confirm` | write | HEAD-confirm, flip to `ready` |
| `GET /objects/:id` | read | fetch the object's metadata |
| `GET /objects/:id/content` | read | presigned GET for the bytes |
| `PATCH /objects/:id/attributes` | write | `set` / `unset` user attributes (see [`data-model.md`](./data-model.md)) |
| `DELETE /objects/:id` | delete | two-phase delete: record intent, then remove blob + row (see [`lifecycle.md`](./lifecycle.md)) |
| `POST /query` | read | query objects by attribute conditions |
| `POST /tokens` | admin | mint an API token (session-only in practice) |
| `GET /tokens` · `DELETE /tokens/:id` | admin | list / revoke tokens |
| `GET /health` | — | liveness |

The MCP server (later) exposes the read/query/patch-attributes subset as tools,
backed by the same core.

## Conventions

- JSON request/response bodies validated by Effect Schema; validation failures →
  `ValidationError` (400).
- Auth via `Authorization: Bearer keva_sk_…` (machines) or session cookie (web).
- The future `@effect/platform` HttpApi migration, if taken, would *derive* this
  surface, the SDK client, and OpenAPI docs from one definition — these endpoints
  are the contract it would formalize.
