import { Inbox, TriangleAlert } from "lucide-react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  acceptReceivedShare,
  declineReceivedShare,
  leaveReceivedShare,
  listReceivedShares,
  receivedSharesQueryKey,
} from "../lib/account-shares";
import { errorMessage } from "../lib/errors";
import { formatDate } from "../lib/format";
import { viewIcon } from "../components/view-icons";
import { PageHeader } from "../components/PageHeader";
import { UserAvatar } from "../components/UserAvatar";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";

export function SharedWithMePage() {
  const queryClient = useQueryClient();
  const sharesQuery = useQuery({ queryKey: receivedSharesQueryKey, queryFn: listReceivedShares });
  const shares = sharesQuery.data ?? [];
  const pending = shares.filter((share) => share.status === "pending");
  const accepted = shares.filter((share) => share.status === "accepted");

  const acceptMutation = useMutation({
    mutationFn: acceptReceivedShare,
    onSuccess: () => {
      toast.success("Shared view added");
      void queryClient.invalidateQueries({ queryKey: receivedSharesQueryKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const declineMutation = useMutation({
    mutationFn: declineReceivedShare,
    onSuccess: () => {
      toast.success("Invitation declined");
      void queryClient.invalidateQueries({ queryKey: receivedSharesQueryKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const leaveMutation = useMutation({
    mutationFn: leaveReceivedShare,
    onSuccess: () => {
      toast.success("Shared view removed");
      void queryClient.invalidateQueries({ queryKey: receivedSharesQueryKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Shared with me"
        description="Views other Keva account holders have shared directly with you."
      />

      {sharesQuery.error ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{errorMessage(sharesQuery.error)}</AlertTitle>
        </Alert>
      ) : sharesQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card key={index} className="flex h-full items-center gap-2 p-2">
              <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2">
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-5 w-32 max-w-full" />
                  <Skeleton className="h-4 w-48 max-w-full" />
                </div>
              </div>
              <Skeleton className="h-8 w-16 shrink-0" />
            </Card>
          ))}
        </div>
      ) : shares.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>Nothing shared yet</EmptyTitle>
            <EmptyDescription>
              Invitations from other Keva account holders will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="font-heading text-base font-medium">Invitations</h2>
                <p className="text-sm text-muted-foreground">
                  Review the access before adding a shared view to your sidebar.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {pending.map((share) => {
                  const Icon = viewIcon(share.icon);
                  const canRead = share.scopes.includes("read");
                  const canWrite = share.scopes.includes("write");
                  return (
                    <Card key={share.id} className="flex flex-col gap-4 p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Icon className="size-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate font-medium">{share.name}</h3>
                          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                            <UserAvatar
                              avatar={share.owner.avatar}
                              name={share.owner.name}
                              className="size-5"
                            />
                            <span className="truncate">Shared by {share.owner.name}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {canRead && <Badge variant="secondary">View & download</Badge>}
                        {canWrite && <Badge variant="secondary">Upload</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {canRead && canWrite
                          ? `You can view matching files and upload new ones to ${share.owner.name}’s space. They control organization, retention, and deletion.`
                          : canWrite
                            ? `Files you upload become files in ${share.owner.name}’s space. They control organization, retention, and deletion.`
                            : `You can view files matching this view in ${share.owner.name}’s space.`}
                      </p>
                      <div className="mt-auto flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          aria-label={`Decline ${share.name} from ${share.owner.name}`}
                          disabled={declineMutation.isPending}
                          onClick={() => declineMutation.mutate(share.id)}
                        >
                          Decline
                        </Button>
                        <Button
                          aria-label={`Accept ${share.name} from ${share.owner.name}`}
                          disabled={acceptMutation.isPending}
                          onClick={() => acceptMutation.mutate(share.id)}
                        >
                          Accept
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {accepted.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-heading text-base font-medium">Shared views</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {accepted.map((share) => {
                  const Icon = viewIcon(share.icon);
                  return (
                    <Card key={share.id} className="flex h-full items-center gap-2 p-2">
                      <Link
                        to={`/shared/${share.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/40"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Icon className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-medium">{share.name}</h3>
                          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <UserAvatar
                              avatar={share.owner.avatar}
                              name={share.owner.name}
                              className="size-5"
                            />
                            <span className="truncate">
                              {share.owner.name} · Shared {formatDate(share.createdAt)}
                            </span>
                          </div>
                        </div>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${share.name} shared by ${share.owner.name}`}
                        disabled={leaveMutation.isPending}
                        onClick={() => leaveMutation.mutate(share.id)}
                      >
                        Remove
                      </Button>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
