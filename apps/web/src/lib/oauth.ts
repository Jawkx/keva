const MCP_AUTHORIZE_PATH = "/api/auth/mcp/authorize";
const CONSENT_PATH = "/api/auth/oauth2/consent";

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

export const submitConsent = async (accept: boolean, consentCode: string): Promise<string> => {
  const response = await fetch(CONSENT_PATH, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accept, consent_code: consentCode }),
  });
  const payload: unknown = await response.json().catch(() => undefined);
  const redirectURI =
    typeof payload === "object" && payload !== null && "redirectURI" in payload
      ? (payload as { redirectURI: unknown }).redirectURI
      : undefined;
  if (!response.ok || typeof redirectURI !== "string") {
    const message =
      typeof payload === "object" && payload !== null
        ? ((payload as { error_description?: string }).error_description ??
          (payload as { message?: string }).message)
        : undefined;
    throw new Error(message ?? "Could not record your decision.");
  }
  return redirectURI;
};

export const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  "keva:read": "Read your items, their metadata, and file contents",
  "keva:write": "Create and update item properties",
  "keva:delete": "Delete items and their contents",
  openid: "Verify your identity",
  profile: "See your basic profile information",
  email: "See your email address",
  offline_access: "Stay connected when you are away",
};
