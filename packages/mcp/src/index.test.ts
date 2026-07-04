import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { createKevaMcpServer, type McpEngine } from "./index.js";

const stubEngine = (overrides: Partial<McpEngine> = {}): McpEngine => ({
  queryItems: async () => ({ items: [] }),
  getItem: async () => ({ id: "item-1", name: "a.txt" }),
  getContentUrl: async () => ({ url: "https://blob/x", expiresAt: "2030-01-01T00:00:00Z" }),
  listPropertyKeys: async () => ({ keys: ["tag"] }),
  listPropertyValues: async () => ({ values: ["x"] }),
  setProperties: async () => ({ id: "item-1", properties: { tag: "x" } }),
  deleteItem: async () => {},
  ...overrides,
});

const connect = async (engine: McpEngine, scopes: string[]) => {
  const server = createKevaMcpServer(engine, { scopes });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
};

const toolNames = async (scopes: string[]): Promise<string[]> => {
  const { client, close } = await connect(stubEngine(), scopes);
  const { tools } = await client.listTools();
  await close();
  return tools.map((tool) => tool.name).sort();
};

const textOf = (result: { content: Array<{ type: string; text?: string }> }): string =>
  result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");

describe("createKevaMcpServer tool registration", () => {
  it("exposes no keva tools for an empty scope set", async () => {
    expect(await toolNames([])).toEqual([]);
  });

  it("exposes only read tools for a read-only principal", async () => {
    expect(await toolNames(["read"])).toEqual([
      "get_content_url",
      "get_item",
      "list_property_keys",
      "list_property_values",
      "query_items",
    ]);
  });

  it("adds set_properties when write is granted", async () => {
    expect(await toolNames(["read", "write"])).toContain("set_properties");
  });

  it("adds delete_item only when delete is granted", async () => {
    expect(await toolNames(["read", "write"])).not.toContain("delete_item");
    expect(await toolNames(["read", "write", "delete"])).toContain("delete_item");
  });

  it("does not expose a write tool to a read-only principal", async () => {
    const setProperties = vi.fn(async () => ({ id: "item-1" }));
    const { client, close } = await connect(stubEngine({ setProperties }), ["read"]);
    const result = await client.callTool({
      name: "set_properties",
      arguments: { id: "item-1", set: { tag: "x" } },
    });
    expect(result.isError).toBe(true);
    expect(setProperties).not.toHaveBeenCalled();
    await close();
  });
});

describe("createKevaMcpServer tool execution", () => {
  it("delegates query_items to the engine and serializes the result", async () => {
    const queryItems = vi.fn(async () => ({ items: [{ id: "item-1" }], nextCursor: "c1" }));
    const { client, close } = await connect(stubEngine({ queryItems }), ["read"]);

    const result = await client.callTool({
      name: "query_items",
      arguments: { where: [{ key: "tag", op: "eq", value: "photo" }], limit: 10 },
    });

    expect(queryItems).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [{ key: "tag", op: "eq", value: "photo" }],
        limit: 10,
      }),
    );
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result as never))).toEqual({
      items: [{ id: "item-1" }],
      nextCursor: "c1",
    });
    await close();
  });

  it("delegates set_properties with set/unset", async () => {
    const setProperties = vi.fn(async () => ({ id: "item-1" }));
    const { client, close } = await connect(stubEngine({ setProperties }), ["read", "write"]);

    await client.callTool({
      name: "set_properties",
      arguments: { id: "item-1", set: { tag: "x" }, unset: ["old"] },
    });

    expect(setProperties).toHaveBeenCalledWith({
      id: "item-1",
      set: { tag: "x" },
      unset: ["old"],
    });
    await close();
  });

  it("delegates list_property_values with the requested key", async () => {
    const listPropertyValues = vi.fn(async () => ({ values: ["bali", "tokyo"] }));
    const { client, close } = await connect(stubEngine({ listPropertyValues }), ["read"]);

    const result = await client.callTool({
      name: "list_property_values",
      arguments: { key: "location" },
    });

    expect(listPropertyValues).toHaveBeenCalledWith({ key: "location" });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result as never))).toEqual({ values: ["bali", "tokyo"] });
    await close();
  });

  it("surfaces an engine failure as a tool error with the safe message", async () => {
    const getItem = vi.fn(async () => {
      throw new Error("Item not found");
    });
    const { client, close } = await connect(stubEngine({ getItem }), ["read"]);

    const result = await client.callTool({ name: "get_item", arguments: { id: "missing" } });

    expect(result.isError).toBe(true);
    expect(textOf(result as never)).toBe("Item not found");
    await close();
  });
});
