import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type { OwnerItem } from "@keva/schema";
import { ClientSafeToolError, createKevaMcpServer, type McpEngine } from "./index.js";

const item: OwnerItem = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "a.txt",
  contentType: "text/plain",
  declaredSize: 1,
  size: 1,
  etag: null,
  source: "upload",
  status: "ready",
  revision: 1,
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
  properties: { tag: "x" },
};

const stubEngine = (overrides: Partial<McpEngine> = {}): McpEngine => ({
  queryItems: async () => ({ items: [] }),
  getItem: async () => item,
  getItemContent: async () => ({
    item,
    download: { url: "https://blob/x", expiresAt: "2030-01-01T00:00:00Z" },
  }),
  getItemEvents: async () => ({ events: [] }),
  getUsage: async () => ({
    itemCount: 0,
    totalBytes: 0,
    accountedItems: 0,
    quotaBytes: 10_737_418_240,
    quotaItems: null,
    remainingBytes: 10_737_418_240,
    remainingItems: null,
    period: null,
    byType: [],
  }),
  listPropertyKeys: async () => ({ keys: ["tag"] }),
  listPropertyValues: async () => ({ values: ["x"] }),
  getPropertySummary: async () => ({ entries: [] }),
  beginUpload: async () => ({
    item,
    uploadUrl: "https://blob/upload",
    expiresAt: "2030-01-01T00:00:00Z",
    headers: {},
  }),
  completeUpload: async () => item,
  uploadContent: async () => item,
  setProperties: async () => item,
  setPropertiesBulk: async (input) => ({
    updated: input.items.map(({ id }) => ({ id, revision: 2 })),
    failed: [],
  }),
  deleteItem: async () => {},
  deleteItems: async (ids) => ({ deleted: [...ids], failed: [] }),
  createView: async (input) => ({
    id: "view-1",
    tenantId: "tenant-1",
    name: input.name,
    icon: input.icon ?? null,
    color: input.color ?? null,
    conditions: input.conditions,
    createdAt: "2030-01-01T00:00:00Z",
    updatedAt: "2030-01-01T00:00:00Z",
  }),
  listViews: async () => [],
  getView: async () => {
    throw new Error("View not found");
  },
  updateView: async () => {
    throw new Error("View not found");
  },
  deleteView: async () => ({ deleted: true }),
  createShare: async () => {
    throw new Error("not used");
  },
  listShares: async () => [],
  revokeShare: async () => ({ revoked: true }),
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
      try {
        await client.close();
      } finally {
        await server.close();
      }
    },
  };
};

const toolNames = async (scopes: string[]): Promise<string[]> => {
  const { client, close } = await connect(stubEngine(), scopes);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name).sort();
  } finally {
    await close();
  }
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
      "get_item",
      "get_item_content",
      "get_item_events",
      "get_property_summary",
      "get_usage",
      "list_property_keys",
      "list_property_values",
      "query_items",
    ]);
  });

  it("adds property mutation tools when write is granted", async () => {
    expect(await toolNames(["read", "write"])).toContain("set_properties");
    expect(await toolNames(["read", "write"])).toContain("set_properties_bulk");
  });

  it("adds delete_item only when delete is granted", async () => {
    expect(await toolNames(["read", "write"])).not.toContain("delete_item");
    expect(await toolNames(["read", "write", "delete"])).toContain("delete_item");
  });

  it("registers upload, view, and share tools only for their scopes", async () => {
    expect(await toolNames(["write"])).toEqual([
      "begin_upload",
      "complete_upload",
      "set_properties",
      "set_properties_bulk",
      "upload_content",
    ]);
    expect(await toolNames(["views"])).toEqual([
      "create_view",
      "delete_view",
      "get_view",
      "list_views",
      "update_view",
    ]);
    expect(await toolNames(["shares"])).toEqual(["create_share", "list_shares", "revoke_share"]);
  });

  it("does not expose a write tool to a read-only principal", async () => {
    const setProperties = vi.fn(async () => item);
    const { client, close } = await connect(stubEngine({ setProperties }), ["read"]);
    const result = await client.callTool({
      name: "set_properties",
      arguments: { id: item.id, set: { tag: "x" } },
    });
    expect(result.isError).toBe(true);
    expect(setProperties).not.toHaveBeenCalled();
    await close();
  });
});

