import { Schema } from "effect";
import type { KevaItem, PropertyValue } from "./index.js";

// An item is a tenant-scoped bag of key→value pairs. Most keys are undeclared
// *user properties*: owned by the user, stored loosely-typed in the JSON blob.
// A field descriptor exists only for a key that DEVIATES from that default —
// because the system owns it, or because it is materialized into its own column
// for indexing / typing / required-ness.
//
// `owner` is the only thing that governs writability ("user" → patchable,
// "system" → read-only). Storage (`column` for SQL, `itemField` for the
// in-memory record) is an implementation detail that never surfaces in the API.
// This list is the single source of truth: query-key validation, patch routing,
// and both stores' key mappings all derive from it.

export const PROPERTY_LIMITS = {
  keys: 256,
  keyLength: 128,
  stringBytes: 8 * 1024,
  arrayItems: 256,
  totalBytes: 64 * 1024,
} as const;

export const queryKeyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const RESERVED_PREFIXES = ["system.", "keva."] as const;

export const isReservedKey = (key: string): boolean =>
  RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));

// A key a user may freely set/unset as a property (the open long tail).
export const isPropertyKey = (key: string): boolean =>
  queryKeyPattern.test(key) && key.length <= PROPERTY_LIMITS.keyLength && !isReservedKey(key);

export type FieldOwner = "user" | "system";
export type FieldQueryType = "string" | "number" | "nullable-string" | "timestamp";

export interface FieldDescriptor {
  /** Canonical key in the unified key-space (e.g. "name", "system.size"). */
  readonly key: string;
  /** "user" → user-writable; "system" → engine-owned, read-only. */
  readonly owner: FieldOwner;
  /** Settable but never unsettable (NOT NULL column). */
  readonly required: boolean;
  /** Physical SQL column — storage detail, never part of the API. */
  readonly column: string;
  /** Accessor on the in-memory KevaItem record — storage detail. */
  readonly itemField: keyof KevaItem;
  /** How this column compares in queries. */
  readonly queryType: FieldQueryType;
  /** Stricter value schema enforced on user writes (user-owned keys only). */
  readonly valueSchema?: Schema.Schema<string, string>;
}

export const FIELDS: readonly FieldDescriptor[] = [
  {
    key: "id",
    owner: "system",
    required: true,
    column: "id",
    itemField: "id",
    queryType: "string",
  },
  {
    key: "name",
    owner: "user",
    required: true,
    column: "name",
    itemField: "name",
    queryType: "string",
    valueSchema: Schema.NonEmptyString,
  },
  {
    key: "system.content_type",
    owner: "system",
    required: true,
    column: "content_type",
    itemField: "contentType",
    queryType: "string",
  },
  {
    key: "system.size",
    owner: "system",
    required: false,
    column: "size",
    itemField: "size",
    queryType: "number",
  },
  {
    key: "system.etag",
    owner: "system",
    required: false,
    column: "etag",
    itemField: "etag",
    queryType: "nullable-string",
  },
  {
    key: "system.checksum",
    owner: "system",
    required: false,
    column: "checksum",
    itemField: "checksum",
    queryType: "nullable-string",
  },
  {
    key: "system.source",
    owner: "system",
    required: true,
    column: "source",
    itemField: "source",
    queryType: "string",
  },
  {
    key: "system.status",
    owner: "system",
    required: true,
    column: "status",
    itemField: "status",
    queryType: "string",
  },
  {
    key: "system.created_at",
    owner: "system",
    required: true,
    column: "created_at",
    itemField: "createdAt",
    queryType: "timestamp",
  },
  {
    key: "system.updated_at",
    owner: "system",
    required: true,
    column: "updated_at",
    itemField: "updatedAt",
    queryType: "timestamp",
  },
];

export const FIELD_BY_KEY: ReadonlyMap<string, FieldDescriptor> = new Map(
  FIELDS.map((field) => [field.key, field]),
);

// A key is queryable if it is a declared field or a valid user-property key.
// (`keva.`-prefixed keys pass the pattern but match nothing — preserved as-is.)
export const isQueryKey = (key: string): boolean =>
  FIELD_BY_KEY.has(key) || (!key.startsWith("system.") && queryKeyPattern.test(key));

export interface RoutedPatch {
  /** User-writable column fields, keyed by canonical field key (e.g. "name"). */
  readonly fields: Readonly<Record<string, PropertyValue>>;
  readonly set: Readonly<Record<string, PropertyValue>>;
  readonly unset: readonly string[];
}

export interface PatchRouteError {
  readonly key: string;
  readonly reason: string;
}

// Routes a flat {set, unset} patch over the unified key-space into a column
// write (user-owned declared fields) plus a property merge (everything else),
// rejecting any write to a system-owned or otherwise-invalid key. This is the
// one place the user/system writability boundary is enforced.
export const routePatch = (
  set: Readonly<Record<string, PropertyValue>>,
  unset: readonly string[],
): { ok: true; routed: RoutedPatch } | { ok: false; error: PatchRouteError } => {
  const fields: Record<string, PropertyValue> = {};
  const properties: Record<string, PropertyValue> = {};

  for (const [key, value] of Object.entries(set)) {
    const field = FIELD_BY_KEY.get(key);
    if (field) {
      if (field.owner === "system") {
        return { ok: false, error: { key, reason: "field is read-only" } };
      }
      if (field.valueSchema && !Schema.is(field.valueSchema)(value)) {
        return { ok: false, error: { key, reason: "invalid value for field" } };
      }
      fields[key] = value;
      continue;
    }
    if (!isPropertyKey(key)) {
      return { ok: false, error: { key, reason: "invalid or reserved key" } };
    }
    properties[key] = value;
  }

  for (const key of unset) {
    if (FIELD_BY_KEY.has(key)) {
      return { ok: false, error: { key, reason: "field cannot be unset" } };
    }
    if (!isPropertyKey(key)) {
      return { ok: false, error: { key, reason: "invalid or reserved key" } };
    }
  }

  return { ok: true, routed: { fields, set: properties, unset } };
};
