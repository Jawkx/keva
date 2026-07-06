import { FIELD_BY_KEY } from "./fields.js";
import type { KevaItem, Properties, PropertyValue, QueryCondition } from "./index.js";

// Shared, storage-agnostic evaluation of a single QueryCondition against an
// item (or a bare property blob). This is the one source of truth for what a
// condition MEANS: the in-memory metadata store, the engine's share point-checks
// (get/download), and share-grant creation (does a writeStamp satisfy its own
// conditions?) all evaluate through here, so they can never drift. The postgres
// store compiles the same semantics into SQL (`compileCondition`); the
// store-equivalence tests keep the two in lockstep.

interface Candidate {
  readonly exists: boolean;
  readonly value: PropertyValue | string | number | null;
}

// Resolve a key against an item: declared fields (id, name, system.*) read from
// their column accessor; every other key resolves against the property blob.
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

const equals = (left: unknown, right: unknown): boolean =>
  typeof left === typeof right && Object.is(left, right);

const evaluate = (candidate: Candidate, condition: QueryCondition): boolean => {
  if (condition.op === "exists") return candidate.exists;
  if (!candidate.exists) return false;
  const operand = condition.value;
  switch (condition.op) {
    case "eq":
      return equals(candidate.value, operand);
    case "neq":
      return !equals(candidate.value, operand);
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
    case "contains":
      if (typeof candidate.value === "string" && typeof operand === "string") {
        return candidate.value.includes(operand);
      }
      return (
        Array.isArray(candidate.value) &&
        candidate.value.some((element) => equals(element, operand))
      );
  }
};

export const itemMatchesCondition = (item: KevaItem, condition: QueryCondition): boolean =>
  evaluate(itemValueAt(item, condition.key), condition);

export const propertiesMatchCondition = (
  properties: Properties,
  condition: QueryCondition,
): boolean => evaluate(propertiesValueAt(properties, condition.key), condition);
