---
name: aerospace-guide
description: Guidance for macOS Aerospace window manager interactions with Playwright MCP browser windows. Use only after verifying Aerospace is installed or when the user mentions Aerospace, tiling, window resizing, hidden workspaces, or Playwright MCP windows being moved/resized.
---

# Aerospace Guide

Use this guide only when Aerospace is actually present. Verify with:

```bash
command -v aerospace
```

If the command is missing, do not apply Aerospace-specific advice.

## Playwright MCP

A headed Playwright MCP browser opens as a normal macOS window, so Aerospace may tile and
resize it as soon as it appears. Prefer headless Playwright MCP for routine agent-driven
browser work.

Headless mode still allows navigation, clicking, typing, accessibility snapshots, and
screenshots because Playwright controls the browser through automation APIs rather than a
visible mouse.

For Claude-style `.mcp.json`, use:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless", "--viewport-size", "1280x720"]
    }
  }
}
```

## Visible Browser Debugging

If a visible browser is required, configure Aerospace outside this repo to make the
browser floating and move it to an inactive workspace:

```toml
[[on-window-detected]]
if.app-id = 'org.chromium.Chromium'
run = ['layout floating', 'move-node-to-workspace P']
```

Verify the actual browser app id after launching a browser:

```bash
aerospace list-apps
aerospace list-windows --all --json
```

Playwright may use Chromium, Chrome, or another configured browser, so do not assume the
app id without checking.

## Caveats

- An off-workspace browser can still be controlled by Playwright.
- Headless mode is the only clean way to avoid any initial flash, resize, or focus
  change.
- Aerospace `on-window-detected` rules can reduce disruption, but they may run only after
  the window first appears.
