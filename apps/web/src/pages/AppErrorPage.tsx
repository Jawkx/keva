import { TriangleAlert } from "lucide-react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import { Button } from "@/components/ui/button";

export function AppErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.statusText || `Request failed with status ${error.status}`
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred.";

  return (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <TriangleAlert />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-medium">Keva hit a problem</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.location.assign("/")}>
            Go home
          </Button>
          <Button onClick={() => window.location.reload()}>Try again</Button>
        </div>
      </div>
    </main>
  );
}
