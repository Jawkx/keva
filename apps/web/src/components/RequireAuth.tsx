import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authClient } from "../lib/auth";
import { Spinner } from "@/components/ui/spinner";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!data) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
