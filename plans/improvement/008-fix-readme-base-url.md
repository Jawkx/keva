# Plan 008: Fix the README SDK Base URL

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat a471073..HEAD -- README.md apps/web/README.md packages/sdk/src/index.ts`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs, dx
- **Planned at**: commit `a471073`, 2026-06-27

## Why this matters

The root README is the first local-development path. It currently shows an SDK `baseUrl` without `/api`, but the server routes live under `/api` and the SDK appends `/objects`, `/query`, and related paths to the supplied base URL. A user following the README will hit `/objects` on the server instead of `/api/objects`.

## Current state

- README example:

```ts
// README.md:21-27
import { KevaClient } from "@keva/sdk";

const keva = new KevaClient({
  baseUrl: "http://127.0.0.1:8787",
  token: "dev-secret",
});
```

- SDK initiate path appends `/objects`:

```ts
// packages/sdk/src/index.ts:109-112
async initiate(input: InitiateUploadType) {
  const body = decode(InitiateUpload, input);
  return this.#request("POST", "/objects", InitiateUploadResult, body);
}
```

- Web README already documents the correct API base shape:

```md
// apps/web/README.md
the SDK is created with baseUrl: "/api" and credentials: "include"
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Docs inspection | `rg -n "baseUrl: .*8787|baseUrl: .*api|/api" README.md apps/web/README.md` | root example uses `/api`; web docs remain consistent |
| Optional SDK test | `pnpm --filter @keva/sdk test` | all tests pass |

## Scope

**In scope**:
- `README.md`
- `apps/web/README.md` only if wording needs to stay consistent

**Out of scope**:
- SDK code changes.
- Server route changes.
- Web app behavior changes.

## Git workflow

- Branch: `advisor/008-fix-readme-base-url`
- Commit message style: plain imperative, for example `Fix README SDK base URL`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Correct the root README SDK example

Change the root README example to:

```ts
const keva = new KevaClient({
  baseUrl: "http://127.0.0.1:8787/api",
  token: "dev-secret",
});
```

Keep the rest of the example unchanged unless it conflicts with Plan 002 after that plan lands.

**Verify**: `rg -n 'baseUrl: "http://127.0.0.1:8787/api"' README.md` -> one match.

### Step 2: Add one sentence explaining the API prefix

Add a short sentence near the example:

```md
The SDK base URL should point at the API prefix (`/api`), not the server root.
```

Do not add a long architecture explanation.

**Verify**: `rg -n "API prefix|/api" README.md` -> at least one relevant match near the example.

### Step 3: Check docs consistency

Run:

```sh
rg -n "baseUrl:" README.md apps/web/README.md
```

Confirm all SDK examples use either an absolute URL ending in `/api` or the relative `"/api"` base used by the web app.

**Verify**: command output contains no SDK example using bare `http://127.0.0.1:8787` as `baseUrl`.

## Test plan

- Markdown-only change; no runtime test is required.
- Optional: run `pnpm --filter @keva/sdk test` if SDK examples were adjusted beyond README wording.

## Done criteria

- [ ] Root README SDK example uses `http://127.0.0.1:8787/api`.
- [ ] README explains that SDK base URL points at the API prefix.
- [ ] No docs example still uses the server root as SDK `baseUrl`.
- [ ] `plans/improvement/README.md` status row for plan 008 is updated.

## STOP conditions

Stop and report if:

- Source code changed so the SDK now expects the server root instead of `/api`.
- Plan 002 has already landed and renamed SDK methods in a way that makes the README example invalid; update the example to the new method names, but keep the `/api` base URL.

## Maintenance notes

When API route prefixes change, update SDK examples in root README and web README in the same PR. The SDK deliberately takes a base URL and appends endpoint paths, so examples must include any route prefix.

