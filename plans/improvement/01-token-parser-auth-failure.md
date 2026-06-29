# Plan 01: API tokens authenticate reliably (fix the token parser)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/improvement/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9c454b4..HEAD -- apps/server/src/auth.ts apps/server/src/tokens.test.ts`
> If `apps/server/src/auth.ts` changed since this plan was written, compare the
> "Current state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (auth / correctness)
- **Planned at**: commit `9c454b4`, 2026-06-30

## Why this matters

API tokens (`keva_sk_<id>_<secret>`) are how every machine, agent, SDK, and MCP
client authenticates to keva — the entire programmable surface the product
exists for. The token store mints a token by storing `id` (the part before the
first `_`) and a hash of `secret`, but the resolver parses the token with a
**greedy** regex that splits on the **last** `_`. Because `id` and `secret` are
base64url (which contains `_` and `-`), the parsed `id` does not equal the
stored `id` whenever the secret (or id) contains an underscore — which happens
for **~48% of minted tokens** (empirically measured: a 43‑char base64url secret
contains a `_` about half the time). Those tokens look valid to the user but the
`WHERE id = …` lookup finds no row, so the request fails with `Unauthorized`.

The existing token test does **not** catch this: it substitutes a different
in-memory store (`makeInMemoryTokenStore` in `tokens.test.ts`) that uses
hex-only ids (`crypto.randomUUID().replaceAll("-","")`) and a different,
first-underscore regex. The real `makePostgresApiTokenStore` parser is never
exercised against a real minted token.

After this plan: tokens use a delimiter-free (hex) alphabet, the resolver parses
unambiguously on the single `_` separator, and a deterministic test proves the
mint→parse round-trip for many tokens so this can never regress.

## Current state

- `apps/server/src/auth.ts` — the only file with the bug. Three relevant pieces:

  **(a) `randomTokenPart` (lines ~122–127)** emits base64url, which includes `_` and `-`:
  ```ts
  const randomTokenPart = (bytes: number): string => {
    const value = crypto.getRandomValues(new Uint8Array(bytes));
    let binary = "";
    for (const byte of value) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  };
  ```

  **(b) `mint` (lines ~216–235)** builds `keva_sk_${id}_${secret}` and stores the
  raw `id` (the value before the first `_`) plus `hashSecret(secret)`:
  ```ts
  const id = randomTokenPart(9);
  const secret = randomTokenPart(32);
  const plaintext = `keva_sk_${id}_${secret}`;
  const secretHash = await hashSecret(secret);
  // ... insert into api_tokens (id, ...) values (${id}, ...)
  ```

  **(c) `resolve` (lines ~186–198)** — the greedy regex that mis-splits:
  ```ts
  const match = /^keva_sk_([a-zA-Z0-9_-]+)_([a-zA-Z0-9_-]+)$/.exec(token);
  if (!match) return null;
  const [, id, secret] = match;
  const rows = await sql<TokenRow[]>`
    select * from api_tokens where id = ${id!} limit 1
  `;
  const row = rows[0];
  if (!row || (row.expires_at && new Date(row.expires_at) <= new Date())) {
    return null;
  }
  const candidate = await hashSecret(secret!);
  if (!secureEqual(candidate, row.secret_hash)) return null;
  ```

- **Why the fix below is safe across both stores**: `hashSecret` produces a
  64-char hex string and `secureEqual` already short-circuits on length, so
  changing the *plaintext* alphabet does not affect stored hashes. Any token
  previously minted that actually worked had no `_` in it, so it still parses
  correctly under the new `[^_]+` regex; tokens that contained `_` never
  authenticated anyway. There is no data migration.

- **Convention to match**: the codebase uses `postgres.js` tagged-template
  parameterization for all SQL (never string interpolation) — keep using
  `${parsed.id}` as a bound parameter exactly as the current code does. Tests
  use `vitest` with files colocated as `src/*.test.ts` (see
  `apps/server/src/tokens.test.ts`).

## Commands you will need

| Purpose            | Command                                   | Expected on success |
|--------------------|-------------------------------------------|---------------------|
| Install            | `pnpm install`                            | exit 0              |
| Typecheck (server) | `pnpm --filter @keva/server typecheck`    | exit 0, no errors   |
| Test (server)      | `pnpm --filter @keva/server test`         | all pass            |
| Lint (whole repo)  | `pnpm lint`                               | exit 0              |

(All verified from `apps/server/package.json`: `test` = `vitest run src`,
`typecheck` = `tsc -p tsconfig.json --noEmit`.)

## Scope

**In scope** (the only files you may modify):
- `apps/server/src/auth.ts`
- `apps/server/src/token-format.test.ts` (create)
- `plans/improvement/README.md` (status row only)

**Out of scope** (do NOT touch):
- `apps/server/src/tokens.test.ts` — its substitute store is intentional; leave it.
- `apps/server/src/app.ts`, `runtime.ts` — the wiring is correct.
- The `api_tokens` SQL schema / migrations — no schema change is needed.
- `hashSecret` and `secureEqual` — leave them exactly as they are.

## Git workflow

- Branch: `advisor/01-token-parser` (do not commit on `master`/`main`).
- One commit is fine. Message style matches `git log` (short imperative, no
  conventional-commit prefix), e.g. `Fix API token parsing for tokens with
  underscores`. End the commit body with the repo's `Co-Authored-By` trailer if
  you commit (see repository instructions); otherwise leave commits to the operator.
- Do NOT push or open a PR unless the operator asks.

## Steps

### Step 1: Make token parts delimiter-free (hex)

