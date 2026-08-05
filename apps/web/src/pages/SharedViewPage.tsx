import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { leaveReceivedShare, receivedSharesQueryKey } from "../lib/account-shares";
import { errorMessage, isShareGone, isUnauthorized } from "../lib/errors";
import { keva } from "../lib/keva";
import { queryClient as appQueryClient } from "../lib/query-client";
import { revokeScopeObjectUrls } from "../lib/object-url-cache";
import { useMountEffect } from "../lib/useMountEffect";
import { ShareReadView } from "./share/SharePage";
import { ShareContextProvider } from "./share/share-context";
import { ShareUploadZone } from "./share/ShareUploadZone";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Spinner } from "@/components/ui/spinner";
import { UserAvatar } from "../components/UserAvatar";
import { viewIcon } from "../components/view-icons";

function SharedViewBody({ grantId }: { grantId: string }) {
  const navigate = useNavigate();
  const client = keva.sharedView(grantId);
  const selfQuery = useQuery({
    queryKey: ["shared-view-self", grantId],
    queryFn: () => client.self(),
  });
  const leaveMutation = useMutation({
    mutationFn: () => leaveReceivedShare(grantId),
    onSuccess: () => {
      void appQueryClient.invalidateQueries({ queryKey: receivedSharesQueryKey });
      toast.success("Shared view removed");
      void navigate("/", { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
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
  const ViewIcon = viewIcon(self.icon);
  return (
    <ShareContextProvider
      value={{
        client,
        self,
        selfQueryKey: ["shared-view-self", grantId],
        onGone: () => navigate("/"),
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
        <div className="flex shrink-0 items-center gap-2 px-4 pt-4">
          <div className="flex size-8 shrink-0 items-center justify-center sm:size-9">
            <ViewIcon className="size-5 sm:size-6" />
          </div>
          <h1 className="min-w-0 flex-1 truncate text-lg leading-none font-medium sm:text-[21px]">
            {self.name}
          </h1>
          <HoverCard>
            <HoverCardTrigger
              delay={100}
              closeDelay={100}
              render={
                <button
                  type="button"
                  aria-label={`Show access shared by ${self.owner.name}`}
                  className="ml-auto flex min-w-0 max-w-[50%] shrink-0 items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              }
            >
              <UserAvatar avatar={self.owner.avatar} name={self.owner.name} className="size-4" />
              <span className="truncate">Shared by {self.owner.name}</span>
            </HoverCardTrigger>
            <HoverCardContent side="bottom" align="end" className="w-72">
              <div className="flex flex-col gap-3 py-1">
                <div className="flex items-center gap-2">
                  <UserAvatar
                    avatar={self.owner.avatar}
                    name={self.owner.name}
                    className="size-8"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{self.owner.name}</p>
                    <p className="text-xs text-muted-foreground">Shared this view with you</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">Your access</p>
                  <div className="flex flex-wrap gap-1">
                    {canRead && <Badge variant="secondary">View &amp; download</Badge>}
                    {canWrite && <Badge variant="secondary">Upload</Badge>}
                    {self.allowOwnDelete && <Badge variant="secondary">Remove own uploads</Badge>}
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={leaveMutation.isPending}
                  onClick={() => leaveMutation.mutate()}
                >
                  {leaveMutation.isPending ? "Removing…" : "Remove access"}
                </Button>
              </div>
            </HoverCardContent>
          </HoverCard>
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
        void navigate("/", { replace: true });
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
