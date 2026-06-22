import { KevaClient } from "@keva/sdk";

// Relative baseUrl + cookie session: every request is same-origin and carries
// the Better Auth cookie. The Vite dev proxy forwards them to the API.
export const keva = new KevaClient({ baseUrl: "", credentials: "include" });