describe("createKevaMcpServer tool execution", () => {
  it("returns item content as a ChatGPT file reference and standard MCP resource link", async () => {
    const getItemContent = vi.fn(stubEngine().getItemContent);
    const { client, close } = await connect(stubEngine({ getItemContent }), ["read"]);

    try {
      const result = await client.callTool({
        name: "get_item_content",
        arguments: { id: item.id },
      });

      expect(getItemContent).toHaveBeenCalledWith(item.id);
      expect(result.structuredContent).toEqual({
        file_uri: {
          download_url: "https://blob/x",
          file_id: item.id,
          mime_type: "text/plain",
          file_name: "a.txt",
        },
        item_id: item.id,
        size: 1,
        expires_at: "2030-01-01T00:00:00Z",
      });
      expect(result.content).toEqual([
        {
          type: "text",
          text: JSON.stringify(
            {
              download_url: "https://blob/x",
              file_id: item.id,
              mime_type: "text/plain",
              file_name: "a.txt",
              size: 1,
              expires_at: "2030-01-01T00:00:00Z",
            },
            null,
            2,
          ),
        },
        {
          type: "resource_link",
          uri: "https://blob/x",
          name: "a.txt",
          mimeType: "text/plain",
          size: 1,
        },
      ]);
    } finally {
      await close();
    }
  });

  it("delegates query_items with canonical conditions and serializes the result", async () => {
    const queryItems = vi.fn(async () => ({ items: [item], nextCursor: "c1" }));
    const { client, close } = await connect(stubEngine({ queryItems }), ["read"]);

    const result = await client.callTool({
      name: "query_items",
      arguments: {
        where: [{ key: "tag", op: "has_any", value: ["photo", "video"] }],
        limit: 10,
        order: "size_desc",
      },
    });

    expect(queryItems).toHaveBeenCalledWith(
      expect.objectContaining({
        where: [{ key: "tag", op: "has_any", value: ["photo", "video"] }],
        limit: 10,
        order: "size_desc",
      }),
    );
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result as never))).toMatchObject({
      items: [{ id: item.id }],
      nextCursor: "c1",
    });
    await close();
  });

  it("delegates set_properties with set/unset", async () => {
    const setProperties = vi.fn(async () => item);
    const { client, close } = await connect(stubEngine({ setProperties }), ["read", "write"]);

    await client.callTool({
      name: "set_properties",
      arguments: { id: item.id, set: { tag: "x" }, unset: ["old"] },
    });

    expect(setProperties).toHaveBeenCalledWith({
      id: item.id,
      set: { tag: "x" },
      unset: ["old"],
    });
    await close();
  });

  it("delegates set_properties_bulk with per-item revisions", async () => {
    const secondId = "00000000-0000-4000-8000-000000000002";
    const setPropertiesBulk = vi.fn(stubEngine().setPropertiesBulk);
    const { client, close } = await connect(stubEngine({ setPropertiesBulk }), ["write"]);

    const result = await client.callTool({
      name: "set_properties_bulk",
      arguments: {
        items: [{ id: item.id, expectedRevision: 1 }, { id: secondId }],
        set: { reviewed: null },
        unset: ["draft"],
      },
    });

    expect(setPropertiesBulk).toHaveBeenCalledWith({
      items: [{ id: item.id, expectedRevision: 1 }, { id: secondId }],
      set: { reviewed: null },
      unset: ["draft"],
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result as never))).toMatchObject({
      updated: [
        { id: item.id, revision: 2 },
        { id: secondId, revision: 2 },
      ],
      failed: [],
    });
    await close();
  });

  it("rejects invalid property values before calling the engine", async () => {
    const setProperties = vi.fn(async () => item);
    const { client, close } = await connect(stubEngine({ setProperties }), ["write"]);

    for (const value of [1, true, "", [], ["x", "x"]]) {
      const result = await client.callTool({
        name: "set_properties",
        arguments: { id: item.id, set: { tag: value } },
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

  it("delegates upload sessions and batch deletion", async () => {
    const beginUpload = vi.fn(stubEngine().beginUpload);
    const completeUpload = vi.fn(stubEngine().completeUpload);
    const deleteItems = vi.fn(stubEngine().deleteItems);
    const { client, close } = await connect(
      stubEngine({ beginUpload, completeUpload, deleteItems }),
      ["write", "delete"],
    );

    await client.callTool({
      name: "begin_upload",
      arguments: { name: "a.txt", contentType: "text/plain", size: 1 },
    });
    await client.callTool({ name: "complete_upload", arguments: { id: item.id } });
    await client.callTool({ name: "delete_items", arguments: { ids: [item.id] } });

    expect(beginUpload).toHaveBeenCalledWith({
      name: "a.txt",
      contentType: "text/plain",
      size: 1,
      source: "upload",
      properties: {},
    });
    expect(completeUpload).toHaveBeenCalledWith(item.id);
    expect(deleteItems).toHaveBeenCalledWith([item.id]);
    await close();
  });

  it("surfaces an explicit client-safe tool error message", async () => {
    const getItem = vi.fn(async () => {
      throw new ClientSafeToolError("Item not found");
    });
    const { client, close } = await connect(stubEngine({ getItem }), ["read"]);

    try {
      const result = await client.callTool({ name: "get_item", arguments: { id: item.id } });

      expect(result.isError).toBe(true);
      expect(textOf(result as never)).toBe("Item not found");
    } finally {
      await close();
    }
  });

  it("does not surface an arbitrary error message", async () => {
    const getItem = vi.fn(async () => {
      throw new Error("database password is secret-123");
    });
    const { client, close } = await connect(stubEngine({ getItem }), ["read"]);

    try {
      const result = await client.callTool({ name: "get_item", arguments: { id: item.id } });

      expect(result.isError).toBe(true);
      expect(textOf(result as never)).toBe("Tool execution failed");
      expect(textOf(result as never)).not.toContain("secret-123");
    } finally {
      await close();
    }
  });
});
