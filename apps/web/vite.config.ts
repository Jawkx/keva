import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// The dev API runs on 127.0.0.1:8787. We proxy every API path prefix through
// Vite so the browser talks to a single same-origin host (5173) and the auth
// cookie stays first-party. The SDK is created with baseUrl: "/api" so Keva
// API requests stay relative to the web origin.
// The API surface lives under /api (including /api/auth). /health and /__dev
// stay at the root, as do the MCP resource server (/mcp) and the OAuth
// discovery documents (/.well-known/*) so a local MCP client pointed at the web
// origin reaches the API. Crucially, /items, /query and /connection are NOT
// proxied: those are the web app's own client-side routes, so a refresh / deep
// link falls through to Vite and loads the SPA instead of hitting the API.
const proxyPaths = ["/api", "/health", "/__dev", "/mcp", "/.well-known"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET ?? "http://127.0.0.1:8787";
  const environment =
    env.KEVA_ENVIRONMENT ?? (mode === "development" ? "development" : "production");
  if (!["development", "staging", "production"].includes(environment)) {
    throw new Error(`Unsupported KEVA_ENVIRONMENT: ${environment}`);
  }
  const iconBasePath = `/icons/${environment}`;

  let commit: string;
  try {
    commit = execSync("git rev-parse --short=7 HEAD", { encoding: "utf-8" }).trim();
  } catch {
    commit = "unknown";
  }
  const version = env.KEVA_APP_VERSION ?? null;

  return {
    plugins: [
      {
        name: "keva-environment-icons",
        transformIndexHtml: (html) => html.replaceAll("%KEVA_ICON_BASE%", iconBasePath),
      },
      react({
        babel: {
          plugins: [["babel-plugin-react-compiler", { target: "19" }]],
        },
      }),
      tailwindcss(),
    ],
    define: {
      __KEVA_APP_COMMIT__: JSON.stringify(commit),
      __KEVA_APP_VERSION__: JSON.stringify(version),
      __KEVA_ENVIRONMENT__: JSON.stringify(environment),
      __KEVA_ICON_BASE__: JSON.stringify(iconBasePath),
    },
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@keva/schema": fileURLToPath(
          new URL("../../packages/schema/src/index.ts", import.meta.url),
        ),
        "@keva/sdk": fileURLToPath(new URL("../../packages/sdk/src/index.ts", import.meta.url)),
      },
    },
    server: {
      proxy: Object.fromEntries(
        proxyPaths.map((path) => [path, { target: apiTarget, changeOrigin: true }]),
      ),
    },
  };
});
