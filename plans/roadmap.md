# Roadmap

This roadmap tracks remaining work only. Completed scaffold, core, schema,
server, SDK, Postgres metadata, S3 blob, lifecycle-job, web-auth, upload,
property, query, delete, and token-management work has been removed from this
file so future agents do not treat it as a fresh implementation plan.

For current behavior, use the code and tests as the source of truth. The other
docs in `plans/` are design/reference material, not a backlog.

## Remaining Work

### Agent surface (MCP) — shipped, with follow-ups

keva is now an MCP server: `packages/mcp` declares the tools (`query_items`,
`get_item`, `get_content_url`, `set_properties`, `delete_item`) and the `/mcp`
route in `apps/server` resolves an OAuth access token to a `Principal` and runs
each tool through `@keva/core` (so tenancy/scopes/validation are not duplicated).
Auth is OAuth 2.1 via Better Auth's `mcp` plugin (see [`auth.md`](./auth.md)).
Remaining:

- Add automated end-to-end tests that exercise the full OAuth + `/mcp` flow
  against a real database (register → authorize → consent → token → tool call),
  proving tenant isolation and scope enforcement over HTTP. Current coverage is
  the pure mapping + route-auth unit tests plus tool-level tests in
  `packages/mcp`; the live flow is verified manually with the MCP Inspector.
- Add CORS handling on `/mcp` and `/.well-known/*` if browser-based MCP clients
  need it (server-side clients and the Inspector proxy do not).
- Optional: an `apps/mcp` stdio entry point reusing `packages/mcp` for local
  clients that prefer stdio over remote HTTP.
- Consider an `upload`/multipart tool once a presigned-PUT-friendly tool shape is
  designed; v1 is read/query/property-write/delete.

### Multi-tenant hardening

- Audit Better Auth organization membership and role handling for shared or
  multi-member organizations.
- Map organization roles to keva scopes instead of assuming every session has
  full tenant control.
- Add isolation tests across multiple organizations, sessions, and API tokens.
- Confirm token mint/list/revoke cannot cross tenant boundaries under concurrent
  org/session changes.

### Human-auth polish

- Decide whether password reset, email verification, passkeys, or social login
  belong in the first hosted release.
- If included, wire the chosen Better Auth capabilities through the existing
  session-auth path and web UI.

### Production operations

- Document a production S3/R2 CORS policy for direct browser uploads.
- Document how operators should run the reaper/sweeper jobs in Node and Workers
  deployments.
- Add an operator checklist for required environment variables, migrations, and
  first-run setup.
- Add structured logging/observability around auth failures, storage failures,
  lifecycle jobs, and token use without leaking secrets.

### Query and metadata evolution

- Decide whether search remains structured property filters only, or grows into
  natural-language-to-query and semantic search.
- Add opt-in typed/indexed property definitions if real workloads need fast
  ranges, sorts, substring search, or full-text search on selected keys.
- Add provenance for property writes if agent/user attribution becomes necessary.

### Hosted MCP auth — decided & shipped

The remote MCP endpoint uses **OAuth 2.1** (PKCE + dynamic client registration +
protected-resource metadata), served by Better Auth's `mcp`/OIDC provider. Access
tokens are opaque and DB-backed (revocable), keeping the no-JWT guardrail. The
authorization server requires a database; in the no-DB/static-token path the
`/mcp` and discovery routes stay unmounted. `keva_sk_…` API tokens remain the
credential for the plain HTTP API and SDK.

### Optional platform work

- Evaluate `@effect/platform` HttpApi only if it can cleanly derive the server,
  typed client, and OpenAPI surface on the target runtime.
- Add pgvector-backed semantic search only if embeddings written by agents prove
  useful enough to justify the operational cost.

## Guardrails

- Authenticate at the edge, authorize in the core.
- Keep rules in `@keva/core`; HTTP, web, MCP, and SDK code should not duplicate
  tenancy, validation, or lifecycle logic.
- Keep tenancy solely on `tenantId`, enforced in both metadata queries and blob
  key derivation.
- Never mint presigned URLs before resolving a `Principal`.
- Keep production bytes off the server; use presigned storage operations.
- Keep final object keys client-unwritable.
- Keep deletes two-phase and lifecycle jobs idempotent.
- Never serialize stack traces or internal causes to clients.
- Keep the SDK promise-based, with no public Effect API.
- Treat `null` as a stored property value; use `unset` for removal.
- Continue avoiding JWTs for long-lived machine credentials.
- Keep runtime-specific bindings and environment handling in entry points and
  runtime wiring.
