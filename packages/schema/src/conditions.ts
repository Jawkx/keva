import { Schema } from "effect";
import { FIELD_BY_KEY } from "./fields.js";
import { PropertyValue as PropertyValueSchema } from "./properties.js";
import type { KevaItem, Properties, PropertyValue, QueryCondition } from "./index.js";

type CandidateValue = PropertyValue | number;

interface Candidate {
  readonly exists: boolean;
  readonly value: CandidateValue;
}

const CandidateValue = Schema.Union([PropertyValueSchema, Schema.Number]);
const isCandidateValue = Schema.is(CandidateValue);
const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);

const itemValueAt = (item: KevaItem, key: string): Candidate => {
  const field = FIELD_BY_KEY.get(key);
  if (field) {
    const value = item[field.itemField];
    return { exists: true, value: isCandidateValue(value) ? value : null };
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

const values = (value: CandidateValue): readonly string[] =>
  Array.isArray(value) ? value : isString(value) ? [value] : [];

const evaluate = (candidate: Candidate, condition: QueryCondition): boolean => {
  const field = FIELD_BY_KEY.get(condition.key);
  if (condition.op === "exists") return field ? candidate.value !== null : candidate.exists;
  if (condition.op === "missing") return field ? candidate.value === null : !candidate.exists;
  if (!candidate.exists) return false;
  const operand = condition.value;
  if (!field) {
    const members = values(candidate.value);
    if (condition.op === "is_tag") return candidate.value === null;
    if (condition.op === "has_value") return isString(operand) && members.includes(operand);
    if (condition.op === "has_any")
      return Array.isArray(operand) && operand.some((value) => members.includes(value));
    if (condition.op === "has_all")
      return Array.isArray(operand) && operand.every((value) => members.includes(value));
    if (condition.op === "contains_text")
      return isString(operand) && members.some((value) => value.includes(operand));
    if (condition.op === "contains_any")
      return (
        Array.isArray(operand) &&
        operand.some((text) => members.some((value) => value.includes(text)))
      );
    return false;
  }
  switch (condition.op) {
    case "in":
      return (
        isString(candidate.value) && Array.isArray(operand) && operand.includes(candidate.value)
      );
    case "eq": {
      if (field.queryType === "timestamp" && isString(candidate.value) && isString(operand))
        return Date.parse(candidate.value) === Date.parse(operand);
      return Object.is(candidate.value, operand);
    }
    case "neq": {
      if (field.queryType === "timestamp" && isString(candidate.value) && isString(operand))
        return Date.parse(candidate.value) !== Date.parse(operand);
      return !Object.is(candidate.value, operand);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const left = candidate.value;
      const right = operand;
      if (field.queryType === "timestamp" && isString(left) && isString(right)) {
        const leftTime = Date.parse(left);
        const rightTime = Date.parse(right);
        if (condition.op === "gt") return leftTime > rightTime;
        if (condition.op === "gte") return leftTime >= rightTime;
        if (condition.op === "lt") return leftTime < rightTime;
        return leftTime <= rightTime;
      }
      if (isNumber(left) && isNumber(right)) {
        if (condition.op === "gt") return left > right;
        if (condition.op === "gte") return left >= right;
        if (condition.op === "lt") return left < right;
        return left <= right;
      }
      if (isString(left) && isString(right)) {
        if (condition.op === "gt") return left > right;
        if (condition.op === "gte") return left >= right;
        if (condition.op === "lt") return left < right;
        return left <= right;
      }
      return false;
    }
    case "contains_text":
      return isString(candidate.value) && isString(operand) && candidate.value.includes(operand);
    case "contains_any": {
      if (!isString(candidate.value) || !Array.isArray(operand)) return false;
      const candidateText = candidate.value;
      return operand.some((text) => candidateText.includes(text));
    }
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
