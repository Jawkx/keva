# Roadmap

This roadmap tracks remaining work only. Completed scaffold, core, schema,
server, SDK, Postgres metadata, S3 blob, lifecycle-job, web-auth, upload,
property, query, delete, and token-management work has been removed from this
file so future agents do not treat it as a fresh implementation plan.

For current behavior, use the code and tests as the source of truth. The other
docs in `plans/` are design/reference material, not a backlog.

## Remaining Work

### Agent surface (MCP)

- Add `apps/mcp` with MCP tools for query, item metadata read, content URL/read,
  and property writes.
- Authenticate the MCP server with existing `keva_sk_...` API tokens.
- Reuse `@keva/core` for authorization, tenancy, validation, and lifecycle
  rules.
- Add end-to-end tests proving MCP token access is confined to the token's
  tenant and scopes.

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

### Hosted MCP auth

- Evaluate OAuth 2.1 for a hosted remote MCP endpoint. Local or self-hosted MCP
  can continue to use existing API tokens unless the deployment model changes.

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
