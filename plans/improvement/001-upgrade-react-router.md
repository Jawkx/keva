# Plan 001: Upgrade React Router Past Active Advisories

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the STOP conditions section occurs, stop and report; do not improvise.
>
> **Drift check (run first)**: `git diff --stat a471073..HEAD -- apps/web/package.json pnpm-lock.yaml apps/web/src/router.tsx`
> If any in-scope file changed since this plan was written, compare the Current state excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: security, dependencies
- **Planned at**: commit `a471073`, 2026-06-27

## Why this matters

`pnpm audit --prod` currently fails because `@keva/web` depends on `react-router-dom@7.9.4`, which pulls a vulnerable `react-router` release. The audit reported multiple high-severity React Router advisories, and `pnpm outdated --recursive react-router react-router-dom` showed `react-router-dom` latest as `7.18.0`. This is a small dependency change with high leverage, but it can break route APIs if React Router changed behavior between 7.9 and the target version.

## Current state

- `apps/web/package.json` owns the direct dependency:

```json
// apps/web/package.json:23-27
"react": "19.2.0",
"react-dom": "19.2.0",
"react-resizable-panels": "^4.11.2",
"react-router-dom": "7.9.4",
"shadcn": "^4.11.0",
```

- `apps/web/src/router.tsx` uses `createBrowserRouter`, `Navigate`, `useLocation`, `Link`, `useNavigate`, and `useParams` across the web app. The main router is:

```tsx
// apps/web/src/router.tsx:12-29
export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignupPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: "/", element: <FilesPage /> },
      { path: "/objects/:id", element: <FilesPage /> },
      { path: "/query", element: <QueryPage /> },
      { path: "/tokens", element: <TokensPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
```

- Repo conventions: package management is pnpm workspaces. Do not edit generated `node_modules` or ignored `dist` output. The web package uses Vite, React 19, TypeScript, and no web test suite yet.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install/update lockfile | `pnpm install` | exit 0, `pnpm-lock.yaml` updated if needed |
| Audit | `pnpm audit --prod` | exit 0 or no high/moderate React Router advisories remain |
| Web typecheck | `pnpm --filter @keva/web typecheck` | exit 0, no TypeScript errors |
| Web build | `pnpm --filter @keva/web build` | exit 0, Vite build succeeds |

## Scope

**In scope**:
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `apps/web/src/router.tsx` only if the upgraded React Router requires a source compatibility adjustment
- Other `apps/web/src/**/*.tsx` files only if typecheck proves a React Router API change requires it

**Out of scope**:
- Any redesign of routes or navigation.
- Any change to API paths under `/api`.
- Any unrelated dependency upgrades.

## Git workflow

- Branch: `advisor/001-upgrade-react-router`
- Commit message style in this repo is plain imperative, for example `Move API under /api so it stops colliding with web routes`.
- Do not push or open a PR unless the operator instructs it.

## Steps

### Step 1: Upgrade the dependency

Update `apps/web/package.json` so `react-router-dom` is at the latest patched version available to pnpm, preferably `7.18.0` or newer. Run `pnpm install` to update `pnpm-lock.yaml`.

**Verify**: `pnpm why react-router react-router-dom` -> exactly one resolved version of `react-router` and `react-router-dom`, both at the upgraded version.

### Step 2: Check security audit

Run `pnpm audit --prod`.

**Verify**: command exits 0, or if it still exits nonzero, the remaining advisories are not React Router advisories. If React Router high or moderate advisories remain, STOP.

### Step 3: Fix any compile breaks from the upgrade

Run `pnpm --filter @keva/web typecheck`. If it fails because a React Router API changed, make the smallest compatible source change. Keep route structure unchanged.

**Verify**: `pnpm --filter @keva/web typecheck` -> exit 0.

### Step 4: Build the web app

Run the Vite production build.

**Verify**: `pnpm --filter @keva/web build` -> exit 0.

## Test plan

- No new unit tests are required for a pure dependency patch.
- Verification is the production audit plus web typecheck/build.
- If source route code changes, manually inspect `apps/web/src/router.tsx`, `RequireAuth`, and pages using `Link`/`useNavigate` for unchanged behavior.

## Done criteria

- [ ] `apps/web/package.json` uses a React Router version that is not covered by the reported advisories.
- [ ] `pnpm-lock.yaml` is updated consistently.
- [ ] `pnpm audit --prod` no longer reports React Router high/moderate advisories.
- [ ] `pnpm --filter @keva/web typecheck` exits 0.
- [ ] `pnpm --filter @keva/web build` exits 0.
- [ ] No files outside the in-scope list changed, except lockfile metadata caused by pnpm.
- [ ] `plans/improvement/README.md` status row for plan 001 is updated.

## STOP conditions

Stop and report if:

- The upgraded React Router requires a route architecture rewrite rather than small compile fixes.
- `pnpm audit --prod` still reports React Router high/moderate advisories after upgrading to the latest available version.
- The lockfile wants to upgrade unrelated major dependencies.

## Maintenance notes

Keep React Router patched proactively. For future advisories, prefer a small package update plus web typecheck/build before investing in any routing refactor.

