import { useQuery } from "@tanstack/react-query";
import type { UsageResult } from "@keva/sdk";
import { keva } from "./keva";

// Storage usage for the signed-in tenant. Invalidated wherever the item list is
// mutated (upload confirm, delete, bulk delete) so totals stay live.
export const usageQueryKey = ["usage"] as const;

export function useUsage() {
  return useQuery<UsageResult>({
    queryKey: usageQueryKey,
    queryFn: () => keva.usage(),
  });
}
