import { createAuthClient } from "better-auth/react";
import { polarClient } from "@polar-sh/better-auth/client";

export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [polarClient()],
  fetchOptions: {
    customFetchImpl: window.fetch.bind(window),
  },
});
