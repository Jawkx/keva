import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The dev API runs on 127.0.0.1:8787. We proxy every API path prefix through
// Vite so the browser talks to a single same-origin host (5173) and the auth
// cookie stays first-party. The SDK is created with baseUrl: "" so Keva API
// requests are relative.
const API_TARGET = "http://127.0.0.1:8787";

// The API surface lives under /api (including /api/auth). /health and /__dev
// stay at the root. Crucially, /objects, /query and /tokens are NOT proxied:
// those are the web app's own client-side routes, so a refresh / deep link
// falls through to Vite and loads the SPA instead of hitting the API.
const proxyPaths = ["/api", "/health", "/__dev"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@keva/schema": fileURLToPath(new URL("../../packages/schema/src/index.ts", import.meta.url)),
      "@keva/sdk": fileURLToPath(new URL("../../packages/sdk/src/index.ts", import.meta.url)),
    },
  },
  server: {
    proxy: Object.fromEntries(
      proxyPaths.map((path) => [
        path,
        { target: API_TARGET, changeOrigin: true },
      ]),
    ),
  },
});
