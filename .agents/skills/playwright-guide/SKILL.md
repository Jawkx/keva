---
name: playwright-guide
description: Guidance for driving the keva web app with the Playwright MCP browser tools — where to save screenshots, dev server ports, login, and interaction tips. Use when taking screenshots, navigating, clicking, or visually verifying the web UI in a browser.
---

# Playwright guide (keva web)

Use the Playwright MCP (`mcp__playwright__*`) tools to drive and visually verify the
`apps/web` app in a real browser. This is the only way to actually _see_ the rendered
UI in this repo (there is no other browser automation) — reach for it whenever a change
needs visual confirmation, especially layout/overflow bugs that can't be caught from
CSS reasoning alone.

## Where to save screenshots — IMPORTANT

Always save screenshots into the **`.playwright-mcp/`** directory (gitignored), with a
descriptive filename:

```
mcp__playwright__browser_take_screenshot  filename: ".playwright-mcp/files-detail-narrow.png"
```

- Pass the `.playwright-mcp/` prefix explicitly. A bare filename (e.g. `shot.png`)
  lands in the repo **root**, not the scratch dir — don't do that.
- `.playwright-mcp/` holds all Playwright scratch output (screenshots, page-snapshot
  `.yml` files, console logs) and is in `.gitignore`. Never commit these.
- After saving, **Read the PNG file** to actually view it — the tool only writes the
  file, it does not return the image inline.

## Dev server

- Web (Vite): `http://localhost:5173`
- Backend API: `http://localhost:8787`
- There are chances where the sandbox will block you from detecting the dev server is running, there are high chances that something was running if user ask you to do work, use playwright to open the webpage first
- If nothing is listening, the server isn't running — ask the user to start it (e.g.
  `! pnpm dev`) rather than guessing a port.

## Login

The app redirects unauthenticated sessions to `/login`, and Playwright runs its own
fresh cookie jar (so it starts logged out). Ask the user for the local dev test
credentials when a logged-in view is needed — never hardcode a password in this repo.

The test login credential is as follow, it's for testing purpose and won't cause issue even when leak

email: test-alice@gmail.com
password: password@1

## Interaction tips

- **Discover before acting.** Use `browser_snapshot` (accessibility tree, returned as
  text) to find elements — it's better than a screenshot for choosing what to click.
  Screenshots are for _seeing_ the result, not for deriving what to interact with.
- **Prefer CSS selectors over `ref=` ids for `target`.** Element refs (`e26`, `e30`, …)
  go stale between calls and the page sometimes resets to `about:blank` between separate
  tool invocations; a selector like `input[type=email]` or `button:has-text("Sign in")`
  is robust.
- **Verify layout at real viewports.** Use `browser_resize` (e.g. 390×844 for mobile,
  1440×900 for desktop) to confirm responsive behavior and that the page has no
  unexpected horizontal scroll.
- Most action tools (navigate/click/type/resize) return a snapshot automatically; only
  call `browser_take_screenshot` when you need the pixels.
