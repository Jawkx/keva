# AGENTS.md

Keva — metadata-rich, S3-backed object storage for people, applications, and agents.

## Layout

pnpm + Turborepo monorepo (Node 22+, pnpm 11+).

- `apps/server` — `@keva/server` (Hono API, runs on Workerd/Wrangler)
- `apps/web` — `@keva/web` (web UI)
- `packages/core` — `@keva/core` (DB schema + migrations, Drizzle)
- `packages/mcp` — `@keva/mcp` (MCP server, OAuth 2.1)
- `packages/schema` — `@keva/schema` (shared schemas)
- `packages/sdk` — `@keva/sdk` (`KevaClient`)

## Commands

- Install: `pnpm install`
- Dev (all): `pnpm dev` — or `pnpm dev:app`, `pnpm dev:server`, `pnpm dev:web`
- Build: `pnpm build`
- Typecheck: `pnpm typecheck`
- Test: `pnpm test`
- Lint: `pnpm lint` (oxlint + custom checks); autofix: `pnpm lint:fix`
- Format: `pnpm format` / check with `pnpm format:check` (oxfmt)
- DB: `pnpm db:generate`, `pnpm db:migrate` (set `DATABASE_URL` first)

Run the server locally with `pnpm --filter @keva/server dev` after configuring
`KEVA_STATIC_TOKEN`, `DATABASE_URL`, and the required `S3_*` values. The server
always uses Postgres metadata and S3-compatible blob storage and fails closed
when their configuration is incomplete.

## Conventions

- Prefer `pnpm --filter <pkg> <script>` for package-scoped work.
- Do not add code comments unless necessary: only for constraints or invariants the
  code cannot express itself (max 1–2 lines). Never narrate what the code does, why a
  change is correct, or restate names/types.
- Do not call `useEffect` directly — enforced by `pnpm lint:no-direct-use-effect`.
- SDK base URL points at the `/api` prefix, not the server root.
- Run `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` before finishing changes.
