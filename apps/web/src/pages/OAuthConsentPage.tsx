import { useState } from "react";
import { IconAlertTriangle, IconPlugConnected } from "@tabler/icons-react";
import { parseConsentRequest, SCOPE_DESCRIPTIONS, submitConsent } from "../lib/oauth";
import { useMountEffect } from "../lib/useMountEffect";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

// The OAuth consent screen for agents connecting to keva over MCP. Better Auth
// redirects here (see the mcp plugin's `consentPage`) with consent_code,
// client_id, and the requested scope. We show what is being granted and POST
// the decision back, then follow the returned redirect to the client.
export function OAuthConsentPage() {
  const request = parseConsentRequest(window.location.search);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A missing consent_code means a stale or hand-edited link — nothing to grant.
  useMountEffect(() => {
    if (!request) setError("This authorization link is invalid or has expired.");
  });

  const decide = async (accept: boolean) => {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      window.location.href = await submitConsent(accept, request.consentCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record your decision.");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2 font-heading text-lg font-semibold">
          <img src="/android-chrome-192x192.png" alt="" className="size-8 object-contain" />
          keva
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IconPlugConnected className="size-5 text-muted-foreground" />
              Authorize access
            </CardTitle>
            <CardDescription>
              An application wants to connect to your keva storage over MCP.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <IconAlertTriangle />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}

            {request && (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    It will be able to
                  </span>
                  <ul className="flex flex-col gap-2">
                    {request.scopes.map((scope) => (
                      <li key={scope} className="flex items-start gap-2 text-sm">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                        <span>{SCOPE_DESCRIPTIONS[scope] ?? scope}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {request.clientId && (
                  <p className="truncate text-xs text-muted-foreground">
                    Client&nbsp;ID: <code className="font-mono">{request.clientId}</code>
                  </p>
                )}

                <div className="flex gap-2">
                  <Button className="flex-1" disabled={busy} onClick={() => void decide(true)}>
                    {busy && <Spinner data-icon="inline-start" />}
                    Allow
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    disabled={busy}
                    onClick={() => void decide(false)}
                  >
                    Deny
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          Only allow access for applications you trust. You can revoke it anytime from the
          Connection screen.
        </p>
      </div>
    </div>
  );
}
