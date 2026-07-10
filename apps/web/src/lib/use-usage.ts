import { useQuery } from "@tanstack/react-query";
import type { UsageResult } from "@keva/sdk";
import { keva } from "./keva";

export const usageQueryKey = ["usage"] as const;

export function useUsage() {
  return useQuery<UsageResult>({
    queryKey: usageQueryKey,
    queryFn: () => keva.usage(),
  });
}
