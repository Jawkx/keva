# keva

Metadata-rich, S3-backed object storage for people, applications, and agents.

## Local development

Requirements: Node.js 22+, pnpm 11+, and optionally Postgres and an
S3-compatible bucket.

```sh
pnpm install
pnpm build
KEVA_RUNTIME_MODE=local-memory KEVA_STATIC_TOKEN=dev-secret pnpm --filter @keva/server dev
```

`local-memory` opts into the development in-memory metadata and signed loopback
blob adapters. Use `persistent` only with both `DATABASE_URL` and complete S3
configuration. See [`apps/server/.env.example`](./apps/server/.env.example).

## Storage lifecycle

Production cleanup runs every five minutes: abandoned pending uploads and
deleting items are removed, and ready items are reconciled against their staging
objects. Configure a bucket lifecycle rule to expire the `staging/` prefix only
after a period longer than the maximum upload and confirmation window; it is a
defense in depth measure, not the primary cleanup path.

```ts
import { KevaClient } from "@keva/sdk";

const keva = new KevaClient({
  baseUrl: "http://127.0.0.1:8787/api",
  token: "dev-secret",
});

const item = await keva.upload(
  {
    name: "hello.txt",
    contentType: "text/plain",
    size: 5,
    properties: {
      finance: null,
      department: "finance",
      people: ["alice", "bob"],
    },
  },
  new TextEncoder().encode("hello"),
);
```

Custom properties are bare tags (`null`), non-empty strings, or non-empty arrays
of unique strings. Arrays are unordered. Numeric-looking and boolean-looking
metadata remains text; typed comparisons are reserved for system fields such as
`system.size`. Setting a property to `null` applies a tag. Remove a property with
the patch API's `unset` field.

The SDK base URL should point at the API prefix (`/api`), not the server root.
Item responses intentionally exclude tenant IDs and physical storage keys. The
private `@keva/sdk` is currently `0.0.0` and unpublished, so these internal
fields were removed immediately rather than carried through a deprecation period.

## MCP uploads

MCP clients authorized with `keva:write` have two upload paths:

- `upload_content` uploads UTF-8 text or base64-encoded content in one tool call.
  The decoded content is limited to 1 MiB. Base64 input must be the encoded data
  only, without a `data:` URL prefix.
- `begin_upload` and `complete_upload` support files up to 5 GiB. This path
  requires the MCP host to make an HTTP `PUT` request to the presigned storage
  URL returned by `begin_upload`.

For the large-file path:

1. Call `begin_upload` with the file name, MIME type, and exact byte size.
2. `PUT` exactly that many bytes to the returned `uploadUrl`, using every header
   from the returned `headers` object unchanged.
3. Do not send the Keva OAuth token, cookies, or other Keva credentials to the
   storage URL. The presigned URL is the authorization for that upload.
4. After the `PUT` succeeds with a 2xx response, call `complete_upload` with the
   pending item's ID.

Do not call `complete_upload` before a successful `PUT`. The presigned URL is
short-lived; if it expires, start a new upload. Pending uploads that are never
completed are removed by the storage lifecycle cleanup.

```sh
# Values come from begin_upload. Header names and values vary by storage backend.
curl --fail-with-body --request PUT \
  --header 'Content-Type: application/octet-stream' \
  --data-binary @./archive.zip \
  'https://presigned-storage-url.example/...'
```

## Local admin console

The quota console is a local operator tool. Start the Node API with persistent
database/S3 settings and a short-lived `KEVA_ADMIN_TOKEN`; it binds only to
loopback. In another terminal run `pnpm --filter @keva/admin dev`, open
`http://127.0.0.1:5174`, enter the runtime token, and stop both processes when
finished. Never deploy the admin app or expose the admin API beyond loopback.

## Database

Set `DATABASE_URL`, then run `pnpm db:migrate`. The checked-in migrations include
keva metadata/API-token tables, the Better Auth organization/session tables, and
the OAuth tables (`oauth_application`, `oauth_access_token`, `oauth_consent`) that
back the MCP server's OAuth 2.1 authorization. Regenerate the Better Auth schema
with `pnpm --filter @keva/server auth:generate` after changing auth plugins, then
`pnpm db:generate` to produce the migration.
