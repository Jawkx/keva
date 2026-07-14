import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { FIELD_BY_KEY, isIsoInstant, isPropertyKey } from "@keva/schema";
import type {
  DownloadResult,
  ItemPatch,
  KevaItem,
  PropertyKeysResult,
  PropertyValuesResult,
  Query,
  QueryResult,
  UsageResult,
} from "@keva/schema";
import { z } from "zod";

const nonEmptyString = z.string().min(1);
const uniqueNonEmptyStrings = z
  .array(nonEmptyString)
  .min(1)
  .refine((values) => new Set(values).size === values.length, "Values must be unique");
const propertyValue = z.union([z.null(), nonEmptyString, uniqueNonEmptyStrings]);

const queryCondition = z
  .discriminatedUnion("op", [
    z.object({
      key: z.string().describe("System field key."),
      op: z.enum(["eq", "neq"]),
      value: z
        .union([z.null(), nonEmptyString, z.number()])
        .describe("Exact scalar operand. Numbers are valid only for numeric system fields."),
    }),
    z.object({
      key: z.string().describe("Comparable system field key."),
      op: z.enum(["gt", "gte", "lt", "lte"]),
      value: z
        .union([nonEmptyString, z.number()])
        .describe("Ordered scalar operand. Numbers are valid only for numeric system fields."),
    }),
    z.object({ key: z.string(), op: z.enum(["exists", "missing", "is_tag"]) }),
    z.object({ key: z.string(), op: z.literal("has_value"), value: nonEmptyString }),
    z.object({
      key: z.string(),
      op: z.enum(["has_any", "has_all", "contains_any"]),
      value: uniqueNonEmptyStrings.describe("Non-empty unique query operands."),
    }),
    z.object({ key: z.string(), op: z.literal("contains_text"), value: nonEmptyString }),
  ])
  .superRefine((condition, context) => {
    const field = FIELD_BY_KEY.get(condition.key);
    const fail = () =>
      context.addIssue({
        code: "custom",
        message: "Operator and value type are incompatible with the query key",
      });

    if (!field) {
      if (!isPropertyKey(condition.key)) return fail();
      if (
        ![
          "exists",
          "missing",
          "is_tag",
          "has_value",
          "has_any",
          "has_all",
          "contains_text",
          "contains_any",
        ].includes(condition.op)
      )
        fail();
      return;
    }

    if (condition.op === "exists" || condition.op === "missing") {
      if (field.required) fail();
      return;
    }
    if (["is_tag", "has_value", "has_any", "has_all"].includes(condition.op)) {
      fail();
      return;
    }
    if (condition.op === "eq" || condition.op === "neq") {
      if (condition.value === null) {
        if (field.required) fail();
        return;
      }
      if (field.queryType === "number") {
        if (typeof condition.value !== "number") fail();
        return;
      }
      if (typeof condition.value !== "string") return fail();
      if (field.queryType === "timestamp" && !isIsoInstant(condition.value)) fail();
      return;
    }
    if (
      condition.op === "gt" ||
      condition.op === "gte" ||
      condition.op === "lt" ||
      condition.op === "lte"
    ) {
      if (field.queryType === "number") {
        if (typeof condition.value !== "number") fail();
        return;
      }
      if (
        field.queryType !== "timestamp" ||
        typeof condition.value !== "string" ||
        !isIsoInstant(condition.value)
      )
        fail();
      return;
    }
    if (
      (condition.op === "contains_text" || condition.op === "contains_any") &&
      field.queryType !== "string" &&
      field.queryType !== "nullable-string"
    )
      fail();
  });

const queryArgs = z.object({
  where: z
    .array(queryCondition)
    .optional()
    .describe(
      "Conditions are ANDed. exists/missing test key presence, is_tag matches null, " +
        "has_value/has_any/has_all inspect exact array values, contains_text does a text substring match, " +
        "and contains_any matches any text or array substring from its value array. eq/neq/ordered comparisons apply only to system fields; numeric operands are valid only for numeric fields such as system.size.",
    ),
  search: z.string().max(256).optional().describe("Free-text match over item names."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Max items to return (default 100)."),
  cursor: z.string().optional().describe("Pagination cursor from a previous result."),
  order: z
    .enum(["created_at_asc", "created_at_desc"])
    .optional()
    .describe("Creation-time ordering (default ascending)."),
});

const itemIdArgs = z.object({
  id: z.string().describe("The item id."),
});

const propertyValuesArgs = z.object({
  key: z.string().describe("Property key to list distinct values for (e.g. 'tag', 'author')."),
});

export type PropertyValuesToolInput = { readonly key: string };

const setPropertiesArgs = z.object({
  id: z.string().describe("The item id."),
  set: z
    .record(z.string(), propertyValue)
    .optional()
    .describe(
      "Properties to set or overwrite using null, a non-empty string, or a non-empty array of unique non-empty strings. May include the writable 'name' field. " +
        "IMPORTANT: a null value does NOT delete the key — it sets a bare tag " +
        "(pure membership marker, e.g. {\"urgent\": null} tags the item 'urgent'). " +
        "To remove a property, list its key in 'unset' instead.",
    ),
  unset: z
    .array(z.string())
    .optional()
    .describe("Property keys to remove. This is the only way to delete a property."),
});

export type QueryToolInput = {
  readonly where?: z.infer<typeof queryCondition>[] | undefined;
  readonly search?: Query["search"] | undefined;
  readonly limit?: Query["limit"] | undefined;
  readonly cursor?: Query["cursor"] | undefined;
  readonly order?: Query["order"] | undefined;
};
export type SetPropertiesToolInput = {
  readonly id: string;
  readonly set?: ItemPatch["set"] | undefined;
  readonly unset?: ItemPatch["unset"] | undefined;
};

export interface McpEngine {
  readonly queryItems: (input: QueryToolInput) => Promise<QueryResult>;
  readonly getItem: (id: string) => Promise<KevaItem>;
  readonly getContentUrl: (id: string) => Promise<DownloadResult>;
  readonly getUsage: () => Promise<UsageResult>;
  readonly listPropertyKeys: () => Promise<PropertyKeysResult>;
  readonly listPropertyValues: (input: PropertyValuesToolInput) => Promise<PropertyValuesResult>;
  readonly setProperties: (input: SetPropertiesToolInput) => Promise<KevaItem>;
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
  const server = new McpServer(
    {
      name: options.serverName ?? "keva",
      version: options.serverVersion ?? "0.0.0",
    },
    {
      capabilities: { tools: {} },
    },
  );
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
      "get_usage",
      {
        title: "Get storage usage",
        description:
          "Get total storage usage: item count, total bytes, and a per-content-type breakdown.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      () => run(() => engine.getUsage()),
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
          "Set or unset an item's user properties (and the writable 'name' field). Other properties are left unchanged. " +
          "Note keva's null semantics: setting a key to null creates a bare TAG (membership marker), it does not clear the key — deletion is only via 'unset'.",
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

  if (!can("read") && !can("write") && !can("delete")) {
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
  }

  return server;
};
