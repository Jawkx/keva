# Auth

keva has two audiences — a person in a browser and a machine (SDK / MCP / agent)
— and they need different credentials. The design keeps them from becoming two
separate worlds by collapsing both into a single `Principal`. **No JWT anywhere:**
server-side sessions for people, opaque revocable tokens for machines.

## Authentication vs. authorization (the boundary)

These are split cleanly across the core boundary:

- **Authentication happens at the edge** (`apps/server`). The server adapter
  turns a request's credential (session cookie or bearer token) into a
  `Principal`. This is the _only_ place credentials, Better Auth, and the token
  table are touched.
- **Authorization happens in the core** (`@keva/core`). `KevaEngine` receives a
  `Principal` — never a raw credential — and enforces scopes and tenancy on every
  operation.

So the core never knows _how_ you authenticated, only _who you are_.

## One Principal, two front doors

```
[apps/server edge]  request ──► Authenticator ──► Principal
                                  ├─ session cookie   (web app, human)
                                  └─ Bearer keva_sk_… (SDK / MCP / agent)
                                            │
                                            ▼
[@keva/core]               KevaEngine(principal, …) authorizes & acts
```

```ts
type Scope = "read" | "write" | "delete" | "admin";

interface Principal {
  tenantId: string; // the isolation boundary (a Better Auth organization)
  scopes: Scope[]; // what this caller may do
  via: "session" | "token";
}
```

