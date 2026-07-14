import { Schema } from "effect";
import type { KevaItem, PropertyValue } from "./index.js";

// Field descriptors are the single source of truth for query validation, patch
// routing, and storage mappings; `owner` governs API writability.

export const PROPERTY_LIMITS = {
  keys: 256,
  keyLength: 128,
  stringBytes: 8 * 1024,
  arrayItems: 256,
  totalBytes: 64 * 1024,
} as const;

export type PropertyLimitFailure =
  | "invalid-key"
  | "too-many-keys"
  | "invalid-value"
  | "too-many-bytes";

export const formatPropertyLimitFailure = (failure: PropertyLimitFailure): string => {
  switch (failure) {
    case "invalid-key":
      return "Properties contain an invalid or reserved key";
    case "too-many-keys":
      return `At most ${PROPERTY_LIMITS.keys} properties are allowed`;
    case "invalid-value":
      return "Properties contain an invalid value";
    case "too-many-bytes":
      return `Properties exceed the ${PROPERTY_LIMITS.totalBytes / 1024} KB limit`;
  }
};

const encodedBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const stringBytes = (value: string): number => new TextEncoder().encode(value).byteLength;

export const canonicalizePropertyValue = (value: PropertyValue): PropertyValue =>
  Array.isArray(value) ? [...value].sort() : value;

export const canonicalizeProperties = (
  properties: Readonly<Record<string, PropertyValue>>,
): Record<string, PropertyValue> =>
  Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [key, canonicalizePropertyValue(value)]),
  );

export const propertyValuesEqual = (
  left: PropertyValue | undefined,
  right: PropertyValue | undefined,
): boolean => {
  if (!Array.isArray(left) || !Array.isArray(right)) return Object.is(left, right);
  return left.length === right.length && left.every((value) => right.includes(value));
};

export const queryKeyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const RESERVED_PREFIXES = ["system.", "keva."] as const;

export const isReservedKey = (key: string): boolean =>
  RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));

export const isPropertyKey = (key: string): boolean =>
  queryKeyPattern.test(key) && key.length <= PROPERTY_LIMITS.keyLength && !isReservedKey(key);

const isPropertyValueWithinLimits = (value: PropertyValue): boolean => {
  if (typeof value === "string")
    return value.length > 0 && stringBytes(value) <= PROPERTY_LIMITS.stringBytes;
  if (!Array.isArray(value)) return true;
  return (
    value.length > 0 &&
    value.length <= PROPERTY_LIMITS.arrayItems &&
    new Set(value).size === value.length &&
    value.every(
      (entry) =>
        typeof entry === "string" &&
        entry.length > 0 &&
        stringBytes(entry) <= PROPERTY_LIMITS.stringBytes,
    )
  );
};

export const validateProperties = (
  properties: Readonly<Record<string, PropertyValue>>,
): PropertyLimitFailure | null => {
  const entries = Object.entries(properties);
  if (!entries.every(([key]) => isPropertyKey(key))) return "invalid-key";
  if (entries.length > PROPERTY_LIMITS.keys) return "too-many-keys";
  if (!entries.every(([, value]) => isPropertyValueWithinLimits(value))) return "invalid-value";
  return encodedBytes(properties) <= PROPERTY_LIMITS.totalBytes ? null : "too-many-bytes";
};

export type FieldOwner = "user" | "system";
export type FieldQueryType = "string" | "number" | "nullable-string" | "timestamp";

export interface FieldDescriptor {
  readonly key: string;
  readonly owner: FieldOwner;
  readonly required: boolean;
  readonly column: string;
  readonly itemField: keyof KevaItem;
  readonly queryType: FieldQueryType;
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
export const isQueryKey = (key: string): boolean => FIELD_BY_KEY.has(key) || isPropertyKey(key);

export interface RoutedPatch {
  readonly fields: Readonly<Record<string, PropertyValue>>;
  readonly set: Readonly<Record<string, PropertyValue>>;
  readonly unset: readonly string[];
}

export interface PatchRouteError {
  readonly key: string;
  readonly reason: string;
}

// This is the sole user/system writability boundary for patches.
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
    properties[key] = canonicalizePropertyValue(value);
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
