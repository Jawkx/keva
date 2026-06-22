import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The dev API runs on 127.0.0.1:8787. We proxy every API path prefix through
// Vite so the browser talks to a single same-origin host (5173) and the auth
// cookie stays first-party. The SDK is created with baseUrl: "" and the auth
// client with baseURL: "/api/auth" so all requests are relative.
const API_TARGET = "http://127.0.0.1:8787";

const proxyPaths = ["/api", "/objects", "/query", "/tokens", "/health", "/__dev"];

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      proxyPaths.map((path) => [
        path,
        { target: API_TARGET, changeOrigin: true },
      ]),
    ),
  },
});
