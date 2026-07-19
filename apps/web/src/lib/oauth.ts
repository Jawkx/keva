import { Effect, Schema } from "effect";
import { KevaProtocolError, KevaTransportError } from "@keva/sdk";
import { runEffectPromise } from "./effect-runtime";

const MCP_AUTHORIZE_PATH = "/api/auth/mcp/authorize";
const CONSENT_PATH = "/api/auth/oauth2/consent";

const ConsentResponse = Schema.Struct({ redirectURI: Schema.String });

export class OAuthConsentError extends Error {
  readonly _tag = "OAuthConsentError";
}

export const oauthContinuation = (search: string): string | null => {
  const params = new URLSearchParams(search);
  return params.has("client_id") ? `${MCP_AUTHORIZE_PATH}?${params.toString()}` : null;
};

export interface ConsentRequest {
  readonly consentCode: string;
  readonly clientId: string | null;
  readonly scopes: readonly string[];
}

export const parseConsentRequest = (search: string): ConsentRequest | null => {
  const params = new URLSearchParams(search);
  const consentCode = params.get("consent_code");
  if (!consentCode) return null;
  return {
    consentCode,
    clientId: params.get("client_id"),
    scopes: (params.get("scope") ?? "").split(/\s+/).filter(Boolean),
  };
};

export const submitConsentEffect = (
  accept: boolean,
  consentCode: string,
): Effect.Effect<string, OAuthConsentError | KevaProtocolError | KevaTransportError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(CONSENT_PATH, {
          method: "POST",
          credentials: "include",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accept, consent_code: consentCode }),
        }),
      catch: (cause) => new KevaTransportError(cause),
    });
    const payload: unknown = yield* Effect.promise(() => response.json().catch(() => undefined));
    if (!response.ok) {
      const message =
        typeof payload === "object" && payload !== null
          ? ((payload as { error_description?: string }).error_description ??
            (payload as { message?: string }).message)
          : undefined;
      return yield* Effect.fail(
        new OAuthConsentError(message ?? "Could not record your decision."),
      );
    }
    const result = yield* Schema.decodeUnknown(ConsentResponse)(payload).pipe(
      Effect.mapError(() => new KevaProtocolError("Consent response was invalid")),
    );
    return result.redirectURI;
  });

export const submitConsent = (accept: boolean, consentCode: string): Promise<string> =>
  runEffectPromise(submitConsentEffect(accept, consentCode));

export const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "keva:read": "Read your items, their metadata, and file contents",
  "keva:write": "Upload items and update their names and properties",
  "keva:delete": "Delete items and their contents",
  "keva:views": "Create saved views and change which items existing shares expose",
  "keva:shares": "Manage share links and, with read or write access, delegate item access",
  openid: "Verify your identity",
  profile: "See your basic profile information",
  email: "See your email address",
  offline_access: "Stay connected when you are away",
};
