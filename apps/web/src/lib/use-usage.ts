import { useQuery } from "@tanstack/react-query";
import type { UsageResult } from "@keva/sdk";
import { usageQueryKey } from "./items-cache";
import { keva } from "./keva";

export { usageQueryKey } from "./items-cache";

export function useUsage() {
  return useQuery<UsageResult>({
    queryKey: usageQueryKey,
    queryFn: () => keva.usage(),
  });
}
