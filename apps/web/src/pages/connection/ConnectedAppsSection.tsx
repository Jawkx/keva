import { Plug, RefreshCw, TriangleAlert } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listConnections, revokeConnection } from "../../lib/connections";
import { formatDate } from "../../lib/format";
import { SCOPE_DESCRIPTIONS } from "../../lib/oauth";
import { useApiError } from "../../lib/useApiError";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmRevoke } from "./ConfirmRevoke";

const connectionStatus = (connection: {
  active: boolean;
  observed: boolean;
}): { label: string; variant: "default" | "secondary" | "outline" } => {
  if (connection.active && connection.observed) return { label: "Connected", variant: "default" };
  if (connection.active) return { label: "Authorized", variant: "secondary" };
  return { label: "Reconnect required", variant: "outline" };
};

export function ConnectedAppsSection() {
  const handleError = useApiError();
  const queryClient = useQueryClient();

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: listConnections,
    refetchInterval: 30_000,
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-lg font-medium">Connected applications</h2>
          <p className="text-sm text-muted-foreground">
            Authorization and recent MCP activity are checked separately.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={connectionsQuery.isFetching}
          onClick={() => void connectionsQuery.refetch()}
        >
          <RefreshCw data-icon="inline-start" />
          Check
        </Button>
      </div>

      {connectionsQuery.isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <Card key={index} size="sm">
              <CardHeader>
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-full max-w-64" />
                <CardAction>
                  <Skeleton className="h-5 w-20 rounded-full" />
                </CardAction>
              </CardHeader>
              <CardContent className="flex items-end justify-between gap-3">
                <div className="flex gap-1">
                  <Skeleton className="h-5 w-12 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="size-7 shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : connectionsQuery.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Could not load connected applications</AlertTitle>
          <AlertDescription>{handleError(connectionsQuery.error)}</AlertDescription>
          <AlertAction>
            <Button size="sm" variant="outline" onClick={() => void connectionsQuery.refetch()}>
              Retry
            </Button>
          </AlertAction>
        </Alert>
      ) : connections.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Plug />
            </EmptyMedia>
            <EmptyTitle>No connected applications</EmptyTitle>
            <EmptyDescription>
              Add Keva to an MCP client and authorize it. This list refreshes automatically.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {connections.map((connection) => {
            const status = connectionStatus(connection);
            return (
              <Card key={connection.clientId} size="sm">
                <CardHeader>
                  <CardTitle>{connection.name || connection.clientId}</CardTitle>
                  <CardDescription>
                    {connection.lastSeenAt
                      ? `Last used ${formatDate(connection.lastSeenAt)}`
                      : `Authorized ${formatDate(connection.createdAt)}; waiting for first use`}
                  </CardDescription>
                  <CardAction>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex items-end justify-between gap-3">
                  <div className="flex flex-wrap gap-1">
                    {connection.scopes
                      .filter((scope) => scope.startsWith("keva:"))
                      .map((scope) => (
                        <Badge key={scope} variant="secondary" title={SCOPE_DESCRIPTIONS[scope]}>
                          {scope.replace("keva:", "")}
                        </Badge>
                      ))}
                  </div>
                  <ConfirmRevoke
                    title="Revoke this application's access?"
                    description="Keva will revoke its authorization immediately. Remove the server separately from the application if you no longer want it installed."
                    label="Revoke application access"
                    onConfirm={() => revokeMutation.mutate(connection.clientId)}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
