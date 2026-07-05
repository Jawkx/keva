import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { isShareToken, ShareClient } from "@keva/sdk";
import { isShareGone } from "../../lib/errors";
import { ShareContextProvider } from "./share-context";
import { ShareItemList } from "./ShareItemList";
import { ShareShell } from "./ShareShell";
import { ShareUnavailable } from "./ShareUnavailable";
import { ShareUploadZone } from "./ShareUploadZone";
import { Spinner } from "@/components/ui/spinner";

// Body rendered inside the share-scoped QueryClient. Loads the share's
// self-descriptor and picks the layout from its scopes.
function ShareBody({ client, onGone }: { client: ShareClient; onGone: () => void }) {
  const selfQuery = useQuery({ queryKey: ["share-self"], queryFn: () => client.self() });

  if (selfQuery.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (selfQuery.isError || !selfQuery.data) return <ShareUnavailable />;

  const self = selfQuery.data;
  const canRead = self.scopes.includes("read");
  const canWrite = self.scopes.includes("write");

  return (
    <ShareContextProvider value={{ client, self, onGone }}>
      <ShareShell name={self.name}>
        <div className="flex flex-col gap-6">
          {canWrite && <ShareUploadZone variant={canRead ? "compact" : "hero"} />}
          {canRead && <ShareItemList />}
        </div>
      </ShareShell>
    </ShareContextProvider>
  );
}

// Public share route (`/s/:token`), rendered outside RequireAuth/AppShell. It
// runs its own nested QueryClient so a revoked/expired token surfaces as a
// friendly "link unavailable" state instead of the app's global login redirect,
// and so its cache never collides with an owner's own session cache.
export function SharePage() {
  const { token = "" } = useParams<{ token: string }>();
  const valid = isShareToken(token);
  const [linkDead, setLinkDead] = useState(false);
  const client = useMemo(() => new ShareClient({ baseUrl: "/api", shareToken: token }), [token]);
  const [queryClient] = useState(() => {
    const markDead = (error: unknown) => {
      if (isShareGone(error)) setLinkDead(true);
    };
    return new QueryClient({
      queryCache: new QueryCache({ onError: markDead }),
      mutationCache: new MutationCache({ onError: markDead }),
      defaultOptions: {
        queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
        mutations: { retry: false },
      },
    });
  });

  // No network call for a token that isn't even shaped like a share token.
  if (!valid || linkDead) return <ShareUnavailable />;

  return (
    <QueryClientProvider client={queryClient}>
      <ShareBody client={client} onGone={() => setLinkDead(true)} />
    </QueryClientProvider>
  );
}
