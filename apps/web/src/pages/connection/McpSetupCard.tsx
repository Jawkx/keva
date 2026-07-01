import { IconPlugConnected } from "@tabler/icons-react";
import { CodeBlock } from "../../components/CodeBlock";
import { CopyButton } from "../../components/CopyButton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function McpSetupCard() {
  const mcpUrl = `${window.location.origin}/mcp`;
  const config = `{
  "mcpServers": {
    "keva": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${mcpUrl}"]
    }
  }
}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconPlugConnected className="size-5 text-muted-foreground" />
          Model Context Protocol
        </CardTitle>
        <CardDescription>
          Let AI agents query, read, and organize your files over MCP. Connecting opens a browser
          window to authorize access; you can revoke it below at any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Server URL</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
              {mcpUrl}
            </code>
            <CopyButton value={mcpUrl} label="Copy MCP URL" />
          </div>
        </div>
        <CodeBlock label="Claude Desktop / Cursor config" code={config} />
        <p className="text-xs text-muted-foreground">
          Clients with native remote-MCP support (e.g. Claude.ai connectors) can add the server URL
          directly. Others use <code className="font-mono">mcp-remote</code>, which bridges the
          OAuth flow.
        </p>
      </CardContent>
    </Card>
  );
}