In `apps/server/src/auth.ts`, replace the body of `randomTokenPart` so it emits
lowercase hex (no `_`, `-`, `+`, `/`). The byte counts stay the same, so entropy
is unchanged (still 9 random bytes for the id, 32 for the secret):

```ts
const randomTokenPart = (bytes: number): string => {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};
```

**Verify**: `pnpm --filter @keva/server typecheck` → exit 0.

### Step 2: Add a single, unambiguous parser and export both helpers

Still in `apps/server/src/auth.ts`, add a pure `parseTokenParts` function next to
`randomTokenPart`, and **export both** `randomTokenPart` and `parseTokenParts`
(Step 4's test imports them). The separator is the single `_` between two
underscore-free parts:

```ts
const TOKEN_PATTERN = /^keva_sk_([^_]+)_([^_]+)$/;

export const parseTokenParts = (
  token: string,
): { id: string; secret: string } | null => {
  const match = TOKEN_PATTERN.exec(token);
  return match ? { id: match[1]!, secret: match[2]! } : null;
};
```

Change `const randomTokenPart` to `export const randomTokenPart`.

**Verify**: `pnpm --filter @keva/server typecheck` → exit 0.

### Step 3: Use the parser in `resolve`

In `resolve` (inside `makePostgresApiTokenStore`), replace the regex+destructure
block with a call to `parseTokenParts`. The rest of `resolve` (the DB lookup,
expiry check, `hashSecret` + `secureEqual`, last-used update) stays identical —
only the parsing changes:

```ts
const parsed = parseTokenParts(token);
if (!parsed) return null;
const rows = await sql<TokenRow[]>`
  select * from api_tokens where id = ${parsed.id} limit 1
`;
const row = rows[0];
if (!row || (row.expires_at && new Date(row.expires_at) <= new Date())) {
  return null;
}
const candidate = await hashSecret(parsed.secret);
if (!secureEqual(candidate, row.secret_hash)) return null;
```

**Verify**: `pnpm --filter @keva/server typecheck` → exit 0, and
`grep -n "keva_sk_(\[a-zA-Z0-9" apps/server/src/auth.ts` → no matches (the old
greedy regex is gone).

### Step 4: Add a deterministic round-trip test

Create `apps/server/src/token-format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseTokenParts, randomTokenPart } from "./auth.js";

describe("API token format", () => {
  it("round-trips minted token parts through the parser", () => {
    for (let i = 0; i < 2000; i++) {
      const id = randomTokenPart(9);
      const secret = randomTokenPart(32);
      const token = `keva_sk_${id}_${secret}`;
      expect(parseTokenParts(token)).toEqual({ id, secret });
    }
  });

  it("emits a delimiter-free alphabet so the single '_' separator is unambiguous", () => {
    for (let i = 0; i < 2000; i++) {
      expect(/[_-]/.test(randomTokenPart(16))).toBe(false);
    }
  });

  it("returns null for malformed tokens", () => {
    expect(parseTokenParts("nope")).toBeNull();
    expect(parseTokenParts("keva_sk_onlyonepart")).toBeNull();
    expect(parseTokenParts("")).toBeNull();
  });
});
```

This fails on the pre-fix code (the old alphabet emits `_`/`-` and the old regex
mis-splits) and passes after Steps 1–3.

**Verify**: `pnpm --filter @keva/server test` → all pass, including the 3 new tests.

## Test plan

- New file `apps/server/src/token-format.test.ts` covers: (1) mint→parse
  round-trip over 2000 random tokens (the specific regression), (2) the alphabet
  invariant (no `_`/`-`), (3) malformed-token rejection.
- Structural pattern to follow: the plain `describe/it/expect` style already in
  `apps/server/src/tokens.test.ts`.
- Full verification: `pnpm --filter @keva/server test` → all pass.

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @keva/server typecheck` exits 0
- [ ] `pnpm --filter @keva/server test` exits 0; the 3 new tests in
      `token-format.test.ts` exist and pass
- [ ] `pnpm lint` exits 0
- [ ] `grep -rn "a-zA-Z0-9_-" apps/server/src/auth.ts` returns no matches
      (old token regex removed)
- [ ] `git status` shows only `apps/server/src/auth.ts`,
      `apps/server/src/token-format.test.ts`, and
      `plans/improvement/README.md` modified/created
- [ ] `plans/improvement/README.md` status row for plan 01 updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts in `auth.ts` don't match the live code (it has
  drifted; the token format may already have been changed).
- `mint` no longer constructs `keva_sk_${id}_${secret}` or stores `id`/`secret`
  the way described — the parser fix must stay consistent with how `mint` splits.
- Any existing test in `apps/server/src/tokens.test.ts` starts failing — that
  store is independent of your change, so a failure means something unexpected.

## Maintenance notes

- For the reviewer: confirm `mint` and `parseTokenParts` agree on the format
  (`keva_sk_` + id + `_` + secret, both parts underscore-free) and that
  `hashSecret`/`secureEqual` were untouched.
- Deferred (optional follow-up, not in this plan): a DB-gated end-to-end test
  that mints through `makePostgresApiTokenStore` and resolves the real token,
  guarded by `KEVA_TEST_DATABASE_URL` like `packages/core/src/postgres.test.ts`.
  The pure round-trip test here already locks the regression; the DB test would
  add belt-and-suspenders coverage of the `resolve` SQL path.
- If the token format is ever revisited (e.g. adding a checksum), keep the parts
  delimiter-free or change the delimiter to a character the alphabet excludes —
  the original bug was an ambiguous delimiter, not the regex itself.
