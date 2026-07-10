import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { keva } from "./keva";

export function usePropertyKeys() {
  const query = useQuery({
    queryKey: ["property-keys"],
    queryFn: () => keva.propertyKeys(),
    staleTime: 60_000,
  });
  return query.data ?? EMPTY;
}

export function usePropertyValues(key: string, enabled: boolean) {
  const query = useQuery({
    queryKey: ["property-values", key],
    queryFn: () => keva.propertyValues(key),
    enabled: enabled && key.length > 0,
    staleTime: 60_000,
  });
  return useMemo(() => query.data?.map(String) ?? EMPTY, [query.data]);
}

const EMPTY: string[] = [];
