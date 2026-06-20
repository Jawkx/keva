# Object lifecycle

keva stores meaning in Postgres and bytes in S3-compatible storage — two systems
with **no shared transaction**. The trust guarantees ("your files are safe, and
what the system says about them is true") therefore rest on an explicit state
machine with idempotent, crash-safe transitions. `pending | ready` is not enough;
this is the full model.

## States

| State | Meaning | Bytes |
|---|---|---|
| `pending` | record created; a presigned PUT to the **staging** key has been issued; awaiting upload + confirm | none, or in staging |
| `ready` | bytes copied to the **immutable final** key; system attributes reflect the real object | at final key |
| `deleting` | deletion intent recorded; no longer served; blobs being removed | being removed |

Reads (`GET`, `query`) only ever return `ready` objects. `pending` and
`deleting` are invisible to clients (treated as `NotFound`).

```
   initiate
      │
      ▼
   pending ───────────(reaper: created_at < now − TTL)──────────► deleting
      │                                                              ▲
      │ confirm                                                      │ DELETE
      │  HEAD staging → validate → CopyObject staging→final          │
      │  → flip to ready (atomic) → best-effort delete staging       │
      ▼                                                              │
    ready ─────────────────────────(DELETE)──────────────────────────┘
                                                                     │
                                          sweeper: delete final(+staging) blobs,
                                          then remove row
                                                                     ▼
                                                                  (gone)
```

## Why staging → copy → final (immutability)

A presigned PUT is **replayable until it expires** — the holder can overwrite the
key repeatedly, including *after* confirmation, and an exact `Content-Length`
does not stop a same-sized replacement (documented S3 behavior). So:

- The presigned PUT targets a **staging key** only: `staging/<tenantId>/<id>`.
- Confirm performs a **server-side `CopyObject`** to the **final key**
  `objects/<tenantId>/<id>`, then deletes staging.
- **No presigned PUT is ever issued for the final key**, so a `ready` object's
  bytes cannot be overwritten by a client. Replaying the staging URL only rewrites
  staging, which is already copied and slated for deletion.

`CopyObject` is server-side (S3-internal; the server issues one signed REST call,
no bytes transit it) and covers single objects up to 5 GB — matching the
single-PUT cap. Multipart copy is deferred with multipart upload.

## Confirm: idempotent and retry-safe

`POST /objects/:id/confirm` is safe to call repeatedly:

1. If the row is already `ready` → return it (no-op success).
2. If `pending`:
   a. `HEAD` the staging object; if absent → `Conflict` (nothing uploaded).
   b. Validate declared vs. actual `size`/`etag`; mismatch → `ValidationError`.
   c. `CopyObject` staging → final (idempotent; identical bytes, same final key).
   d. Atomically claim the transition:
      `UPDATE objects SET status='ready', size=…, etag=…, updated_at=now()
       WHERE id=:id AND tenant_id=:t AND status='pending'`.
      If it affects 0 rows, someone else won (or it was reaped) → re-read and
      return the current state (or `Conflict` if now `deleting`).
   e. Best-effort delete staging; failure is non-fatal — the reaper mops staging.

Ordering matters: **copy before the DB flip.** If the process dies after copy but
before the flip, a retry re-copies (idempotent) and flips; the final object
already exists. If it dies before copy, the row stays `pending` and is retried or
reaped. There is never a `ready` row without final bytes.

## Delete: two-phase, no orphans

Deletion can't be atomic across stores, so intent is recorded first:

1. Atomically record intent:
   `UPDATE objects SET status='deleting' WHERE id=:id AND tenant_id=:t AND status IN ('ready','pending')`.
   The object immediately stops being served.
2. Delete blobs (final key; staging if present). Deleting an absent object is a
   no-op success (idempotent).
3. Remove the row.

If the process crashes after step 1, a **sweeper** finds `deleting` rows and
completes steps 2–3. Because intent is durable *before* any blob delete, and the
sweeper finishes interrupted deletes, there are **no orphaned blobs and no
dangling rows**.

## Reaper vs. confirm race

The reaper expires stale `pending` uploads. Confirm may arrive concurrently —
resolved by conditional updates over the same row, so exactly one wins:

- **Reaper:** `UPDATE … SET status='deleting' WHERE id=:id AND status='pending' AND created_at < now()−TTL`.
- **Confirm (step d):** `UPDATE … SET status='ready' WHERE id=:id AND status='pending'`.

Whichever runs first flips `status` out of `pending`; the other's conditional
update affects 0 rows and yields gracefully:

- Reaper wins → confirm sees 0 rows, returns `Conflict` (upload expired).
- Confirm wins → reaper sees 0 rows, skips it.

A reaped `deleting` row is then finished by the sweeper (delete staging blob,
remove row), identical to a normal delete.

## Failure & edge cases

- **Never uploaded / never confirmed** → row stays `pending` → reaped after TTL.
- **Upload fails mid-PUT** → a single S3 PUT is atomic, so staging holds either
  the complete object or nothing; either way the reaper cleans it.
- **Copy succeeds, flip fails** → retry re-copies + flips; idempotent.
- **Partial delete** (blob delete half-failed) → row remains `deleting`; the
  sweeper retries until storage confirms gone, then removes the row.
- **Confirm after expiry** → `Conflict`; the client re-initiates.

## Background jobs

Two periodic, idempotent jobs (a scheduled worker / cron):

- **Reaper** — expires `pending` rows past TTL → `deleting`.
- **Sweeper** — finishes `deleting` rows (delete blobs, remove row).

Both are pure functions of durable Postgres state, which is exactly why
[durable metadata must precede real blob storage](./roadmap.md) — without it,
neither job can discover what to clean.
