import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Relative baseURL → same-origin, forwarded to the API by the Vite proxy so the
// session cookie is first-party. The server auto-provisions the user's tenant
// (organization) on their first authenticated API call, so the SPA does not
// manage organizations itself — we keep organizationClient() only so the client
// type stays aligned with the server's plugin set.
export const authClient = createAuthClient({
  baseURL: "/api/auth",
  plugins: [organizationClient()],
});
