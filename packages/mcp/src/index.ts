import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

// keva exposes its read/query/property surface to agents over MCP. This package
// declares *what tools exist* and delegates each to an injected `McpEngine`; it
// holds no keva rules. Authorization (scopes, tenancy, validation) stays in
// @keva/core, reached through the engine the host (apps/server) provides. The
// package is deliberately free of Effect and @keva/schema — zod is the only
// schema library, confined to this MCP boundary.

const propertyScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const propertyValue = z.union([propertyScalar, z.array(propertyScalar)]);

// Mirrors @keva/schema's Query/QueryCondition. The engine re-decodes input
// against the canonical Effect schema, so this is the user-facing contract, not
// the authority on validity.
const queryArgs = z.object({
  where: z
    .array(
      z.object({
        key: z.string().describe("Property key to match (e.g. 'tag', 'author')."),
        op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists"]),
        value: propertyScalar
          .optional()
          .describe("Comparison value; omit for the 'exists' operator."),
      }),
    )
    .optional()
    .describe("Property conditions, ANDed together."),
  search: z.string().max(256).optional().describe("Free-text match over item names."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Max items to return (default 100)."),
  cursor: z.string().optional().describe("Pagination cursor from a previous result."),
});

const itemIdArgs = z.object({
  id: z.string().describe("The item id."),
});

const propertyValuesArgs = z.object({
  key: z.string().describe("Property key to list distinct values for (e.g. 'tag', 'author')."),
});

export type PropertyValuesToolInput = z.infer<typeof propertyValuesArgs>;

const setPropertiesArgs = z.object({
  id: z.string().describe("The item id."),
  set: z
    .record(z.string(), propertyValue)
    .optional()
    .describe("Properties to set or overwrite. May include the writable 'name' field."),
  unset: z.array(z.string()).optional().describe("Property keys to remove."),
});

export type QueryToolInput = z.infer<typeof queryArgs>;
export type SetPropertiesToolInput = z.infer<typeof setPropertiesArgs>;

// The engine the host injects. Inputs are the parsed tool arguments; outputs are
// plain JSON the tools serialize into text content. Implementations throw on
// failure with a client-safe message (see apps/server's adapter, which maps
// typed KevaErrors to Error.message and never leaks internals).
export interface McpEngine {
  readonly queryItems: (input: QueryToolInput) => Promise<unknown>;
  readonly getItem: (id: string) => Promise<unknown>;
  readonly getContentUrl: (id: string) => Promise<unknown>;
  readonly listPropertyKeys: () => Promise<unknown>;
  readonly listPropertyValues: (input: PropertyValuesToolInput) => Promise<unknown>;
  readonly setProperties: (input: SetPropertiesToolInput) => Promise<unknown>;
  readonly deleteItem: (id: string) => Promise<void>;
}

export interface KevaMcpServerOptions {
  // The caller's keva scopes. Tools are registered only when their scope is
  // granted, so a read-only token's tools/list omits writes entirely.
  readonly scopes: readonly string[];
  readonly serverName?: string;
  readonly serverVersion?: string;
}

const ok = (data: unknown): CallToolResult => ({
  content: [
    { type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) },
  ],
});

const fail = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

const run = async (fn: () => Promise<unknown>): Promise<CallToolResult> => {
  try {
    return ok(await fn());
  } catch (error) {
    // The engine surfaces only client-safe messages; anything else is a defect
    // and is reported generically rather than leaked.
    return fail(error instanceof Error ? error.message : "Tool execution failed");
  }
};

export const createKevaMcpServer = (
  engine: McpEngine,
  options: KevaMcpServerOptions,
): McpServer => {
  const server = new McpServer({
    name: options.serverName ?? "keva",
    version: options.serverVersion ?? "0.0.0",
  });
  const can = (scope: string): boolean => options.scopes.includes(scope);

  if (can("read")) {
    server.registerTool(
      "query_items",
      {
        title: "Query items",
        description:
          "Find items by property conditions and/or a name search. Returns matching items with their metadata and properties.",
        inputSchema: queryArgs.shape,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      (input) => run(() => engine.queryItems(input)),
    );

    server.registerTool(
      "get_item",
      {
        title: "Get item",
        description: "Fetch a single item's metadata and properties by id.",
        inputSchema: itemIdArgs.shape,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ id }) => run(() => engine.getItem(id)),
    );

    server.registerTool(
      "get_content_url",
      {
        title: "Get content URL",
        description: "Get a short-lived, presigned download URL for an item's file contents.",
        inputSchema: itemIdArgs.shape,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ id }) => run(() => engine.getContentUrl(id)),
    );

    server.registerTool(
      "list_property_keys",
      {
        title: "List property keys",
        description:
          "List the distinct property keys used across items, for discovering what can be queried or set.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      () => run(() => engine.listPropertyKeys()),
    );

    server.registerTool(
      "list_property_values",
      {
        title: "List property values",
        description:
          "List the distinct scalar values seen for a single property key, for discovering valid filter values.",
        inputSchema: propertyValuesArgs.shape,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      (input) => run(() => engine.listPropertyValues(input)),
    );
  }

  if (can("write")) {
    server.registerTool(
      "set_properties",
      {
        title: "Set properties",
        description:
          "Set or unset an item's user properties (and the writable 'name' field). Other properties are left unchanged.",
        inputSchema: setPropertiesArgs.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      (input) => run(() => engine.setProperties(input)),
    );
  }

  if (can("delete")) {
    server.registerTool(
      "delete_item",
      {
        title: "Delete item",
        description: "Permanently delete an item and its file contents.",
        inputSchema: itemIdArgs.shape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ id }) =>
        run(async () => {
          await engine.deleteItem(id);
          return `Deleted item ${id}`;
        }),
    );
  }

  return server;
};
