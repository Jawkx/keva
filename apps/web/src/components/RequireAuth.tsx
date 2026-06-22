import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authClient } from "../lib/auth";

// Guards authed routes: while the session is loading we show a placeholder,
// and when there is no session we redirect to /login (remembering where the
// user was headed so the login page can send them back).
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  const location = useLocation();

  if (isPending) {
    return <div className="centered muted">Loading…</div>;
  }

  if (!data) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}
