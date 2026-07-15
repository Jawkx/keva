# @keva/web

Phase-4 consumer dashboard for **keva** — a Vite + React + TypeScript SPA.

It talks to the keva API entirely over relative URLs. In development, Vite
proxies every API path prefix to the API so the browser only ever talks to a
single same-origin host (`http://localhost:5173`). That keeps the Better Auth
session cookie first-party, which is required for cookie-based session auth.

## Pages

- `/login`, `/signup` — Better Auth email + password. On success → `/`.
- `/` and `/items/:id` — Files master/detail surface: lists items
  (`keva.query()`), filters, upload modal, metadata, properties editor,
  download, and delete.
- `/connection` — API token management and MCP application connections.
- `/query` and `/tokens` — redirects kept for old links.

Authed routes are guarded by `authClient.useSession()`; no session redirects to
`/login`. A `401 / Unauthorized` from any API call also bounces to `/login`.

## Dev stack (two terminals)

The SPA needs the API, Postgres, and an S3-compatible bucket. The API returns
presigned S3 URLs for blob uploads and downloads, so the bucket must allow the
web app's development origin through its CORS configuration.

### Terminal 1 — API (port 8787)

```sh
KEVA_STATIC_TOKEN=dev-token \
BETTER_AUTH_SECRET=dev-secret-change-me \
DATABASE_URL=postgres://localhost:5432/keva \
S3_ENDPOINT=http://127.0.0.1:9000 \
S3_REGION=us-east-1 \
S3_ACCESS_KEY_ID=minioadmin \
S3_SECRET_ACCESS_KEY=minioadmin \
S3_BUCKET=keva \
S3_FORCE_PATH_STYLE=true \
pnpm --filter @keva/server dev
```

Adjust the database and S3 values for your local services.

### Terminal 2 — web (port 5173)

```sh
pnpm --filter @keva/web dev
```

Then open http://localhost:5173.

## Proxy

`vite.config.ts` proxies these prefixes to `http://127.0.0.1:8787` with
`changeOrigin: true`: `/api`, `/health`, `/__dev`, `/mcp`, and
`/.well-known`. The data and auth API surface lives under `/api`; `/mcp` and
`/.well-known` let local MCP clients use the same web origin. Crucially,
`/items`, `/query`, `/tokens`, and `/connection` are **not** proxied — those are
the web app's own client-side routes, so a refresh or deep link falls through to
Vite and loads the SPA instead of returning the API's JSON. Because of this:

- the SDK is created with `baseUrl: "/api"` and `credentials: "include"`, and
- the Better Auth client uses `baseURL: "/api/auth"`.

## Scripts

- `pnpm --filter @keva/web dev` — Vite dev server.
- `pnpm --filter @keva/web build` — production build (`vite build`).
- `pnpm --filter @keva/web typecheck` — `tsc --noEmit`.
