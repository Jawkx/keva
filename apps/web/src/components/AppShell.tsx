import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth";

export function AppShell() {
  const { data } = authClient.useSession();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  const email = data?.user?.email ?? "";

  return (
    <div className="shell">
      <header className="shell-header">
        <div className="shell-brand">keva</div>
        <nav className="shell-nav">
          <NavLink to="/" end>
            Files
          </NavLink>
          <NavLink to="/query">Query</NavLink>
          <NavLink to="/tokens">Tokens</NavLink>
        </nav>
        <div className="shell-user">
          {email && <span className="muted">{email}</span>}
          <button
            type="button"
            className="btn-secondary"
            onClick={onSignOut}
            disabled={signingOut}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
