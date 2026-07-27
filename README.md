# keva

Metadata-rich, S3-backed object storage for people, applications, and agents.

## Local development

Requirements: Node.js 22+, pnpm 11+, Postgres, and an S3-compatible bucket.

Use an existing Postgres installation by setting `DATABASE_URL`. On macOS with
Homebrew, start it with `brew services start postgresql@14` (replace `14` with
your installed version). Alternatively, start the provided container with
`pnpm dev:postgres`; this requires Docker Desktop, Colima, or another running
Docker daemon.

```sh
pnpm install
pnpm build
cp apps/server/.env.example apps/server/.env
# Configure DATABASE_URL and the S3_* values in apps/server/.env, then:
pnpm db:migrate
pnpm dev:app
```

The server always uses Postgres for metadata and S3-compatible storage for blobs.
It fails to start when either configuration is incomplete. See
[`apps/server/.env.example`](./apps/server/.env.example).

### Local billing

Development and staging share the Polar sandbox catalog but use separate access
tokens and webhook secrets. Create a sandbox organization access token, configure
all `POLAR_*` values shown in `apps/server/.env.example`, then start the webhook
listener:

```sh
pnpm polar:listen
```

Select **Sandbox** and the Keva sandbox organization when prompted by the
listener. Copy its generated secret to `POLAR_WEBHOOK_SECRET` in
`apps/server/.env`, then start the app in another terminal with `pnpm dev:app`.
The listener forwards events to
`http://127.0.0.1:8787/api/auth/polar/webhooks`.

Polar customer emails are unique within an organization. Use distinct aliases
for each environment, such as `name+dev@example.com` and
`name+staging@example.com`. Sandbox checkout accepts Stripe test card
`4242 4242 4242 4242` with any future expiration date and CVC.

## Storage lifecycle

Production cleanup runs every five minutes: abandoned pending uploads and
deleting items are removed, and ready items are reconciled against their staging
objects. A bucket lifecycle rule expiring the `staging/` prefix after a period
longer than the maximum upload and confirmation window is required. Durable
upload-attempt tombstones remain until each presigned URL expires.

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

An item is one immutable file. Its bytes never change after it becomes ready;
every upload creates a new item, names are non-unique labels, and uploading the
same name does not replace anything. Keva does not provide built-in file
versioning. Send a unique `Retry-Key` header (or `retryKey` field) when initiating
an upload to make a lost-response retry return the same item; reusing it for
different details returns a conflict. Metadata responses include `revision`;
patches may include `expectedRevision` to reject stale edits, while omitting it
keeps last-writer-wins behavior.

Apply one property patch to multiple items with `patchMany`. Bulk patches accept
up to 1,000 unique items and report successes and typed failures separately, so
one missing or stale item does not prevent the others from updating:

```ts
await keva.patchMany([firstId, secondId], {
  set: { project: "alpha", reviewed: null },
  unset: ["draft"],
});

await keva.patchMany(
  [
    { id: firstId, expectedRevision: 3 },
    { id: secondId, expectedRevision: 8 },
  ],
  { set: { status: "approved" } },
);
```

The equivalent MCP tool is `set_properties_bulk` and requires the `keva:write`
scope.

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

## Database

Set `DATABASE_URL`, then run `pnpm db:migrate`. The checked-in migrations include
keva metadata/API-token tables, the Better Auth organization/session tables, and
the OAuth tables (`oauth_application`, `oauth_access_token`, `oauth_consent`) that
back the MCP server's OAuth 2.1 authorization. Regenerate the Better Auth schema
with `pnpm --filter @keva/server auth:generate` after changing auth plugins, then
`pnpm db:generate` to produce the migration.
