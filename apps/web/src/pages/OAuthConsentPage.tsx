import { Plug, TriangleAlert } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getMcpClient } from "../lib/connections";
import { parseConsentRequest, SCOPE_DESCRIPTIONS, submitConsent } from "../lib/oauth";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "../lib/auth";
import { avatarRecipeForUser } from "../lib/avatar";
import { UserAvatar } from "../components/UserAvatar";

export function OAuthConsentPage() {
  const { data } = authClient.useSession();
  const request = parseConsentRequest(window.location.search);
  const [error, setError] = useState<string | null>(() =>
    request ? null : "This authorization link is invalid or has expired.",
  );
  const [busy, setBusy] = useState(false);
  const clientQuery = useQuery({
    queryKey: ["mcp-client", request?.clientId],
    queryFn: () => getMcpClient(request!.clientId!),
    enabled: Boolean(request?.clientId),
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
              <Plug className="size-5 text-muted-foreground" />
              Authorize access
            </CardTitle>
            <CardDescription>
              {clientQuery.data?.name ?? "An application"} wants to connect to your keva storage
              over MCP.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}

            {request && (
              <>
                {data?.user && (
                  <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-3">
                    <UserAvatar
                      avatar={avatarRecipeForUser(data.user.id, data.user.avatar)}
                      name={data.user.name || data.user.email}
                      className="size-10"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{data.user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{data.user.email}</p>
                    </div>
                  </div>
                )}
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
                    {clientQuery.data?.name ? "Registered application" : "Client ID"}:{" "}
                    <code className="font-mono">{clientQuery.data?.name ?? request.clientId}</code>
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
