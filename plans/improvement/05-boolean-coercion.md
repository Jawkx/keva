# Plan 05: Boolean value coercion is correct (and defined once)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/improvement/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9c454b4..HEAD -- apps/web/src/lib/properties.ts apps/web/src/pages/QueryPage.tsx`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (correctness) + tech-debt (duplication)
- **Planned at**: commit `9c454b4`, 2026-06-30

## Why this matters

Two places coerce a typed text input into a boolean using `raw !== "false"`,
which is `true` for **every** string except the exact literal `"false"`. So an
empty field, `"0"`, `"FALSE"`, `"False"`, or a typo all silently become `true`.
This affects two user-facing surfaces:

- **Query builder** (`QueryPage.tsx`): a boolean query condition gets the wrong
  value, so the query filters on the opposite/garbage truth value.
- **Property editor** (`lib/properties.ts` → used by `PropertiesEditor`): editing
  a boolean property writes the wrong value to the item.

The logic is duplicated, so it must be fixed in both — and the duplication
itself is worth removing so the two surfaces can't drift again. After this plan,
boolean coercion is `=== "true"` (case-insensitive, trimmed) and lives in a
single shared helper.

## Current state

**`apps/web/src/lib/properties.ts`** (lines ~54–62) — the canonical helper:
```ts
export const coerceScalar = (type: ScalarType, raw: string): PropertyValue => {
  if (type === "null") return null;
  if (type === "boolean") return raw.trim() !== "false";   // <-- bug
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return raw;
};
```
`ScalarType` is `"string" | "number" | "boolean" | "null"` (defined in the same file).

**`apps/web/src/pages/QueryPage.tsx`** (lines ~75–82) — a duplicate, minus `null`:
```ts
const coerceValue = (type: ValueType, raw: string): string | number | boolean => {
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === "boolean") return raw !== "false";          // <-- bug (also no trim)
  return raw;
};
```
In `QueryPage.tsx`, `ValueType` is the local type `"string" | "number" | "boolean"`
(line ~58) — a subset of `properties.ts`'s `ScalarType`, so `coerceScalar`
accepts it. `QueryPage.tsx` does **not** currently import from `../lib/properties`.

## Commands you will need

| Purpose            | Command                                | Expected |
|--------------------|----------------------------------------|----------|
| Install            | `pnpm install`                         | exit 0   |
| Typecheck (web)    | `pnpm --filter @keva/web typecheck`    | exit 0   |
| Build (web)        | `pnpm --filter @keva/web build`        | exit 0   |
| Lint (whole repo)  | `pnpm lint`                            | exit 0   |

(`apps/web` has no test runner — verification is typecheck + build + lint + the
behavior table in "Test plan", confirmed by reading the final code.)

## Scope

**In scope** (the only files you may modify):
- `apps/web/src/lib/properties.ts`
- `apps/web/src/pages/QueryPage.tsx`
- `plans/improvement/README.md` (status row only)

**Out of scope** (do NOT touch):
- `apps/web/src/components/PropertiesEditor.tsx` — it already calls
  `coerceScalar`; fixing the helper fixes it for free. Do not change it.
- The schema/server-side validation in `packages/schema` — unchanged.
- The `inferScalarType` helper in `properties.ts` — leave it as is.

## Git workflow

- Branch: `advisor/05-boolean-coercion`.
- One commit. Short imperative message (match `git log`),
  e.g. `Fix boolean coercion and share it between query and property editors`.
- Do NOT push or open a PR unless the operator asks.

## Steps

### Step 1: Fix the canonical helper

In `apps/web/src/lib/properties.ts`, change the boolean branch of `coerceScalar`:

```ts
  if (type === "boolean") return raw.trim().toLowerCase() === "true";
```

This makes only `"true"`/`"True"`/`"TRUE"` (trimmed) coerce to `true`; empty and
everything else → `false`.

**Verify**: `pnpm --filter @keva/web typecheck` → exit 0.

### Step 2: Remove the duplicate in QueryPage and use the shared helper

In `apps/web/src/pages/QueryPage.tsx`:

1. Add an import (with the other `../lib/...` imports near the top):
   ```ts
   import { coerceScalar } from "../lib/properties";
   ```
2. Delete the local `coerceValue` function (the ~8-line block shown in "Current
   state").
3. Replace every call to `coerceValue(` with `coerceScalar(`. Find them with:
   ```sh
   grep -n "coerceValue" apps/web/src/pages/QueryPage.tsx
   ```
   There should be no `coerceValue` references left afterward (verify with the
   same grep → no output).

Because `QueryPage`'s `ValueType` (`"string" | "number" | "boolean"`) is a subset
of `ScalarType`, `coerceScalar(type, raw)` typechecks unchanged. Its return type
(`PropertyValue`) is what the query `where` values already expect.

**Verify**:
- `grep -n "coerceValue" apps/web/src/pages/QueryPage.tsx` → no output.
- `pnpm --filter @keva/web typecheck` → exit 0.
- `pnpm --filter @keva/web build` → exit 0.

## Test plan

No web test runner exists, so verify behavior by reading the final
`coerceScalar` and confirming this table holds (it is pure string logic):

| `type`    | `raw`     | result (after fix) | result (before fix) |
|-----------|-----------|--------------------|---------------------|
| `boolean` | `"true"`  | `true`             | `true`              |
| `boolean` | `"True"`  | `true`             | `true`              |
| `boolean` | `"false"` | `false`            | `false`             |
| `boolean` | `"False"` | `false`            | **`true`** (bug)    |
| `boolean` | `""`      | `false`            | **`true`** (bug)    |
| `boolean` | `"0"`     | `false`            | **`true`** (bug)    |

Both call sites (query builder and property editor) now route through this one
function, so the table applies to both.

(Recommended follow-up, out of scope: add `vitest` to `apps/web` and a unit test
for `coerceScalar` covering the rows above. The repo has no web test harness today.)

## Done criteria

ALL must hold:

- [ ] `pnpm --filter @keva/web typecheck` exits 0
- [ ] `pnpm --filter @keva/web build` exits 0
- [ ] `pnpm lint` exits 0
- [ ] `grep -rn '!== "false"' apps/web/src` returns no matches
- [ ] `grep -n "coerceValue" apps/web/src/pages/QueryPage.tsx` returns no matches
- [ ] `git status` shows only `apps/web/src/lib/properties.ts`,
      `apps/web/src/pages/QueryPage.tsx`, and `plans/improvement/README.md` changed
- [ ] `plans/improvement/README.md` status row for plan 05 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts don't match the live code (it has drifted).
- After Step 2, typecheck reports a type error on a `coerceScalar(...)` call —
  the call site may pass a type wider than `ScalarType`; report the exact error
  rather than widening `coerceScalar`'s signature.
- `coerceValue` turns out to be exported/used outside `QueryPage.tsx`
  (`grep -rn "coerceValue" apps/web/src`) — then removing it is a larger change;
  report it.

## Maintenance notes

- For the reviewer: confirm both the query builder and the property editor now
  resolve booleans through `coerceScalar`, and that the only behavioral change is
  the boolean branch (numbers/strings/null unchanged).
- If a third surface ever needs value coercion, import `coerceScalar` rather than
  re-implementing it — that re-duplication is exactly what caused this bug.
