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
import { shareSelfQueryKey } from "../../lib/items-cache";
import { revokeScopeObjectUrls } from "../../lib/object-url-cache";
import { useMountEffect } from "../../lib/useMountEffect";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { ShareContextProvider } from "./share-context";
import { ShareFileDetail } from "./ShareFileDetail";
import { ShareItemList } from "./ShareItemList";
import { ShareShell } from "./ShareShell";
import { ShareUnavailable } from "./ShareUnavailable";
import {
  ShareUploadButton,
  ShareUploadProgress,
  ShareUploadZone,
  useShareUpload,
} from "./ShareUploadZone";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";

export function ShareReadView({ canWrite }: { canWrite: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isWide = useMediaQuery("(min-width: 1024px)");
  const splitOpen = Boolean(selectedId) && isWide;

  const upload = useShareUpload();

  const list = (
    <ShareItemList
      selectedId={selectedId}
      onSelect={(id) => setSelectedId((current) => (current === id ? null : id))}
      collapsed={splitOpen}
      action={
        canWrite ? (
          <ShareUploadButton onFiles={upload.addFiles} quotaHint={upload.quotaHint} />
        ) : undefined
      }
      notice={
        canWrite ? <ShareUploadProgress uploads={upload.uploads} retry={upload.retry} /> : undefined
      }
    />
  );

  return (
    <div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      {splitOpen ? (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 w-full min-w-0 flex-1">
          <ResizablePanel defaultSize={58} minSize={35} className="min-w-0">
            {list}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={42} minSize={28} className="min-w-0">
            <ShareFileDetail
              key={selectedId}
              itemId={selectedId!}
              onClose={() => setSelectedId(null)}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-hidden">{list}</div>
      )}

      <Sheet
        open={Boolean(selectedId) && !isWide}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent side="bottom" showCloseButton={false} className="h-[85vh] p-0">
          <SheetTitle className="sr-only">File details</SheetTitle>
          {selectedId && (
            <ShareFileDetail
              key={selectedId}
              itemId={selectedId}
              onClose={() => setSelectedId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ShareBody({ client, onGone }: { client: ShareClient; onGone: () => void }) {
  const selfQuery = useQuery({ queryKey: shareSelfQueryKey, queryFn: () => client.self() });

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
    <ShareContextProvider value={{ client, self, selfQueryKey: shareSelfQueryKey, onGone }}>
      <ShareShell name={self.name}>
        {canRead ? (
          <ShareReadView canWrite={canWrite} />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto w-full max-w-2xl px-4 py-6">
              <ShareUploadZone />
            </div>
          </div>
        )}
      </ShareShell>
    </ShareContextProvider>
  );
}

// Public share route (`/s/:token`), rendered outside RequireAuth/AppShell. It
// runs its own nested QueryClient so a revoked/expired token surfaces as a
// friendly "link unavailable" state instead of the app's global login redirect,
// and so its cache never collides with an owner's own session cache.
function ShareSession({ token }: { token: string }) {
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
  useMountEffect(() => () => {
    queryClient.clear();
    revokeScopeObjectUrls("share");
  });

  if (linkDead) return <ShareUnavailable />;

  return (
    <QueryClientProvider client={queryClient}>
      <ShareBody client={client} onGone={() => setLinkDead(true)} />
    </QueryClientProvider>
  );
}

export function SharePage() {
  const { token = "" } = useParams<{ token: string }>();
  if (!isShareToken(token)) return <ShareUnavailable />;
  return <ShareSession key={token} token={token} />;
}
