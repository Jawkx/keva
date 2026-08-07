import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { isUnauthorized } from "./errors";
import { router } from "../router";

const onError = (error: unknown) => {
  if (!isUnauthorized(error)) return;
  queryClient.clear();
  void router.navigate("/login", { replace: true });
};

export const ACTIVE_METADATA_REFETCH_INTERVAL = 60_000;

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: "always",
      refetchOnReconnect: "always",
    },
    mutations: { retry: false },
  },
});
