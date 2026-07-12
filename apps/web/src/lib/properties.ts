import {
  PROPERTY_LIMITS,
  PropertyValue as PropertyValueSchema,
  formatPropertyLimitFailure,
  isPropertyKey,
  validateProperties,
  type PropertyValue,
} from "@keva/schema";
import { Schema } from "effect";

export type ScalarType = "string" | "number" | "boolean" | "null";
export type ValueType = ScalarType | "array";

export const valueType = (value: PropertyValue): ValueType => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
};

export type CoerceScalarResult =
  | { readonly ok: true; readonly value: PropertyValue }
  | { readonly ok: false; readonly error: string };

export const coerceScalar = (type: ScalarType, raw: string): CoerceScalarResult => {
  if (type === "null") return { ok: true, value: null };
  if (type === "boolean") return { ok: true, value: raw.trim().toLowerCase() === "true" };
  if (type === "number") {
    if (raw.trim() === "") return { ok: false, error: "Enter a number" };
    const n = Number(raw);
    return Number.isFinite(n)
      ? { ok: true, value: n }
      : { ok: false, error: "Enter a finite number" };
  }
  return { ok: true, value: raw };
};

export const scalarToInput = (value: PropertyValue): string => {
  if (value === null || Array.isArray(value)) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

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
    return a.length === b.length && a.every((item, i) => item === b[i]);
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
