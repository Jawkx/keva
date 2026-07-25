import { Inbox, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { keva } from "../lib/keva";
import { errorMessage, isShareGone, isUnauthorized } from "../lib/errors";
import { revokeScopeObjectUrls } from "../lib/object-url-cache";
import { useMountEffect } from "../lib/useMountEffect";
import { ShareReadView } from "./share/SharePage";
import { ShareContextProvider } from "./share/share-context";
import { ShareUploadZone } from "./share/ShareUploadZone";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "../components/UserAvatar";

function SharedViewBody({ grantId }: { grantId: string }) {
  const navigate = useNavigate();
  const client = keva.sharedView(grantId);
  const selfQuery = useQuery({
    queryKey: ["shared-view-self", grantId],
    queryFn: () => client.self(),
  });

  if (selfQuery.isLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (selfQuery.error || !selfQuery.data) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>
            {selfQuery.error ? errorMessage(selfQuery.error) : "Shared view unavailable"}
          </AlertTitle>
        </Alert>
      </div>
    );
  }

  const self = selfQuery.data;
  const canRead = self.scopes.includes("read");
  const canWrite = self.scopes.includes("write");
  return (
    <ShareContextProvider
      value={{
        client,
        self,
        selfQueryKey: ["shared-view-self", grantId],
        onGone: () => navigate("/shared"),
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
            <Inbox className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-heading text-lg font-medium">{self.name}</h1>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <UserAvatar avatar={self.owner.avatar} name={self.owner.name} className="size-4" />
              <span className="truncate">Shared by {self.owner.name}</span>
            </div>
          </div>
          {canRead && <Badge variant="secondary">View</Badge>}
          {canWrite && <Badge variant="secondary">Upload</Badge>}
        </div>
        {canRead ? (
          <ShareReadView canWrite={canWrite} />
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-6">
              <p className="text-sm text-muted-foreground">
                Files uploaded here become files in {self.owner.name}’s space. You cannot browse or
                retrieve them after delivery.
              </p>
              <ShareUploadZone />
            </div>
          </div>
        )}
      </div>
    </ShareContextProvider>
  );
}

function SharedViewSession({ grantId }: { grantId: string }) {
  const navigate = useNavigate();
  const [queryClient] = useState(() => {
    let client: QueryClient;
    const onError = (error: unknown) => {
      if (isUnauthorized(error)) {
        client.clear();
        void navigate("/login", { replace: true });
      } else if (isShareGone(error)) {
        void navigate("/shared", { replace: true });
      }
    };
    client = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: { staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
        mutations: { retry: false },
      },
    });
    return client;
  });
  useMountEffect(() => () => {
    queryClient.clear();
    revokeScopeObjectUrls("share");
  });
  return (
    <QueryClientProvider client={queryClient}>
      <SharedViewBody grantId={grantId} />
    </QueryClientProvider>
  );
}

export function SharedViewPage() {
  const { grantId = "" } = useParams<{ grantId: string }>();
  return <SharedViewSession key={grantId} grantId={grantId} />;
}
