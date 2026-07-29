import { FIELD_BY_KEY } from "./fields.js";
import type { KevaItem, Properties, PropertyValue, QueryCondition } from "./index.js";

interface Candidate {
  readonly exists: boolean;
  readonly value: PropertyValue | string | number | null;
}

const itemValueAt = (item: KevaItem, key: string): Candidate => {
  const field = FIELD_BY_KEY.get(key);
  if (field) {
    const value = item[field.itemField] as PropertyValue | string | number | null;
    return { exists: true, value: value ?? null };
  }
  return propertiesValueAt(item.properties, key);
};

// Resolve a key against a bare property blob. Used for writeStamp validation,
// where there is no surrounding KevaItem — a share's writeStamp is exactly the
// `properties` a future upload will carry, so this must match the property-blob
// branch of `itemValueAt` precisely.
const propertiesValueAt = (properties: Properties, key: string): Candidate =>
  Object.prototype.hasOwnProperty.call(properties, key)
    ? { exists: true, value: properties[key] ?? null }
    : { exists: false, value: null };

const values = (value: PropertyValue | string | number | null): readonly string[] =>
  Array.isArray(value) ? value : typeof value === "string" ? [value] : [];

const evaluate = (candidate: Candidate, condition: QueryCondition): boolean => {
  const field = FIELD_BY_KEY.get(condition.key);
  if (condition.op === "exists") return field ? candidate.value !== null : candidate.exists;
  if (condition.op === "missing") return field ? candidate.value === null : !candidate.exists;
  if (!candidate.exists) return false;
  const operand = condition.value;
  if (!field) {
    const members = values(candidate.value);
    if (condition.op === "is_tag") return candidate.value === null;
    if (condition.op === "has_value") return members.includes(operand as string);
    if (condition.op === "has_any")
      return (operand as readonly string[]).some((value) => members.includes(value));
    if (condition.op === "has_all")
      return (operand as readonly string[]).every((value) => members.includes(value));
    if (condition.op === "contains_text")
      return members.some((value) => value.includes(operand as string));
    if (condition.op === "contains_any")
      return (operand as readonly string[]).some((text) =>
        members.some((value) => value.includes(text)),
      );
    return false;
  }
  switch (condition.op) {
    case "in":
      return (
        typeof candidate.value === "string" &&
        (operand as readonly string[]).includes(candidate.value)
      );
    case "eq": {
      if (
        field.queryType === "timestamp" &&
        typeof candidate.value === "string" &&
        typeof operand === "string"
      )
        return Date.parse(candidate.value) === Date.parse(operand);
      return Object.is(candidate.value, operand);
    }
    case "neq": {
      if (
        field.queryType === "timestamp" &&
        typeof candidate.value === "string" &&
        typeof operand === "string"
      )
        return Date.parse(candidate.value) !== Date.parse(operand);
      return !Object.is(candidate.value, operand);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (
        typeof candidate.value !== typeof operand ||
        (typeof candidate.value !== "number" && typeof candidate.value !== "string")
      )
        return false;
      const left = candidate.value;
      const right = operand as number | string;
      if (
        field.queryType === "timestamp" &&
        typeof left === "string" &&
        typeof right === "string"
      ) {
        const leftTime = Date.parse(left);
        const rightTime = Date.parse(right);
        if (condition.op === "gt") return leftTime > rightTime;
        if (condition.op === "gte") return leftTime >= rightTime;
        if (condition.op === "lt") return leftTime < rightTime;
        return leftTime <= rightTime;
      }
      if (typeof left === "number" && typeof right === "number") {
        if (condition.op === "gt") return left > right;
        if (condition.op === "gte") return left >= right;
        if (condition.op === "lt") return left < right;
        return left <= right;
      }
      if (typeof left === "string" && typeof right === "string") {
        if (condition.op === "gt") return left > right;
        if (condition.op === "gte") return left >= right;
        if (condition.op === "lt") return left < right;
        return left <= right;
      }
      return false;
    }
    case "contains_text":
      return typeof candidate.value === "string" && candidate.value.includes(operand as string);
    case "contains_any":
      if (typeof candidate.value !== "string") return false;
      return (operand as readonly string[]).some((text) =>
        (candidate.value as string).includes(text),
      );
    default:
      return false;
  }
};

export const itemMatchesCondition = (item: KevaItem, condition: QueryCondition): boolean =>
  evaluate(itemValueAt(item, condition.key), condition);

export const propertiesMatchCondition = (
  properties: Properties,
  condition: QueryCondition,
): boolean => evaluate(propertiesValueAt(properties, condition.key), condition);
