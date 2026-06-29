# Architecture

## Decisions

| Decision | Choice | Notes |
|---|---|---|
| Repo | pnpm workspaces + turborepo, TypeScript everywhere | `apps/*`, `packages/*`, `tooling/*`. One toolchain, one language, end-to-end shared types. |
| Core paradigm | **Effect.TS** | Services as `Layer`s, typed errors, `Effect.Schema`. The swappable-adapter design *is* Effect dependency injection. |
| Validation/schema | **Effect Schema** | One library across server + client; serializable tagged errors that double as the wire contract. |
| HTTP edge | **Hono** | Runs on Workers and Node alike. Handlers stay **thin**: parse → run a core Effect → map result/typed-error to a response. |
| Future edge (optional) | `@effect/platform` **HttpApi** | Derives server + typed client + OpenAPI from one definition. A possible later migration, evaluated only if it proves clean on the target runtime. |
| Blob storage | **S3-compatible API** | Portability: R2 / S3 / B2 / Wasabi / MinIO behind one adapter. R2 is the default backend, reached over its S3 endpoint. Enables direct presigned uploads. |
| Storage client | **Plain HTTP** (`fetch`) — no storage SDK | The adapter hits the S3 REST API directly. SigV4 signing via **aws4fetch** (~6KB) or hand-rolled. No provider SDK, no unified-storage lib. |
| Uploads | **Direct-to-storage presigned PUT → staging → server-side copy → immutable final key** | Bytes never pass through the server; final key is never client-writable (replay-safe). Full state machine in [`lifecycle.md`](./lifecycle.md). |
| Metadata store | **Postgres** (Neon / Supabase) | Standard, portable Postgres. JSONB property queries; pgvector path open for later. |
| DB driver | **Drizzle + `postgres.js`** | Works on Workers (via Hyperdrive) and Node (plain connection string). Avoid Prisma on Workers (driver-adapter/bundle friction). |
| Human auth | **Better Auth, server-side sessions** | OSS, self-hostable, TS-native, Drizzle + Workers compatible. **No JWT.** See [`auth.md`](./auth.md). |
| Machine auth | **Opaque API tokens** (`keva_sk_…`, hashed) | Revocable, scoped. Generated from the web dashboard. Not JWTs. |
| Public SDK surface | **Plain Promises; no Effect API, no Effect *peer* dep** | Exposes only `async/await` + plain types. May bundle `effect` *internally* to decode shared schemas; consumers never see or install it. Droppable via a codegen/hand-written decoder if bundle size bites. |
| Runtime | **Workers (default) or Node (first-class)** | Runtime-specific glue is confined to the entry point. Deployment is the operator's job. |
| Dev loop | **`tsx watch` (+ `wrangler dev` for runtime fidelity)** | `tsx` for the fast inner loop; `wrangler dev` to validate against the real Workers runtime + emulated bindings before shipping. |

## The layered architecture

```
  ┌── clients ────────────────────────────────────────────────────────┐
  │  apps/web (browser, session)   agent / SDK / curl (Bearer token)   │
  └───────────────┬───────────────────────────┬───────────────────────┘
                  │                            │
   entry point (the ONLY place runtime/credentials leak in):
     worker.ts → export default app  |  node.ts → @hono/node-server
                  │
                  ▼
  ┌── apps/server (Hono app) ───────────────────────────────────────────┐
  │  AUTHENTICATE (edge) → parse → run core Effect → map errors → HTTP   │
  │  Authenticator service (Tag) resolves credential → Principal:        │
  │    • session (Better Auth)   • token (Postgres)   • static (env)     │
  └───────────────┬─────────────────────────────────────────────────────┘
                  │ calls KevaEngine(principal, …); provides Layers (config in, never bindings)
                  ▼
  ┌── @keva/core (Effect) ──────────────────────────────────────────────┐
  │  KevaEngine — all rules; AUTHORIZES from Principal; tenancy by       │
  │  tenantId, enforced in both stores. No credentials, no transport.    │
  │  services (Tags):                                                    │
  │   • BlobStore       → presign / head / copy / delete                 │
  │   • MetadataStore   → insert / get / replace / delete / query        │
  └──────┬──────────────────────┬───────────────────────────────────────┘
         │                      │
  ┌──────▼──────┐   ┌───────────▼──────────┐
  │ S3BlobStore │   │ PostgresMetaStore    │
  │ (aws4fetch) │   │ (Drizzle+postgres.js)│
  │ → R2/S3/…   │   │ → Postgres (Neon/…)  │
  └─────────────┘   └──────────────────────┘

  @keva/schema — item model, query model, error taxonomy, Principal (shared by ALL)

  Boundary: the edge AUTHENTICATES (credential → Principal); the core AUTHORIZES
  (Principal → allowed/denied). Auth strategies live in apps/server, not the core.
```

