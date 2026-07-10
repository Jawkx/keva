import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Add01Icon, Alert02Icon, ArrowRight01Icon, Share03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { ViewRecord } from "@keva/schema";
import { ConditionChips } from "../../components/ConditionChips";
import { ShareCreateDialog } from "../../components/ShareCreateDialog";
import { formatDate } from "../../lib/format";
import { listShares, revokeShare, sharesQueryKey } from "../../lib/shares";
import { listViews, viewsQueryKey } from "../../lib/views";
import { useApiError } from "../../lib/useApiError";
import { ConfirmRevoke } from "./ConfirmRevoke";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export function SharesSection() {
  const handleError = useApiError();
  const queryClient = useQueryClient();

  const sharesQuery = useQuery({ queryKey: sharesQueryKey, queryFn: listShares });
  const shares = sharesQuery.data ?? [];
  const error = sharesQuery.error ? handleError(sharesQuery.error) : null;

  const viewsQuery = useQuery({ queryKey: viewsQueryKey, queryFn: listViews });
  const views = viewsQuery.data ?? [];
  const [shareView, setShareView] = useState<ViewRecord | null>(null);

  const newShareButton = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
        New share link
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Share a view</DropdownMenuLabel>
          {views.length === 0 ? (
            <DropdownMenuItem render={<Link to="/" />}>
              Filter files on the Files page…
            </DropdownMenuItem>
          ) : (
            views.map((view) => (
              <DropdownMenuItem key={view.id} onClick={() => setShareView(view)}>
                {view.name}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const shareDialog = (
    <ShareCreateDialog
      key={shareView?.id ?? "none"}
      open={shareView !== null}
      onOpenChange={(open) => {
        if (!open) setShareView(null);
      }}
      viewId={shareView?.id ?? ""}
      conditions={shareView ? [...shareView.conditions] : []}
    />
  );

  const revokeMutation = useMutation({
    mutationFn: revokeShare,
    onSuccess: () => {
      toast.success("Share link revoked");
      void queryClient.invalidateQueries({ queryKey: sharesQueryKey });
    },
    onError: (err) => toast.error(handleError(err)),
  });

  if (error) {
    return (
      <Alert variant="destructive">
        <HugeiconsIcon icon={Alert02Icon} />
        <AlertTitle>{error}</AlertTitle>
      </Alert>
    );
  }

  if (sharesQuery.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (shares.length === 0) {
    return (
      <>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Share03Icon} />
            </EmptyMedia>
            <EmptyTitle>No share links yet</EmptyTitle>
            <EmptyDescription>
              Create a link from a saved view, or filter files on the Files page and press Share.
            </EmptyDescription>
          </EmptyHeader>
          <div className="mt-4 flex justify-center">{newShareButton}</div>
        </Empty>
        {shareDialog}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">{newShareButton}</div>
      <Card className="overflow-hidden p-0">
        <Table className="select-text">
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Shared files</TableHead>
              <TableHead>View</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {shares.map((share) => (
              <TableRow key={share.id} className="hover:bg-transparent">
                <TableCell className="font-medium">{share.name}</TableCell>
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
                  <ConditionChips conditions={share.conditions} />
                </TableCell>
                <TableCell>
                  <Link
                    to={`/v/${share.viewId}`}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    Open
                    <HugeiconsIcon icon={ArrowRight01Icon} className="size-3.5" />
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(share.createdAt)}
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
                    label="Revoke share link"
                    onConfirm={() => revokeMutation.mutate(share.id)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {shareDialog}
    </div>
  );
}
