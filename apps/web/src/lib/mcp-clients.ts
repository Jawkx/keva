export type McpClientId = "cursor" | "claude" | "claude-code" | "codex" | "opencode" | "other";

export interface McpClientOption {
  readonly id: McpClientId;
  readonly label: string;
}

export interface McpClientSetup {
  readonly instruction: string;
  readonly code: string;
  readonly codeLabel: string;
  readonly openLabel?: string;
  readonly openUrl?: string;
}

export const MCP_CLIENTS: readonly McpClientOption[] = [
  { id: "cursor", label: "Cursor" },
  { id: "claude", label: "Claude" },
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
  { id: "other", label: "Other" },
];

export const getMcpClientSetup = (clientId: McpClientId, mcpUrl: string): McpClientSetup => {
  switch (clientId) {
    case "cursor": {
      const installConfig = btoa(JSON.stringify({ url: mcpUrl }));
      return {
        instruction: "Install Keva as a remote server, then approve access in the browser.",
        code: JSON.stringify({ mcpServers: { keva: { url: mcpUrl } } }, null, 2),
        codeLabel: "Cursor MCP configuration",
        openLabel: "Add to Cursor",
        openUrl: `https://cursor.com/install-mcp?name=keva&config=${encodeURIComponent(installConfig)}`,
      };
    }
    case "claude":
      return {
        instruction: "Open Connectors, add a custom connector, and paste the Keva server URL.",
        code: mcpUrl,
        codeLabel: "Remote MCP URL",
        openLabel: "Open Claude Connectors",
        openUrl: "https://claude.ai/customize/connectors",
      };
    case "claude-code":
      return {
        instruction: "Run this command, then use /mcp in Claude Code to authorize Keva.",
        code: `claude mcp add --transport http keva ${mcpUrl} --scope user`,
        codeLabel: "Terminal command",
      };
    case "codex":
      return {
        instruction:
          "Add the server, then run `codex mcp login keva` to authorize in your browser.",
        code: `codex mcp add keva --url ${mcpUrl}`,
        codeLabel: "Terminal command",
      };
    case "opencode":
      return {
        instruction: "Add this to opencode.json, then run `opencode mcp auth keva`.",
        code: JSON.stringify(
          { mcp: { keva: { type: "remote", url: mcpUrl, enabled: true } } },
          null,
          2,
        ),
        codeLabel: "OpenCode configuration",
      };
    case "other":
      return {
        instruction:
          "Use native Streamable HTTP with OAuth when available. The command bridge is only for clients without remote MCP support.",
        code: JSON.stringify(
          {
            mcpServers: {
              keva: { command: "npx", args: ["-y", "mcp-remote", mcpUrl] },
            },
          },
          null,
          2,
        ),
        codeLabel: "Legacy mcp-remote configuration",
      };
  }
};