Three properties this buys us:

- **The core is the asset; the edge is disposable glue (~a few hundred lines).**
  Swapping Hono → HttpApi, S3 → another backend, or Workers → Node never reaches
  the core.
- **Rules live in exactly one place.** Tenancy, validation, and the item
  lifecycle are enforced in `@keva/core`, so no edge bug or new route can bypass
  them.
- **The same core serves both audiences.** The web app and an agent are just two
  clients with different credentials, both resolving to a `Principal`.

## Bytes vs. meaning, split on purpose

- `BlobStore` owns **bytes** → presigned URLs to S3-compatible storage; the
  server never streams file content.
- `MetadataStore` owns **meaning** → the item records, their properties, and
  the query engine.

"Query by meaning" lives entirely in the metadata store. The two scale and
persist differently, which is why they're separate services from day one.

## Monorepo layout

```
keva/
├── apps/
│   ├── server/                 # Hono app (the data-plane API)
│   │   ├── src/
│   │   │   ├── app.ts          # runtime-neutral: Hono app + Layer composition
│   │   │   ├── auth.ts         # Authenticator: credential → Principal (edge side)
│   │   │   ├── worker.ts       # Workers entry — export default app
│   │   │   └── node.ts         # Node entry — @hono/node-server
│   │   └── wrangler.toml
│   ├── web/                    # consumer dashboard + Better Auth (control plane)
│   └── mcp/                    # MCP server — planned agent client
├── packages/
│   ├── schema/                 # Effect Schema: item, query, errors, Principal. Source of truth.
│   ├── core/                   # Effect: KevaEngine + BlobStore/MetadataStore services & layers (authorizes from Principal)
│   └── sdk/                    # public client. Plain Promises. Decodes shared error schema.
├── tooling/
│   └── tsconfig/               # shared TS config
└── plans/
```

`packages/*` are libraries with no side effects; `apps/*` are the runnable
things. Internal deps use the `workspace:*` protocol so they stay linked, not
fetched. Turborepo orchestrates `build`/`typecheck`/`test` across the graph with
caching; `^build` dependencies ensure `schema` builds before `core` before the
apps.

## Runtime & deployment (brief)

The app is runtime-agnostic by construction. Two entry points exist:

- **`worker.ts`** — Cloudflare Workers; Postgres reached through **Hyperdrive**,
  secrets via Workers env. The default target (scales to zero).
- **`node.ts`** — any Node host; Postgres via a plain `DATABASE_URL`, no
  Hyperdrive. A first-class alternative for self-hosters.

Deployment itself is the operator's responsibility and intentionally out of
scope for this plan. The only design obligations are: keep both entry points
working, and keep all runtime-specifics (Hyperdrive, bindings, `env`,
`process.env`) confined to those two files.

## Rejected alternatives

- **[files-sdk.dev](https://files-sdk.dev/)** (unified 30-backend storage SDK) —
  Node-first with per-provider native client peer deps (Workers support
  unaddressed; bundle-size risk), and a bytes-through `upload`/`download` model
  with no documented presigned support, which inverts our bytes-around data
  path. The S3 API already covers the backends that matter. *Possible future use
  only* as an optional Node-path adapter and as the engine for import/sync
  connectors (pulling files in from Dropbox/Drive/Box).
- **Cloudflare D1** for metadata — SQLite, weaker for rich JSONB/property
  queries and no pgvector path. Postgres chosen instead.
- **JWT for sessions** — non-revocable before expiry; the wrong default for a
  consumer app. Server-side sessions chosen (see [`auth.md`](./auth.md)).
- **R2 native binding** — zero-credential but Cloudflare-only. The S3 API keeps
  the identical code path working across R2, MinIO, S3, etc.
- **Prisma on Workers** — driver-adapter and bundle friction; Drizzle +
  `postgres.js` is the smoother path.
