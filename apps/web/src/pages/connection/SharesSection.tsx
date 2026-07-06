import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconShare3 } from "@tabler/icons-react";
import { toast } from "sonner";
import { ConditionChips } from "../../components/ConditionChips";
import { formatDate } from "../../lib/format";
import { listShares, revokeShare, sharesQueryKey } from "../../lib/shares";
import { useApiError } from "../../lib/useApiError";
import { ConfirmRevoke } from "./ConfirmRevoke";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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

export function SharesSection() {
  const handleError = useApiError();
  const queryClient = useQueryClient();

  const sharesQuery = useQuery({ queryKey: sharesQueryKey, queryFn: listShares });
  const shares = sharesQuery.data ?? [];
  const error = sharesQuery.error ? handleError(sharesQuery.error) : null;

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
        <IconAlertTriangle />
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
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconShare3 />
          </EmptyMedia>
          <EmptyTitle>No share links yet</EmptyTitle>
          <EmptyDescription>
            Filter your files on the Files page and press Share to create one.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <Table className="select-text">
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>Access</TableHead>
            <TableHead>Shared files</TableHead>
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
              <TableCell className="text-muted-foreground">{formatDate(share.createdAt)}</TableCell>
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
  );
}
