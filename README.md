# keva

Metadata-rich, S3-backed object storage for people, applications, and agents.

## Local development

Requirements: Node.js 22+, pnpm 11+, and optionally Postgres and an
S3-compatible bucket.

```sh
pnpm install
pnpm build
KEVA_STATIC_TOKEN=dev-secret pnpm --filter @keva/server dev
```

With no database or S3 environment variables, the server uses the development
in-memory metadata and signed loopback blob adapters. See
[`apps/server/.env.example`](./apps/server/.env.example) for persistent
Postgres and S3 configuration.

```ts
import { KevaClient } from "@keva/sdk";

const keva = new KevaClient({
  baseUrl: "http://127.0.0.1:8787/api",
  token: "dev-secret",
});

const item = await keva.upload(
  { name: "hello.txt", contentType: "text/plain", size: 5 },
  new TextEncoder().encode("hello"),
);
```

The SDK base URL should point at the API prefix (`/api`), not the server root.

## Database

Set `DATABASE_URL`, then run `pnpm db:migrate`. The checked-in migration includes
both keva metadata/API-token tables and the Better Auth organization/session
tables needed by phase 4. Regenerate the Better Auth schema with
`pnpm --filter @keva/server auth:generate` after changing auth plugins.
