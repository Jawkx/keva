import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin baseURL, forwarded to the API by the Vite proxy so the session
// cookie is first-party. better-auth's client validates baseURL as an absolute
// URL, so we anchor the /api/auth path to window.location.origin rather than
// passing a bare relative path. The server auto-provisions the user's tenant
// (organization) on their first authenticated API call, so the SPA does not
// manage organizations itself — we keep organizationClient() only so the client
// type stays aligned with the server's plugin set.
export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  fetchOptions: {
    customFetchImpl: window.fetch.bind(window),
  },
  plugins: [organizationClient()],
});
