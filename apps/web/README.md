# @keva/web

Phase-4 consumer dashboard for **keva** — a Vite + React + TypeScript SPA.

It talks to the keva API entirely over relative URLs. In development, Vite
proxies every API path prefix to the API so the browser only ever talks to a
single same-origin host (`http://localhost:5173`). That keeps the Better Auth
session cookie first-party, which is required for cookie-based session auth.

## Pages

- `/login`, `/signup` — Better Auth email + password. On success → `/`.
- `/` — Files: lists objects (`keva.query()`), upload modal, row links to detail.
- `/objects/:id` — metadata, attributes editor (set/edit/unset scalar attrs),
  Download (blob), Delete.
- `/query` — condition builder (key / operator / value) → `keva.query()`.
- `/tokens` — list/mint/revoke API tokens (plaintext shown once on mint).

Authed routes are guarded by `authClient.useSession()`; no session redirects to
`/login`. A `401 / Unauthorized` from any API call also bounces to `/login`.

## Dev stack (two terminals)

The SPA needs the API (which needs Postgres). Because the dev proxy makes
everything same-origin, the API must emit **relative** loopback blob-upload URLs
(`KEVA_LOOPBACK_BASE_URL=""`) so the upload `PUT` also flows through the Vite
proxy.

### Terminal 1 — API (port 8787)

```sh
KEVA_STATIC_TOKEN=dev-token \
BETTER_AUTH_SECRET=dev-secret-change-me \
DATABASE_URL=postgres://localhost:5432/keva \
KEVA_LOOPBACK_BASE_URL="" \
pnpm --filter @keva/server dev
```

(Adjust `DATABASE_URL` to your local Postgres. `KEVA_LOOPBACK_BASE_URL=""` is
the important bit — it makes the API's blob upload/download URLs relative so
they pass through the Vite proxy.)

### Terminal 2 — web (port 5173)

```sh
pnpm --filter @keva/web dev
```

Then open http://localhost:5173.

## Proxy

`vite.config.ts` proxies these prefixes to `http://127.0.0.1:8787` with
`changeOrigin: true`: `/api`, `/health`, `/__dev`. The whole API surface
(including auth) lives under `/api`. Crucially, `/objects`, `/query` and
`/tokens` are **not** proxied — those are the web app's own client-side routes,
so a refresh or deep link falls through to Vite and loads the SPA instead of
returning the API's JSON. Because of this:

- the SDK is created with `baseUrl: "/api"` and `credentials: "include"`, and
- the Better Auth client uses `baseURL: "/api/auth"`.

## Scripts

- `pnpm --filter @keva/web dev` — Vite dev server.
- `pnpm --filter @keva/web build` — production build (`vite build`).
- `pnpm --filter @keva/web typecheck` — `tsc --noEmit`.
