import { ArrowLeft, Link as LinkIcon, Plus, TriangleAlert, UserPlus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CopyButton } from "../components/CopyButton";
import { AccountShareCreateDialog } from "../components/AccountShareCreateDialog";
import { PageHeader } from "../components/PageHeader";
import { ShareCreateDialog } from "../components/ShareCreateDialog";
import { errorMessage } from "../lib/errors";
import {
  accountSharesQueryKey,
  listAccountShares,
  revokeAccountShare,
} from "../lib/account-shares";
import { formatDate } from "../lib/format";
import { listShares, revokeShare, sharesQueryKey } from "../lib/shares";
import { getView, viewQueryKey } from "../lib/views";
import { ConfirmRevoke } from "./connection/ConfirmRevoke";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const isExpired = (expiresAt: string | null): boolean =>
  expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();

const shareUrlOf = (token: string | null): string | null =>
  token === null ? null : `${window.location.origin}/s/${token}`;

export function ViewSharesPage() {
  const { viewId } = useParams<{ viewId: string }>();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const viewQuery = useQuery({
    queryKey: viewQueryKey(viewId!),
    queryFn: () => getView(viewId!),
    enabled: Boolean(viewId),
  });
  const view = viewQuery.data;

  const sharesQuery = useQuery({ queryKey: sharesQueryKey, queryFn: listShares });
  const shares = (sharesQuery.data ?? []).filter((s) => s.viewId === viewId);
  const peopleQuery = useQuery({ queryKey: accountSharesQueryKey, queryFn: listAccountShares });
  const people = (peopleQuery.data ?? []).filter((share) => share.viewId === viewId);
  const error = viewQuery.error
    ? errorMessage(viewQuery.error)
    : sharesQuery.error
      ? errorMessage(sharesQuery.error)
      : peopleQuery.error
        ? errorMessage(peopleQuery.error)
        : null;

  const revokeMutation = useMutation({
    mutationFn: revokeShare,
    onSuccess: () => {
      toast.success("Share link revoked");
      void queryClient.invalidateQueries({ queryKey: sharesQueryKey });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const revokePersonMutation = useMutation({
    mutationFn: revokeAccountShare,
    onSuccess: () => {
      toast.success("Access revoked");
      void queryClient.invalidateQueries({ queryKey: accountSharesQueryKey });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const createButton = (
    <Button variant="outline" onClick={() => setCreateOpen(true)}>
      <Plus data-icon="inline-start" />
      New share link
    </Button>
  );

  const inviteButton = (
    <Button onClick={() => setInviteOpen(true)}>
      <UserPlus data-icon="inline-start" />
      Invite person
    </Button>
  );

  const dialog = (
    <ShareCreateDialog
      key={createOpen ? "open" : "closed"}
      open={createOpen}
      onOpenChange={setCreateOpen}
      viewId={viewId ?? ""}
      conditions={view ? [...view.conditions] : []}
    />
  );

  const inviteDialog = view ? (
    <AccountShareCreateDialog
      key={inviteOpen ? "open" : "closed"}
      open={inviteOpen}
      onOpenChange={setInviteOpen}
      viewId={view.id}
      viewName={view.name}
      conditions={[...view.conditions]}
    />
  ) : null;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
        <Link
          to={viewId ? `/v/${viewId}` : "/"}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          {view ? view.name : "Back"}
        </Link>

        <PageHeader
          title="Sharing"
          description={
            view
              ? `Invite Keva accounts or create secret links for the “${view.name}” view.`
              : "Manage access to this view."
          }
          actions={view ? inviteButton : undefined}
        />

        {error ? (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : sharesQuery.isLoading || peopleQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="font-heading text-base font-medium">People</h2>
                <p className="text-sm text-muted-foreground">
                  Account-bound access appears in the recipient’s Keva after they accept.
                </p>
              </div>
              {people.length === 0 ? (
                <Card className="flex items-center justify-between gap-4 p-4">
                  <div>
                    <p className="font-medium">No people invited</p>
                    <p className="text-sm text-muted-foreground">
                      Invite an existing Keva account by exact email.
                    </p>
                  </div>
                  {inviteButton}
                </Card>
              ) : (
                <Card className="overflow-hidden p-0">
                  <Table className="select-text">
                    <TableHeader className="bg-muted/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Person</TableHead>
                        <TableHead>Access</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Invited</TableHead>
                        <TableHead className="w-0" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {people.map((share) => (
                        <TableRow key={share.id} className="hover:bg-transparent">
                          <TableCell>
                            <div className="flex flex-col">
                              <span className="font-medium">{share.recipient.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {share.recipient.email}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {share.scopes.map((scope) => (
                                <Badge key={scope} variant="secondary">
                                  {scope}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            {share.expiresAt && isExpired(share.expiresAt) ? (
                              <Badge variant="destructive">expired</Badge>
                            ) : (
                              <Badge
                                variant={share.status === "accepted" ? "secondary" : "outline"}
                              >
                                {share.status}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatDate(share.createdAt)}
                          </TableCell>
                          <TableCell>
                            <ConfirmRevoke
                              title="Revoke this person’s access?"
                              description="They immediately lose access to this shared view. Files already uploaded remain in your space."
                              label={`Revoke ${share.recipient.name}`}
                              onConfirm={() => revokePersonMutation.mutate(share.id)}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <h2 className="font-heading text-base font-medium">Secret links</h2>
                  <p className="text-sm text-muted-foreground">
                    Anyone with a link can use its granted access without a Keva account.
                  </p>
                </div>
                {shares.length > 0 && createButton}
              </div>
              {shares.length === 0 ? (
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <LinkIcon />
                    </EmptyMedia>
                    <EmptyTitle>No share links yet</EmptyTitle>
                    <EmptyDescription>
                      Create a secret link to give others filtered access to this view.
                    </EmptyDescription>
                  </EmptyHeader>
                  <div className="mt-4 flex justify-center">{createButton}</div>
                </Empty>
              ) : (
                <Card className="overflow-hidden p-0">
                  <Table className="select-text">
                    <TableHeader className="bg-muted/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Name</TableHead>
                        <TableHead>Link</TableHead>
                        <TableHead>Access</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead>Last used</TableHead>
                        <TableHead className="w-0" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shares.map((share) => {
                        const shareUrl = shareUrlOf(share.token);
                        return (
                          <TableRow key={share.id} className="hover:bg-transparent">
                            <TableCell className="font-medium">{share.name}</TableCell>
                            <TableCell>
                              {shareUrl ? (
                                <div className="flex items-center gap-1">
                                  <span
                                    className="flex max-w-[16rem] font-mono text-xs text-muted-foreground"
                                    title={shareUrl}
                                  >
                                    <span className="min-w-0 truncate">
                                      {shareUrl.slice(0, -8)}
                                    </span>
                                    <span className="shrink-0">{shareUrl.slice(-8)}</span>
                                  </span>
                                  <CopyButton value={shareUrl} label="Copy link" />
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Link unavailable
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {share.scopes.map((scope) => (
                                  <Badge key={scope} variant="secondary">
                                    {scope}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {share.expiresAt === null ? (
                                "—"
                              ) : isExpired(share.expiresAt) ? (
                                <Badge variant="destructive">Expired</Badge>
                              ) : (
                                formatDate(share.expiresAt)
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {share.lastUsedAt ? formatDate(share.lastUsedAt) : "never"}
                            </TableCell>
                            <TableCell>
                              <ConfirmRevoke
                                title="Revoke this share link?"
                                description="Anyone holding the link immediately loses access. This cannot be undone."
                                label={`Revoke ${share.name}`}
                                onConfirm={() => revokeMutation.mutate(share.id)}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </section>
          </div>
        )}

        {dialog}
        {inviteDialog}
      </div>
    </div>
  );
}
