import { TriangleAlert } from "lucide-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { ItemEvent } from "@keva/sdk";
import { errorMessage } from "../lib/errors";
import { formatBytes, formatDate, formatPropertyValue, formatRelative } from "../lib/format";
import { itemEventsQueryKey } from "../lib/items-cache";
import { keva } from "../lib/keva";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "./UserAvatar";

const actorLabel = (event: ItemEvent): string => {
  const actor = event.actor;
  if (!actor) return "Someone";
  if (actor.agent) {
    return actor.user ? `${actor.agent.name} (${actor.user.name})` : actor.agent.name;
  }
  if (actor.user) return actor.user.name;
  if (actor.token) return actor.token.name;
  if (actor.share) return `Someone via “${actor.share.name}”`;
  return "Someone";
};

const actionLabel = (event: ItemEvent): string => {
  const payload = event.payload;
  switch (event.action) {
    case "uploaded":
      return payload.size != null
        ? `uploaded this file (${formatBytes(payload.size)})`
        : "uploaded this file";
    case "updated":
      return payload.name
        ? `renamed “${payload.name.from}” to “${payload.name.to}”`
        : "changed properties";
    case "renamed":
      return `renamed “${payload.from ?? "?"}” to “${payload.to ?? "?"}”`;
    case "properties_changed":
      return "changed properties";
    case "deleted":
      return "deleted this file";
  }
};

const propertyChangeRows = (event: ItemEvent): string[] => {
  if (event.action !== "properties_changed" && event.action !== "updated") return [];
  const payload = event.action === "updated" ? event.payload.properties : event.payload;
  if (!payload) return [];
  const rows: string[] = [];
  for (const [key, value] of Object.entries(payload.set ?? {})) {
    const previous = payload.previous?.[key];
    rows.push(
      previous !== undefined
        ? `${key}: ${formatPropertyValue(previous)} → ${formatPropertyValue(value)}`
        : `${key}: ${formatPropertyValue(value)}`,
    );
  }
  for (const key of payload.unset ?? []) {
    const previous = payload.previous?.[key];
    rows.push(
      previous !== undefined
        ? `${key} removed (was ${formatPropertyValue(previous)})`
        : `${key} removed`,
    );
  }
  return rows;
};

export function FileActivity({ itemId }: { readonly itemId: string }) {
  const eventsQuery = useInfiniteQuery({
    queryKey: itemEventsQueryKey(itemId),
    queryFn: ({ pageParam }) =>
      keva.events(itemId, { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });

  if (eventsQuery.isLoading) {
    return (
      <ul className="flex flex-col">
        {Array.from({ length: 3 }).map((_, index) => (
          <li
            key={index}
            className="flex items-center justify-between gap-3 border-b border-border/50 py-2.5 last:border-b-0"
          >
            <Skeleton className="h-5 flex-1" />
            <Skeleton className="h-4 w-16 shrink-0" />
          </li>
        ))}
      </ul>
    );
  }

  if (eventsQuery.error) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>{errorMessage(eventsQuery.error)}</AlertTitle>
      </Alert>
    );
  }

  const events = eventsQuery.data?.pages.flatMap((page) => page.events) ?? [];
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>;
  }

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {events.map((event) => {
          const changes = propertyChangeRows(event);
          return (
            <li
              key={event.id}
              className="flex flex-col gap-1 border-b border-border/50 py-2.5 text-sm last:border-b-0"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  {event.actor?.user && (
                    <UserAvatar
                      avatar={
                        event.actor.user.avatar ?? {
                          version: 1,
                          seed: event.actor.user.id,
                        }
                      }
                      name={event.actor.user.name}
                      className="size-7"
                    />
                  )}
                  <p className="min-w-0 pt-1">
                    <span className="font-medium">{actorLabel(event)}</span>{" "}
                    <span className="text-muted-foreground">{actionLabel(event)}</span>
                  </p>
                </div>
                <time
                  dateTime={event.createdAt}
                  title={formatDate(event.createdAt)}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {formatRelative(event.createdAt)}
                </time>
              </div>
              {changes.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {changes.map((row) => (
                    <li
                      key={row}
                      className="truncate font-mono text-xs text-muted-foreground"
                      title={row}
                    >
                      {row}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {eventsQuery.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2 self-center text-muted-foreground"
          disabled={eventsQuery.isFetchingNextPage}
          onClick={() => void eventsQuery.fetchNextPage()}
        >
          {eventsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}
