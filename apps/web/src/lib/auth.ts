import { createAuthClient } from "better-auth/react";
import { anonymousClient, inferAdditionalFields } from "better-auth/client/plugins";
import { polarClient } from "@polar-sh/better-auth/client";

export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [
    anonymousClient(),
    polarClient(),
    inferAdditionalFields({
      user: {
        avatar: { type: "string", required: false },
        isAnonymous: { type: "boolean", required: false },
      },
    }),
  ],
  fetchOptions: {
    customFetchImpl: window.fetch.bind(window),
  },
});
