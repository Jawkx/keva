import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { FIELD_BY_KEY, ITEM_ID_PATTERN, isIsoInstant, isPropertyKey } from "@keva/schema";
import type {
  BatchDeleteResult,
  CreateShareGrant,
  CreateShareGrantResult,
  CreateView,
  DownloadResult,
  ItemPatch,
  ItemEventsResult,
  InitiateUpload,
  OwnerInitiateUploadResult,
  OwnerItem,
  OwnerQueryResult,
  PropertyKeysResult,
  PropertySummaryResult,
  PropertyValuesResult,
  Query,
  ShareGrantRecord,
  UpdateView,
  UsageResult,
  ViewRecord,
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
  search: z
    .string()
    .max(256)
    .optional()
    .describe("Free-text match over item names and content types."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Max items to return (default 100)."),
  cursor: z.string().optional().describe("Pagination cursor from a previous result."),
  order: z
    .enum(["created_at_asc", "created_at_desc", "size_asc", "size_desc"])
    .optional()
    .describe("Creation-time or size ordering (default creation time ascending)."),
});

const itemIdArgs = z.object({
  id: z.string().regex(ITEM_ID_PATTERN).describe("The item id."),
});

const itemContentOutput = z.object({
  file_uri: z.object({
    download_url: z.string(),
    file_id: z.string(),
    mime_type: z.string(),
    file_name: z.string(),
  }),
  item_id: z.string().regex(ITEM_ID_PATTERN),
  size: z.number().int().nonnegative(),
  expires_at: z.string().refine(isIsoInstant, "Expected an ISO-8601 instant"),
});

const propertyValuesArgs = z.object({
  key: z
    .string()
    .refine(isPropertyKey, "Expected a non-reserved property key")
    .describe("Property key to list distinct values for (e.g. 'tag', 'author')."),
});

export type PropertyValuesToolInput = { readonly key: string };

const setPropertiesArgs = z
  .object({
    id: z.string().regex(ITEM_ID_PATTERN).describe("The item id."),
    expectedRevision: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Reject the edit if the item no longer has this revision."),
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
      .array(z.string().min(1))
      .refine((values) => new Set(values).size === values.length, "Keys must be unique")
      .optional()
      .describe("Property keys to remove. This is the only way to delete a property."),
  })
  .refine(
    (input) => Object.keys(input.set ?? {}).length > 0 || (input.unset?.length ?? 0) > 0,
    "At least one property must be set or unset",
  );

const uploadArgs = z.object({
  name: nonEmptyString.describe("File name."),
  contentType: nonEmptyString.describe("MIME content type."),
  size: z
    .number()
    .int()
    .min(0)
    .max(5 * 1024 * 1024 * 1024)
    .describe("Exact byte size."),
  source: nonEmptyString.default("upload").describe("Item source label (default 'upload')."),
  properties: z.record(z.string(), propertyValue).default({}),
  retryKey: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Stable key for safely retrying initiation."),
});

const uploadContentArgs = z.object({
  name: nonEmptyString.describe("File name."),
  contentType: nonEmptyString.default("text/plain"),
  content: z.string().max(1_500_000).describe("UTF-8 text or base64-encoded file content."),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  source: nonEmptyString.default("mcp"),
  properties: z.record(z.string(), propertyValue).default({}),
});

const itemEventsArgs = itemIdArgs.extend({
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});

const deleteItemsArgs = z.object({
  ids: z.array(z.string().regex(ITEM_ID_PATTERN)).min(1).max(1000),
});

