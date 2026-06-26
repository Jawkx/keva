import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The dev API runs on 127.0.0.1:8787. We proxy every API path prefix through
// Vite so the browser talks to a single same-origin host (5173) and the auth
// cookie stays first-party. The SDK is created with baseUrl: "" so Keva API
// requests are relative.
const API_TARGET = "http://127.0.0.1:8787";

const proxyPaths = ["/api", "/objects", "/query", "/tokens", "/health", "/__dev"];

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
