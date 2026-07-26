import type { PropertySuggestion } from "@keva/sdk";
import type { QueryCondition } from "@keva/schema";
import { encodeFilterParam } from "./item-filters";

export const includesSearch = (value: string, search: string): boolean =>
  value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());

export const metadataSuggestionUrl = (suggestion: PropertySuggestion): string => {
  const condition: QueryCondition =
    suggestion.value === undefined
      ? { key: suggestion.key, op: "exists" }
      : { key: suggestion.key, op: "has_value", value: suggestion.value };
  const params = new URLSearchParams({ filter: encodeFilterParam([condition]) });
  return `/?${params}`;
};

export const isGlobalSearchShortcut = (
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">,
): boolean => event.key.toLocaleLowerCase() === "k" && (event.metaKey || event.ctrlKey);
