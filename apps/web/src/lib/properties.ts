import {
  PROPERTY_LIMITS,
  PropertyValue as PropertyValueSchema,
  formatPropertyLimitFailure,
  isPropertyKey,
  validateProperties,
  type PropertyValue,
} from "@keva/schema";
import { Schema } from "effect";

export type ValueType = "tag" | "single" | "multiple";

export const valueType = (value: PropertyValue): ValueType => {
  if (value === null) return "tag";
  if (Array.isArray(value)) return "multiple";
  return "single";
};

export type PropertyInputResult =
  | { readonly ok: true; readonly value: PropertyValue }
  | { readonly ok: false; readonly error: string };

export const buildPropertyValue = (
  type: ValueType,
  raw: string,
  values: readonly string[] = [],
): PropertyInputResult => {
  if (type === "tag") return { ok: true, value: null };
  if (type === "single") {
    const value = raw.trim();
    return value ? { ok: true, value } : { ok: false, error: "Enter a value" };
  }
  if (values.length === 0) return { ok: false, error: "Add at least one value" };
  if (values.some((value) => value.trim().length === 0))
    return { ok: false, error: "Values cannot be empty" };
  if (new Set(values).size !== values.length) return { ok: false, error: "Values must be unique" };
  return { ok: true, value: [...values] };
};

export const inferPropertyValue = (raw: string): PropertyInputResult => {
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (!raw.includes(",")) return { ok: true, value };

  const values = [
    ...new Set(
      raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  return buildPropertyValue("multiple", "", values);
};

export const scalarToInput = (value: PropertyValue): string =>
  Schema.is(Schema.String)(value) ? value : "";

export const validateKey = (key: string): string | null => {
  if (!key) return "Key is required";
  if (key.length > PROPERTY_LIMITS.keyLength)
    return `Key must be at most ${PROPERTY_LIMITS.keyLength} characters`;
  if (!isPropertyKey(key)) return "Use a non-reserved key with letters, digits, . _ -";
  return null;
};

export type ParseResult =
  | { ok: true; value: Record<string, PropertyValue> }
  | { ok: false; error: string };

const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

export const parsePropertiesJson = (text: string): ParseResult => {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `Invalid JSON — ${message}` };
  }
  if (!Schema.is(JsonObject)(data))
    return { ok: false, error: "The top level must be a JSON object" };

  const value: Record<string, PropertyValue> = {};
  for (const [key, entry] of Object.entries(data)) {
    const keyError = validateKey(key);
    if (keyError) return { ok: false, error: `Key “${key}” — ${keyError}` };
    if (!Schema.is(PropertyValueSchema)(entry))
      return { ok: false, error: `“${key}” has an invalid property value` };
    value[key] = entry;
  }

  const failure = validateProperties(value);
  if (failure) return { ok: false, error: formatPropertyLimitFailure(failure) };
  return { ok: true, value };
};

const valuesEqual = (a: PropertyValue, b: PropertyValue): boolean => {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item) => b.includes(item));
  return a === b;
};

export interface PropertyDiff {
  readonly set: Record<string, PropertyValue>;
  readonly unset: string[];
}

export const diffProperties = (
  original: Record<string, PropertyValue>,
  next: Record<string, PropertyValue>,
): PropertyDiff => {
  const set: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(next)) {
    if (!(key in original) || !valuesEqual(original[key]!, value)) set[key] = value;
  }
  const unset = Object.keys(original).filter((key) => !(key in next));
  return { set, unset };
};

export const prettyJson = (value: Record<string, PropertyValue>): string =>
  Object.keys(value).length === 0 ? "{}" : JSON.stringify(value, null, 2);
