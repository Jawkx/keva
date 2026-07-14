import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { KevaItem } from "@keva/schema";
import { createKevaMcpServer, type McpEngine } from "./index.js";

const item: KevaItem = {
  id: "00000000-0000-4000-8000-000000000001",
  tenantId: "tenant-1",
  name: "a.txt",
  contentType: "text/plain",
  declaredSize: 1,
  size: 1,
  etag: null,
  checksum: null,
  source: "upload",
  status: "ready",
  storageKey: "items/a.txt",
  stagingKey: "staging/a.txt",
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  properties: { tag: "x" },
};

const stubEngine = (overrides: Partial<McpEngine> = {}): McpEngine => ({
  queryItems: async () => ({ items: [] }),
  getItem: async () => item,
  getContentUrl: async () => ({ url: "https://blob/x", expiresAt: "2030-01-01T00:00:00Z" }),
  getUsage: async () => ({
    itemCount: 0,
    totalBytes: 0,
    quotaBytes: 10_737_418_240,
    remainingBytes: 10_737_418_240,
    byType: [],
  }),
  listPropertyKeys: async () => ({ keys: ["tag"] }),
  listPropertyValues: async () => ({ values: ["x"] }),
  setProperties: async () => item,
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
      "get_usage",
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
    const setProperties = vi.fn(async () => item);
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
    const queryItems = vi.fn(async () => ({ items: [item], nextCursor: "c1" }));
    const { client, close } = await connect(stubEngine({ queryItems }), ["read"]);

    const result = await client.callTool({
      name: "query_items",
      arguments: { where: [{ key: "tag", op: "has_value", value: "photo" }], limit: 10 },
    });

    expect(queryItems).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [{ key: "tag", op: "has_value", value: "photo" }],
        limit: 10,
      }),
    );
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result as never))).toMatchObject({
      items: [{ id: item.id }],
      nextCursor: "c1",
    });
    await close();
  });

  it("preserves canonical multi-value conditions and ordering", async () => {
    const queryItems = vi.fn(async () => ({ items: [] }));
    const { client, close } = await connect(stubEngine({ queryItems }), ["read"]);

    await client.callTool({
      name: "query_items",
      arguments: {
        where: [{ key: "tag", op: "has_any", value: ["photo", "video"] }],
        order: "created_at_desc",
      },
    });

    expect(queryItems).toHaveBeenCalledWith({
      where: [{ key: "tag", op: "has_any", value: ["photo", "video"] }],
      order: "created_at_desc",
    });
    await close();
  });

  it("delegates set_properties with set/unset", async () => {
    const setProperties = vi.fn(async () => item);
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

  it("rejects invalid property values before calling the engine", async () => {
    const setProperties = vi.fn(async () => item);
    const { client, close } = await connect(stubEngine({ setProperties }), ["write"]);

    for (const value of [1, true, "", [], ["x", "x"]]) {
      const result = await client.callTool({
        name: "set_properties",
        arguments: { id: "item-1", set: { tag: value } },
      });
      expect(result.isError).toBe(true);
    }
    expect(setProperties).not.toHaveBeenCalled();
    await close();
  });

  it("rejects query operands that do not match the operator", async () => {
    const queryItems = vi.fn(async () => ({ items: [] }));
    const { client, close } = await connect(stubEngine({ queryItems }), ["read"]);

    const result = await client.callTool({
      name: "query_items",
      arguments: { where: [{ key: "tag", op: "has_any", values: ["photo"] }] },
    });

    expect(result.isError).toBe(true);
    expect(queryItems).not.toHaveBeenCalled();
    await close();
  });

  it("rejects operators that do not match the query key", async () => {
    const queryItems = vi.fn(async () => ({ items: [] }));
    const { client, close } = await connect(stubEngine({ queryItems }), ["read"]);

    for (const condition of [
      { key: "tag", op: "eq", value: "photo" },
      { key: "system.size", op: "has_value", value: "10" },
      { key: "system.size", op: "gte", value: "10" },
      { key: "keva.internal", op: "exists" },
    ]) {
      const result = await client.callTool({
        name: "query_items",
        arguments: { where: [condition] },
      });
      expect(result.isError).toBe(true);
    }
    expect(queryItems).not.toHaveBeenCalled();
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

  it("delegates get_usage and serializes the breakdown", async () => {
    const getUsage = vi.fn(async () => ({
      itemCount: 3,
      totalBytes: 15,
      quotaBytes: 100,
      remainingBytes: 85,
      byType: [{ contentType: "image/png", count: 2, bytes: 10 }],
    }));
    const { client, close } = await connect(stubEngine({ getUsage }), ["read"]);

    const result = await client.callTool({ name: "get_usage", arguments: {} });

    expect(getUsage).toHaveBeenCalled();
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result as never))).toEqual({
      itemCount: 3,
      totalBytes: 15,
      quotaBytes: 100,
      remainingBytes: 85,
      byType: [{ contentType: "image/png", count: 2, bytes: 10 }],
    });
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
