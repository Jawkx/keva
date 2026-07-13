import type { Properties, PropertyValue, QueryCondition } from "@keva/schema";

export const uploadStampFrom = (conditions: readonly QueryCondition[]): Properties => {
  const stamp: Record<string, PropertyValue> = {};
  for (const condition of conditions) {
    if (condition.key.startsWith("system.") || condition.key === "name") continue;

    if (condition.op === "exists") {
      stamp[condition.key] = true;
      continue;
    }

    if (condition.op === "eq" && condition.value !== undefined && !Array.isArray(condition.value)) {
      stamp[condition.key] = condition.value;
    }
  }
  return stamp;
};