There is **no separate prefix field**. Tenancy is solely `tenantId`; the storage
key prefix is _derived_ from it (see [Tenancy](#tenancy)). The web app and an
agent are two clients of one core; this type is where that equivalence is made
real.

## Authentication mechanisms

### People → Better Auth, server-side sessions

- **Better Auth** owns the human side: email/password, social OAuth, email
  verification, password reset, passkeys. OSS, self-hostable, TypeScript-native,
  Drizzle adapter, runs on Workers — on-brand and no SaaS lock-in.
- **Server-side sessions, not JWT.** An opaque session id in an `httpOnly` +
  `Secure` cookie; the session row lives in Postgres. Trivially revocable
  (logout, "sign out everywhere", account compromise) — the property a stateless
  JWT can't give without reintroducing server state. A per-request session
  lookup is cheap and cacheable.

### Machines → opaque API tokens

- **Format:** `keva_sk_<id>_<secret>`. The identifiable prefix makes tokens
  greppable in logs and catchable by secret scanners; `<id>` enables O(1) lookup.
- **Storage:** store a **SHA-256 hash of the secret only** — never plaintext. On
  request, look up by `<id>`, then constant-time compare the hash. Plaintext is
  shown exactly once, at creation. (A fast hash is correct here — these are
  256-bit random secrets, not low-entropy passwords, so no bcrypt/argon.)
- **Revocable & expirable:** hosted = delete/flag the row; self-host = rotate the
  bootstrap secret. Optional `expires_at`.
- **Not JWTs** — long-lived JWTs as API keys are the worst case of the
  non-revocation problem.

## Authorization

Performed in `@keva/core` from the `Principal`:

- **Tenancy** — every operation is scoped by `tenantId` in _both_ stores
  (see below). Enforced in the engine, never only at the edge, so no route or
  edge bug can cross tenants.
- **Scopes** gate operations: `read` (GET/query), `write` (initiate/confirm/
  patch), `delete`, `admin` (token management). The enum is rich from day one;
  implement `read`/`write` first.

## Tenancy

**Tenancy is solely `tenantId`** — one boundary, expressed consistently in two
stores:

- **Metadata:** every query and mutation carries `WHERE tenant_id = principal.tenantId`.
- **Blobs:** storage keys are derived deterministically — final items live at
  `items/<tenantId>/<id>`, uploads stage at `staging/<tenantId>/<id>`.
  Presigned URLs are minted _only_ for keys under the caller's derived prefix.

A token belongs to a tenant and **cannot select a tenant or a sub-prefix** — it
inherits the tenant of the session that created it. `tenantId` maps to a Better
Auth **organization**:

- **Self-host:** one organization (or a static bootstrap token) → a single
  tenant.
- **Hosted:** many organizations, full isolation.

Same code path either way; hosted is just multi-tenant turned on. (A future
sub-namespace feature would add a `namespace` column enforced identically to
`tenant_id` — out of scope for v0.)

## Token generation flow

The session-authenticated dashboard exposes token management. Tokens inherit the
session's tenant; the caller chooses only a name and scopes:

```
[ logged-in human, session ] ──► POST /tokens { name, scopes }
                                    └─► returns keva_sk_… ONCE (only the hash is stored)
                                  GET /tokens         → list (id, name, scopes, last_used)
                                  DELETE /tokens/:id  → revoke
```

This is the bridge from "logged-in person" to "token plugged into an agent, MCP
client, or script."

## The Authenticator (a server-edge service)

`Authenticator` lives in `apps/server`, **not** in `@keva/core`. It is an Effect
service with composed strategies — the same swappable-Layer pattern used for
storage, but on the edge side of the boundary:

```ts
class Authenticator extends Context.Tag("Authenticator")<
  Authenticator,
  { authenticate: (req: RequestParts) => Effect.Effect<Principal, Unauthorized> }
>() {}
```

Layers, in resolution order:

- **`TokenAuthLive`** — `Authorization: Bearer keva_sk_…` → Postgres token lookup
  → `Principal{ via: "token" }`.
- **`SessionAuthLive`** — session cookie → Better Auth → `Principal{ via: "session" }`.
- **`StaticTokenAuthLive`** — a single env secret → fixed root principal
  (single tenant). The zero-DB path for self-host/dev.

Both a web session and an API token are valid on the data-plane API (exactly like
GitHub: the web UI rides your session, the API also takes a PAT). Both produce a
`Principal`; the core treats them identically.

## MCP

keva's remote MCP server (`/mcp`) authenticates with **OAuth 2.1**, the auth the
MCP spec mandates for remote HTTP transports. Better Auth's `mcp` plugin (built
on its OIDC provider) is the authorization server:

- **Discovery** — `GET /.well-known/oauth-protected-resource` (RFC 9728) points
  clients at `GET /.well-known/oauth-authorization-server` (RFC 8414). A
  `/mcp` request without a valid token gets `401` +
  `WWW-Authenticate: Bearer resource_metadata="…"`, which kicks off discovery.
- **Dynamic client registration** (RFC 7591) + **PKCE** — MCP clients register
  themselves and run the authorization-code flow; the dashboard renders the login
  (`/login`) and consent (`/oauth/consent`) screens.
- **Opaque, DB-backed access tokens** — validated by lookup on each `/mcp`
  request via `auth.api.getMcpSession`; revocable from the Connection screen.
  This keeps the **no-JWT** stance for machine credentials (`useJWTPlugin` off).
  The OIDC `id_token` is a JWT by spec but is not the API credential.
- **Scopes** — clients request `keva:read` / `keva:write` / `keva:delete`
  (advertised in the protected-resource metadata). On each call the granted
  scopes map onto the engine's `Scope` enum and the token's `userId` resolves to
  the tenant (the user's organization), yielding a `Principal{ via: "token" }`.
  `admin` is never granted over MCP — token/connection management stays
  session-only.

The data plane stays unchanged: an MCP access token is just another way to reach
a `Principal`, which `@keva/core` authorizes identically to a session or a
`keva_sk_…` token. The OAuth tables live with Better Auth and require a database;
without one, `/mcp` and discovery are not mounted. A future local/stdio MCP entry
could reuse `keva_sk_…` tokens directly (no OAuth needed for a local process).

## Two planes, kept apart

- **Data plane** (the keva API + MCP) — sees _only_ a `Principal`. No human-login
  machinery touches the core.
- **Control plane** (`apps/web` dashboard) — where humans log in (Better Auth)
  and mint data-plane tokens. The complexity of human auth is isolated here.
