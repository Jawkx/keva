import type { PropertyValue } from "@keva/schema";

// Client-side mirror of the property rules enforced by @keva/schema. The web
// app only imports the *types* from that package (not Effect's runtime
// validators), so we re-declare the constraints here to give immediate,
// inline feedback before a patch is ever sent.
export const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
export const KEY_MAX = 128;
export const MAX_KEYS = 256;
export const MAX_TOTAL_BYTES = 64 * 1024;
export const MAX_ARRAY_ITEMS = 256;

// Scalars are the only types the Form view edits directly; arrays are shown
// read-only there and edited through the JSON view.
export type ScalarType = "string" | "number" | "boolean" | "null";
export type ValueType = ScalarType | "array";

export const SCALAR_TYPES: ScalarType[] = [
  "string",
  "number",
  "boolean",
  "null",
];

// Short, dev-friendly labels for the type pill.
export const TYPE_LABEL: Record<ValueType, string> = {
  string: "str",
  number: "num",
  boolean: "bool",
  null: "null",
  array: "list",
};

export const valueType = (value: PropertyValue): ValueType => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
};

// What you most likely meant by typing `raw`. Null is never inferred — it's an
// explicit choice — so a value-first flow stays predictable.
export const inferScalarType = (
  raw: string,
): Exclude<ScalarType, "null"> => {
  const trimmed = raw.trim();
  if (trimmed === "true" || trimmed === "false") return "boolean";
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return "number";
  return "string";
};

// Turn the editing string + chosen type into a concrete scalar value.
export const coerceScalar = (type: ScalarType, raw: string): PropertyValue => {
  if (type === "null") return null;
  if (type === "boolean") return raw.trim() === "true";
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  return raw;
};

// The string a scalar should seed its input with when you start editing it.
export const scalarToInput = (value: PropertyValue): string => {
  if (value === null || Array.isArray(value)) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

export const validateKey = (key: string): string | null => {
  if (!key) return "Key is required";
  if (key.length > KEY_MAX) return `Key must be at most ${KEY_MAX} characters`;
  if (!KEY_PATTERN.test(key))
    return "Use letters, digits, . _ - and start with a letter or digit";
  if (key.startsWith("system.") || key.startsWith("keva."))
    return "Keys cannot use the system. or keva. namespaces";
  return null;
};

const encodedBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const validateValue = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number")
    return Number.isFinite(value) ? null : "Numbers must be finite";
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS)
      return `Arrays may have at most ${MAX_ARRAY_ITEMS} items`;
    const itemType = typeof value[0];
    if (itemType !== "string" && itemType !== "number" && itemType !== "boolean")
      return "Arrays must contain strings, numbers, or booleans";
    return value.every((item) => typeof item === itemType)
      ? null
      : "Array items must all be the same type";
  }
  return "Nested objects are not allowed";
};

export type ParseResult =
  | { ok: true; value: Record<string, PropertyValue> }
  | { ok: false; error: string };

// Parse the JSON-view text and validate every key/value against the schema
// rules, returning either the typed object or a single human-readable error.
export const parsePropertiesJson = (text: string): ParseResult => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Invalid JSON — ${(err as Error).message}` };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data))
    return { ok: false, error: "The top level must be a JSON object" };

  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length > MAX_KEYS)
    return { ok: false, error: `At most ${MAX_KEYS} properties are allowed` };

  for (const [key, value] of entries) {
    const keyError = validateKey(key);
    if (keyError) return { ok: false, error: `Key “${key}” — ${keyError}` };
    const valueError = validateValue(value);
    if (valueError) return { ok: false, error: `“${key}” — ${valueError}` };
  }

  const value = Object.fromEntries(entries) as Record<string, PropertyValue>;
  if (encodedBytes(value) > MAX_TOTAL_BYTES)
    return { ok: false, error: "Properties exceed the 64 KB limit" };
  return { ok: true, value };
};

const valuesEqual = (a: PropertyValue, b: PropertyValue): boolean => {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item, i) => item === b[i]);
  return a === b;
};

// The minimal patch that turns `original` into `next`: only changed/added keys
// go in `set`, removed keys go in `unset`.
export const diffProperties = (
  original: Record<string, PropertyValue>,
  next: Record<string, PropertyValue>,
): { set: Record<string, PropertyValue>; unset: string[] } => {
  const set: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(next)) {
    if (!(key in original) || !valuesEqual(original[key]!, value))
      set[key] = value;
  }
  const unset = Object.keys(original).filter((key) => !(key in next));
  return { set, unset };
};

export const prettyJson = (value: Record<string, PropertyValue>): string =>
  Object.keys(value).length === 0 ? "{}" : JSON.stringify(value, null, 2);
