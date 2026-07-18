import { ArrowUpRight, Check, Plug } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CodeBlock } from "../../components/CodeBlock";
import { CopyButton } from "../../components/CopyButton";
import { getMcpConfig } from "../../lib/connections";
import { getMcpClientSetup, MCP_CLIENTS, type McpClientId } from "../../lib/mcp-clients";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const SETUP_STEPS = ["Add the server", "Authorize access", "Verify below"] as const;

export function McpSetupCard() {
  const [clientId, setClientId] = useState<McpClientId>("cursor");
  const configQuery = useQuery({ queryKey: ["mcp-config"], queryFn: getMcpConfig });
  const mcpUrl = configQuery.data?.mcpUrl;
  const setup = mcpUrl ? getMcpClientSetup(clientId, mcpUrl) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-5 text-muted-foreground" />
          Model Context Protocol
        </CardTitle>
        <CardDescription>
          Add the Keva server to your agent, authorize it in the browser, and return here to verify
          the connection.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {configQuery.isError ? (
          <Alert variant="destructive">
            <Plug />
            <AlertTitle>Could not load the MCP server address</AlertTitle>
            <AlertDescription>
              Check the server configuration, then retry. Keva will not substitute the browser
              address because OAuth must use the configured public origin.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <ol className="grid gap-3 sm:grid-cols-3">
              {SETUP_STEPS.map((step, index) => (
                <li key={step} className="flex items-center gap-2 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Keva MCP server</span>
              {mcpUrl ? (
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
                    {mcpUrl}
                  </code>
                  <CopyButton value={mcpUrl} label="Copy MCP URL" />
                </div>
              ) : (
                <Skeleton className="h-8 w-full" />
              )}
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Choose your client
                </span>
                <ToggleGroup
                  variant="outline"
                  value={[clientId]}
                  onValueChange={(value) => {
                    const next = value[0] as McpClientId | undefined;
                    if (next) setClientId(next);
                  }}
                  className="flex-wrap"
                  aria-label="MCP client"
                >
                  {MCP_CLIENTS.map((client) => (
                    <ToggleGroupItem key={client.id} value={client.id} className="px-3">
                      {client.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {setup ? (
                <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="max-w-2xl text-sm text-muted-foreground">{setup.instruction}</p>
                    {setup.openUrl && setup.openLabel ? (
                      <Button
                        variant="outline"
                        render={
                          <a href={setup.openUrl} target="_blank" rel="noreferrer">
                            {setup.openLabel}
                            <ArrowUpRight data-icon="inline-end" />
                          </a>
                        }
                      />
                    ) : null}
                  </div>
                  <CodeBlock label={setup.codeLabel} code={setup.code} />
                </div>
              ) : null}
            </div>

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check /> Native remote MCP keeps OAuth and credentials inside your chosen client.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
