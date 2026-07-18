import { describe, expect, it } from "vitest";
import { getMcpClientSetup } from "./mcp-clients";

const url = "https://app.usekeva.com/mcp";

describe("MCP client setup", () => {
  it("uses native remote HTTP configuration for supported clients", () => {
    expect(getMcpClientSetup("cursor", url).code).toContain(`"url": "${url}"`);
    expect(getMcpClientSetup("claude-code", url).code).toBe(
      `claude mcp add --transport http keva ${url} --scope user`,
    );
    expect(getMcpClientSetup("codex", url).code).toBe(`codex mcp add keva --url ${url}`);
    expect(getMcpClientSetup("opencode", url).code).toContain('"type": "remote"');
  });

  it("keeps mcp-remote in the explicitly labeled legacy fallback", () => {
    const setup = getMcpClientSetup("other", url);
    expect(setup.codeLabel).toContain("Legacy");
    expect(setup.code).toContain("mcp-remote");
  });
});
