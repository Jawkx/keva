import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { keva } from "./keva";

// Distinct property keys across the tenant, for key autocomplete. Cached with a
// generous stale time — the set of keys changes slowly and stale suggestions
// are harmless.
export function usePropertyKeys() {
  const query = useQuery({
    queryKey: ["property-keys"],
    queryFn: () => keva.propertyKeys(),
    staleTime: 60_000,
  });
  return query.data ?? EMPTY;
}

// Distinct scalar values seen for one key, rendered as strings for the input.
// Only fetched when `enabled` (typically when the key names a known property).
export function usePropertyValues(key: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["property-values", key],
    queryFn: () => keva.propertyValues(key),
    enabled: enabled && key.length > 0,
    staleTime: 60_000,
  });
  // Stringify once per fetched payload so the array identity stays stable
  // across renders (values may be numbers/booleans; the input needs strings).
  return useMemo(() => query.data?.map(String) ?? EMPTY, [query.data]);
}

const EMPTY: string[] = [];
