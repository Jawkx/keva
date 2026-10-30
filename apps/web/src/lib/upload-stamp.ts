import { type Properties, type PropertyValue, type QueryCondition } from "@keva/schema";
import { Schema } from "effect";

export const uploadStampFrom = (conditions: readonly QueryCondition[]): Properties => {
  const requirements = new Map<
    string,
    { tag: boolean; exists: boolean; values: Set<string>; ambiguous: boolean }
  >();
  for (const condition of conditions) {
    if (condition.key.startsWith("system.") || condition.key === "name") continue;
    const requirement = requirements.get(condition.key) ?? {
      tag: false,
      exists: false,
      values: new Set<string>(),
      ambiguous: false,
    };
    if (condition.op === "exists") requirement.exists = true;
    else if (condition.op === "is_tag") requirement.tag = true;
    else if (
      (condition.op === "has_value" || condition.op === "contains_text") &&
      Schema.is(Schema.String)(condition.value)
    )
      requirement.values.add(condition.value);
    else if (condition.op === "has_all" && Array.isArray(condition.value))
      for (const value of condition.value) requirement.values.add(value);
    else if (condition.op === "has_any" || condition.op === "contains_any")
      requirement.ambiguous = true;
    requirements.set(condition.key, requirement);
  }

  const stamp: Record<string, PropertyValue> = {};
  for (const [key, requirement] of requirements) {
    if (requirement.ambiguous || (requirement.tag && requirement.values.size > 0)) continue;
    const values = [...requirement.values].sort();
    if (values.length === 1) stamp[key] = values[0]!;
    else if (values.length > 1) stamp[key] = values;
    else if (requirement.tag || requirement.exists) stamp[key] = null;
  }
  return stamp;
};
