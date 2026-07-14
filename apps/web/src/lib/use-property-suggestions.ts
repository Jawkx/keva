import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PropertySummary } from "@keva/sdk";
import {
  propertyKeysQueryKey,
  propertySummaryQueryKey,
  propertyValuesQueryKey,
} from "./items-cache";
import { keva } from "./keva";

export function usePropertySummary() {
  const query = useQuery({
    queryKey: propertySummaryQueryKey,
    queryFn: () => keva.propertySummary(),
    staleTime: 60_000,
  });
  return query.data ?? EMPTY_SUMMARY;
}

export function usePropertyKeys() {
  const query = useQuery({
    queryKey: propertyKeysQueryKey,
    queryFn: () => keva.propertyKeys(),
    staleTime: 60_000,
  });
  return query.data ?? EMPTY;
}

export function usePropertyValueScalars(key: string, enabled: boolean) {
  const query = useQuery({
    queryKey: propertyValuesQueryKey(key),
    queryFn: () => keva.propertyValues(key),
    enabled: enabled && key.length > 0,
    staleTime: 60_000,
  });
  return query.data ?? EMPTY;
}

export function usePropertyValues(key: string, enabled: boolean) {
  const scalars = usePropertyValueScalars(key, enabled);
  return useMemo(() => [...new Set(scalars)], [scalars]);
}

const EMPTY: string[] = [];
const EMPTY_SUMMARY: PropertySummary[] = [];