const viewIdArgs = z.object({ id: nonEmptyString.describe("Saved view id.") });
const createViewArgs = z.object({
  name: nonEmptyString,
  icon: nonEmptyString.optional(),
  conditions: z.array(queryCondition),
});
const updateViewArgs = viewIdArgs
  .extend({
    name: nonEmptyString.optional(),
    icon: nonEmptyString.optional(),
    conditions: z.array(queryCondition).optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined || input.icon !== undefined || input.conditions !== undefined,
    "At least one view field must be updated",
  );

const shareIdArgs = z.object({ id: nonEmptyString.describe("Share id.") });
const createShareArgs = z
  .object({
    name: nonEmptyString,
    viewId: nonEmptyString.optional(),
    view: createViewArgs.optional(),
    scopes: z.array(z.enum(["read", "write"])).min(1),
    writeStamp: z.record(z.string(), propertyValue).optional(),
    maxItemBytes: z.number().int().positive().optional(),
    maxTotalBytes: z.number().int().positive().optional(),
    maxItems: z.number().int().positive().optional(),
    expiresAt: z.string().refine(isIsoInstant, "Expected an ISO-8601 instant").optional(),
  })
  .refine((input) => (input.viewId === undefined) !== (input.view === undefined), {
    message: "A share requires exactly one view reference",
  })
  .refine((input) => !input.scopes.includes("write") || input.writeStamp !== undefined, {
    message: "Write shares require a writeStamp",
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
  readonly expectedRevision?: number | undefined;
};
export type ItemEventsToolInput = {
  readonly id: string;
  readonly limit?: number | undefined;
  readonly cursor?: string | undefined;
};
export type UploadContentToolInput = z.infer<typeof uploadContentArgs>;

export interface McpItemContent {
  readonly item: OwnerItem;
  readonly download: DownloadResult;
}

export interface McpEngine {
  readonly queryItems: (input: QueryToolInput) => Promise<OwnerQueryResult>;
  readonly getItem: (id: string) => Promise<OwnerItem>;
  readonly getItemContent: (id: string) => Promise<McpItemContent>;
  readonly getItemEvents: (input: ItemEventsToolInput) => Promise<ItemEventsResult>;
  readonly getUsage: () => Promise<UsageResult>;
  readonly listPropertyKeys: () => Promise<PropertyKeysResult>;
  readonly listPropertyValues: (input: PropertyValuesToolInput) => Promise<PropertyValuesResult>;
  readonly getPropertySummary: () => Promise<PropertySummaryResult>;
  readonly beginUpload: (input: InitiateUpload) => Promise<OwnerInitiateUploadResult>;
  readonly completeUpload: (id: string) => Promise<OwnerItem>;
  readonly uploadContent: (input: UploadContentToolInput) => Promise<OwnerItem>;
  readonly setProperties: (input: SetPropertiesToolInput) => Promise<OwnerItem>;
  readonly deleteItem: (id: string) => Promise<void>;
  readonly deleteItems: (ids: readonly string[]) => Promise<BatchDeleteResult>;
  readonly createView: (input: CreateView) => Promise<ViewRecord>;
  readonly listViews: () => Promise<readonly ViewRecord[]>;
  readonly getView: (id: string) => Promise<ViewRecord>;
  readonly updateView: (id: string, input: UpdateView) => Promise<ViewRecord>;
  readonly deleteView: (id: string) => Promise<{ readonly deleted: boolean }>;
  readonly createShare: (input: CreateShareGrant) => Promise<CreateShareGrantResult>;
  readonly listShares: () => Promise<readonly ShareGrantRecord[]>;
  readonly revokeShare: (id: string) => Promise<{ readonly revoked: boolean }>;
}

export interface KevaMcpServerOptions {
  // The caller's keva scopes. Tools are registered only when their scope is
  // granted, so a read-only token's tools/list omits writes entirely.
  readonly scopes: readonly string[];
  readonly serverName?: string;
  readonly serverVersion?: string;
}

export class ClientSafeToolError extends Error {}

const ok = (data: unknown): CallToolResult => ({
  content: [
    { type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) },
  ],
});

const fail = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

const runResult = async (fn: () => Promise<CallToolResult>): Promise<CallToolResult> => {
  try {
    return await fn();
  } catch (error) {
    return fail(error instanceof ClientSafeToolError ? error.message : "Tool execution failed");
  }
};

const run = (fn: () => Promise<unknown>): Promise<CallToolResult> =>
  runResult(async () => ok(await fn()));

const itemContentResult = ({ item, download }: McpItemContent): CallToolResult => {
  const size = item.size ?? item.declaredSize;
  const reference = {
    download_url: download.url,
    file_id: item.id,
    mime_type: item.contentType,
    file_name: item.name,
    size,
    expires_at: download.expiresAt,
  };
  return {
    structuredContent: {
      file_uri: {
        download_url: reference.download_url,
        file_id: reference.file_id,
        mime_type: reference.mime_type,
        file_name: reference.file_name,
      },
      item_id: reference.file_id,
      size: reference.size,
      expires_at: reference.expires_at,
    },
    content: [
      {
        type: "text",
        text: JSON.stringify(reference, null, 2),
      },
      {
        type: "resource_link",
        uri: reference.download_url,
        name: reference.file_name,
        mimeType: reference.mime_type,
        size: reference.size,
      },
    ],
  };
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
      "get_item_content",
      {
        title: "Get item content",
        description:
          "Get an item's file contents as a transferable file reference with its name, MIME type, size, and short-lived download access.",
        inputSchema: itemIdArgs.shape,
        outputSchema: itemContentOutput.shape,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      ({ id }) => runResult(async () => itemContentResult(await engine.getItemContent(id))),
    );

    server.registerTool(
      "get_item_events",
      {
        title: "Get item activity",
        description: "Get an item's audit history, newest first, including actor snapshots.",
        inputSchema: itemEventsArgs.shape,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      (input) => run(() => engine.getItemEvents(input)),
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

    server.registerTool(
      "get_property_summary",
      {
        title: "Get property summary",
        description:
          "List property keys with their observed shapes (tag, string, or array) and scalar values.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      () => run(() => engine.getPropertySummary()),
    );
  }

  if (can("write")) {
    server.registerTool(
      "begin_upload",
      {
        title: "Begin file upload",
        description:
          "Create a pending item and return uploadUrl, required headers, and an item id. The MCP host must PUT exactly 'size' bytes to uploadUrl using every returned header. Do not send Keva OAuth credentials to the storage URL. Call complete_upload only after the PUT returns a successful 2xx response.",
        inputSchema: uploadArgs.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      (input) => run(() => engine.beginUpload(input)),
    );

    server.registerTool(
      "complete_upload",
      {
        title: "Complete file upload",
        description:
          "Confirm a pending item after its presigned PUT succeeded and make it available in Keva. Do not call this before uploading the exact declared byte size. If the upload URL expired, call begin_upload again instead.",
        inputSchema: itemIdArgs.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ id }) => run(() => engine.completeUpload(id)),
    );

    server.registerTool(
      "upload_content",
      {
        title: "Upload small file content",
        description:
          "Upload UTF-8 text or base64-encoded bytes as a file in one call. Decoded content is limited to 1 MiB. Base64 must contain encoded data only, without a data: URL prefix. Use begin_upload followed by an external PUT and complete_upload for larger files.",
        inputSchema: uploadContentArgs.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      (input) => run(() => engine.uploadContent(input)),
    );

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

    server.registerTool(
      "delete_items",
      {
        title: "Delete items",
        description:
          "Permanently delete up to 1000 items, returning separate deleted and failed results.",
        inputSchema: deleteItemsArgs.shape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ ids }) => run(() => engine.deleteItems(ids)),
    );
  }

  if (can("views")) {
    server.registerTool(
      "create_view",
      {
        title: "Create saved view",
        description: "Create a named saved view from query conditions.",
        inputSchema: createViewArgs.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      (input) => run(() => engine.createView(input)),
    );
    server.registerTool(
      "list_views",
      {
        title: "List saved views",
        description: "List the user's saved views.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      () => run(() => engine.listViews()),
    );
    server.registerTool(
      "get_view",
      {
        title: "Get saved view",
        description: "Get one saved view by id.",
        inputSchema: viewIdArgs.shape,
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      ({ id }) => run(() => engine.getView(id)),
    );
    server.registerTool(
      "update_view",
      {
        title: "Update saved view",
        description:
          "Update a saved view's name, icon, and/or conditions. If active shares use the view, this immediately changes their access and requires shares plus each delegated read/write scope.",
        inputSchema: updateViewArgs.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      ({ id, ...input }) => run(() => engine.updateView(id, input)),
    );
    server.registerTool(
      "delete_view",
      {
        title: "Delete saved view",
        description:
          "Delete a saved view and revoke its associated share links. Items remain intact.",
        inputSchema: viewIdArgs.shape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ id }) => run(() => engine.deleteView(id)),
    );
  }

  if (can("shares")) {
    server.registerTool(
      "create_share",
      {
        title: "Create share link",
        description:
          "Create a share for an existing saved view or a new inline view. Download shares require read access; upload shares require write access. The secret token is returned only once.",
        inputSchema: createShareArgs.shape,
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      (input) => run(() => engine.createShare(input)),
    );
    server.registerTool(
      "list_shares",
      {
        title: "List share links",
        description:
          "List active share-link names, filters, scopes, limits, and expiry information without secret tokens.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      () => run(() => engine.listShares()),
    );
    server.registerTool(
      "revoke_share",
      {
        title: "Revoke share link",
        description: "Immediately and permanently revoke a share link.",
        inputSchema: shareIdArgs.shape,
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      ({ id }) => run(() => engine.revokeShare(id)),
    );
  }

  if (!can("read") && !can("write") && !can("delete") && !can("views") && !can("shares")) {
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
  }

  return server;
};
