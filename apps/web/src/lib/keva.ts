import { KevaClient } from "@keva/sdk";

// Relative /api baseUrl + cookie session: every request is same-origin and
// carries the Better Auth cookie. The API lives under /api so it never clashes
// with the web app's own routes (/objects/:id, /query, /tokens). The Vite dev
// proxy forwards /api to the API server.
export const keva = new KevaClient({ baseUrl: "/api", credentials: "include" });
