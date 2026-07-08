import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { listConnections, revokeConnection } from "../../lib/connections";
import { formatDate } from "../../lib/format";
import { SCOPE_DESCRIPTIONS } from "../../lib/oauth";
import { useApiError } from "../../lib/useApiError";
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
import { ConfirmRevoke } from "./ConfirmRevoke";

export function ConnectedAppsSection() {
  const handleError = useApiError();
  const queryClient = useQueryClient();

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: listConnections,
  });
  const connections = connectionsQuery.data ?? [];

  const revokeMutation = useMutation({
    mutationFn: revokeConnection,
    onSuccess: () => {
      toast.success("Access revoked");
      void queryClient.invalidateQueries({ queryKey: ["connections"] });
    },
    onError: (err) => toast.error(handleError(err)),
  });

  return (
    <div>
      <h2 className="mb-3 font-heading text-lg font-medium">Connected applications</h2>
      {connectionsQuery.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : connections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Plug01Icon} />
            </EmptyMedia>
            <EmptyTitle>No connected applications</EmptyTitle>
            <EmptyDescription>Agents you authorize over MCP will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Application</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Authorized</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((connection) => (
                <TableRow key={connection.clientId}>
                  <TableCell className="font-medium">
                    {connection.name || connection.clientId}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {connection.scopes
                        .filter((scope) => scope.startsWith("keva:"))
                        .map((scope) => (
                          <Badge key={scope} variant="secondary" title={SCOPE_DESCRIPTIONS[scope]}>
                            {scope.replace("keva:", "")}
                          </Badge>
                        ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(connection.createdAt)}
                  </TableCell>
                  <TableCell>
                    <ConfirmRevoke
                      title="Revoke this application's access?"
                      description="It will lose access to your files immediately and must be re-authorized to reconnect."
                      label="Revoke application access"
                      onConfirm={() => revokeMutation.mutate(connection.clientId)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
