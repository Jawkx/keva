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

export const scalarToInput = (value: PropertyValue): string =>
  typeof value === "string" ? value : "";

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

  for (const [key, value] of entries) {
    const keyError = validateKey(key);
    if (keyError) return { ok: false, error: `Key “${key}” — ${keyError}` };
    if (!Schema.is(PropertyValueSchema)(value))
      return { ok: false, error: `“${key}” has an invalid property value` };
  }

  const value = Object.fromEntries(entries) as Record<string, PropertyValue>;
  const failure = validateProperties(value);
  if (failure) return { ok: false, error: formatPropertyLimitFailure(failure) };
  return { ok: true, value };
};

const valuesEqual = (a: PropertyValue, b: PropertyValue): boolean => {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((item) => b.includes(item));
  return a === b;
};

export const diffProperties = (
  original: Record<string, PropertyValue>,
  next: Record<string, PropertyValue>,
): { set: Record<string, PropertyValue>; unset: string[] } => {
  const set: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(next)) {
    if (!(key in original) || !valuesEqual(original[key]!, value)) set[key] = value;
  }
  const unset = Object.keys(original).filter((key) => !(key in next));
  return { set, unset };
};

export const prettyJson = (value: Record<string, PropertyValue>): string =>
  Object.keys(value).length === 0 ? "{}" : JSON.stringify(value, null, 2);
