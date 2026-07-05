import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { ConnectionPage } from "./pages/ConnectionPage";
import { FilesPage } from "./pages/FilesPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OAuthConsentPage } from "./pages/OAuthConsentPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SharePage } from "./pages/share/SharePage";
import { SharesPage } from "./pages/SharesPage";
import { SignupPage } from "./pages/SignupPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignupPage /> },
  // Public share links live outside RequireAuth/AppShell — anonymous visitors
  // reach the share page with only a token in the URL.
  { path: "/s/:token", element: <SharePage /> },
  // Standalone (no AppShell) but auth-gated: the OAuth authorize flow only
  // reaches here once Better Auth has confirmed a session.
  {
    path: "/oauth/consent",
    element: (
      <RequireAuth>
        <OAuthConsentPage />
      </RequireAuth>
    ),
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: "/", element: <FilesPage /> },
      { path: "/items/:id", element: <FilesPage /> },
      // The former Query page is now the Files filter panel; keep the path as a
      // redirect so old links/bookmarks don't 404.
      { path: "/query", element: <Navigate to="/" replace /> },
      { path: "/shares", element: <SharesPage /> },
      { path: "/connection", element: <ConnectionPage /> },
      // Old deep links to the token-management screen.
      { path: "/tokens", element: <Navigate to="/connection" replace /> },
      // The share manager moved from a Connection tab to its own sidebar page.
      { path: "/connection/shares", element: <Navigate to="/shares" replace /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
