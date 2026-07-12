import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PropertySummary } from "@keva/sdk";
import { keva } from "./keva";

export function usePropertySummary() {
  const query = useQuery({
    queryKey: ["property-summary"],
    queryFn: () => keva.propertySummary(),
    staleTime: 60_000,
  });
  return query.data ?? EMPTY_SUMMARY;
}

export function usePropertyKeys() {
  const query = useQuery({
    queryKey: ["property-keys"],
    queryFn: () => keva.propertyKeys(),
    staleTime: 60_000,
  });
  return query.data ?? EMPTY;
}

export function usePropertyValueScalars(key: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["property-values", key],
    queryFn: () => keva.propertyValues(key),
    enabled: enabled && key.length > 0,
    staleTime: 60_000,
  });
  return query.data ?? EMPTY_SCALARS;
}

export function usePropertyValues(key: string, enabled: boolean) {
  const scalars = usePropertyValueScalars(key, enabled);
  return useMemo(() => scalars.map(String), [scalars]);
}

const EMPTY: string[] = [];
const EMPTY_SCALARS: (string | number | boolean)[] = [];
const EMPTY_SUMMARY: PropertySummary[] = [];
