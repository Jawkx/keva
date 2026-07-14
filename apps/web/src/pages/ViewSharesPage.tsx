import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Add01Icon, Alert02Icon, ArrowLeft01Icon, Share03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { CopyButton } from "../components/CopyButton";
import { PageHeader } from "../components/PageHeader";
import { ShareCreateDialog } from "../components/ShareCreateDialog";
import { errorMessage } from "../lib/errors";
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

  const viewQuery = useQuery({
    queryKey: viewQueryKey(viewId!),
    queryFn: () => getView(viewId!),
    enabled: Boolean(viewId),
  });
  const view = viewQuery.data;

  const sharesQuery = useQuery({ queryKey: sharesQueryKey, queryFn: listShares });
  const shares = (sharesQuery.data ?? []).filter((s) => s.viewId === viewId);
  const error = sharesQuery.error ? errorMessage(sharesQuery.error) : null;

  const revokeMutation = useMutation({
    mutationFn: revokeShare,
    onSuccess: () => {
      toast.success("Share link revoked");
      void queryClient.invalidateQueries({ queryKey: sharesQueryKey });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const createButton = (
    <Button variant="outline" onClick={() => setCreateOpen(true)}>
      <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
      New share link
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

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
        <Link
          to={viewId ? `/v/${viewId}` : "/"}
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
          {view ? view.name : "Back"}
        </Link>

        <PageHeader
          title="Share links"
          description={
            view
              ? `Secret links that give others filtered access to the “${view.name}” view.`
              : "Secret links that give others filtered access to this view."
          }
          actions={shares.length > 0 ? createButton : undefined}
        />

        {error ? (
          <Alert variant="destructive">
            <HugeiconsIcon icon={Alert02Icon} />
            <AlertTitle>{error}</AlertTitle>
          </Alert>
        ) : sharesQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : shares.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={Share03Icon} />
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
                              <span className="min-w-0 truncate">{shareUrl.slice(0, -8)}</span>
                              <span className="shrink-0">{shareUrl.slice(-8)}</span>
                            </span>
                            <CopyButton value={shareUrl} label="Copy link" />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">Link unavailable</span>
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

        {dialog}
      </div>
    </div>
  );
}
