import { ArrowUpRight, Blocks, Plug } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { siClaude, siCursor, siOpencode, type SimpleIcon } from "simple-icons";
import { CodeBlock } from "../../components/CodeBlock";
import { CopyButton } from "../../components/CopyButton";
import { getMcpConfig } from "../../lib/connections";
import { getMcpClientSetup, MCP_CLIENTS, type McpClientId } from "../../lib/mcp-clients";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const OPENAI_ICON_PATH =
  "M32.838 17.282a7.4 7.4 0 0 0-.563-6.094 7.32 7.32 0 0 0-8.155-3.656A7.4 7.4 0 0 0 18.495 5a7.33 7.33 0 0 0-7.22 5.157 7.43 7.43 0 0 0-5.062 3.656 7.38 7.38 0 0 0 .937 8.905 7.4 7.4 0 0 0 .563 6.094 7.32 7.32 0 0 0 8.157 3.657A7.4 7.4 0 0 0 21.495 35a7.33 7.33 0 0 0 7.218-5.156 7.43 7.43 0 0 0 4.97-3.657 7.38 7.38 0 0 0-.845-8.905Zm-11.25 15.748a5.5 5.5 0 0 1-3.656-1.312l6.188-3.563a.84.84 0 0 0 .468-.844v-8.436l2.532 1.5v6.937a5.53 5.53 0 0 1-5.532 5.718ZM9.495 27.875a5.5 5.5 0 0 1-.657-3.75l6.188 3.562a.84.84 0 0 0 .937 0l7.312-4.218v2.906l-6.093 3.562a5.54 5.54 0 0 1-7.687-2.062ZM7.9 14.845a5.5 5.5 0 0 1 2.907-2.439v7.126a.84.84 0 0 0 .468.843l7.313 4.22-2.531 1.5-6-3.47A5.53 5.53 0 0 1 7.9 14.845Zm20.72 4.78-7.313-4.218 2.531-1.5 6 3.468a5.53 5.53 0 0 1-.843 10.125v-7.125a.84.84 0 0 0-.375-.75Zm2.53-3.75-6.187-3.562a.84.84 0 0 0-.938 0l-7.312 4.219v-2.907l6.094-3.562a5.54 5.54 0 0 1 8.343 5.812ZM15.4 21.125l-2.53-1.5v-7.03a5.53 5.53 0 0 1 9.187-4.313l-6.187 3.562a.84.84 0 0 0-.47.844v8.437Zm1.313-3 3.282-1.875 3.28 1.875v3.75l-3.28 1.875-3.282-1.875v-3.75Z";

function BrandIcon({ icon }: { icon: SimpleIcon }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path fill="currentColor" d={icon.path} />
    </svg>
  );
}

function ClientIcon({ clientId }: { clientId: McpClientId }) {
  switch (clientId) {
    case "cursor":
      return <BrandIcon icon={siCursor} />;
    case "claude":
    case "claude-code":
      return <BrandIcon icon={siClaude} />;
    case "codex":
      return (
        <svg aria-hidden="true" viewBox="0 0 40 40">
          <path fill="currentColor" d={OPENAI_ICON_PATH} />
        </svg>
      );
    case "opencode":
      return <BrandIcon icon={siOpencode} />;
    case "other":
      return <Blocks aria-hidden="true" />;
  }
}

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
                <div className="flex items-center gap-2">
                  <Skeleton className="h-7 min-w-0 flex-1" />
                  <Skeleton className="size-7 shrink-0" />
                </div>
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
                    const client = MCP_CLIENTS.find((candidate) => candidate.id === value[0]);
                    if (client) setClientId(client.id);
                  }}
                  className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3"
                  aria-label="MCP client"
                >
                  {MCP_CLIENTS.map((client) => (
                    <ToggleGroupItem
                      key={client.id}
                      value={client.id}
                      className="h-10 min-w-0 flex-none justify-start rounded-md! border! px-3 data-[variant=outline]:border-l!"
                    >
                      <ClientIcon clientId={client.id} />
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
                        nativeButton={false}
                        aria-label={`${setup.openLabel} in a new tab`}
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
