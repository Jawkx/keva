import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { ConnectionPage } from "./pages/ConnectionPage";
import { FilesPage } from "./pages/FilesPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OAuthConsentPage } from "./pages/OAuthConsentPage";
import { QueryPage } from "./pages/QueryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignupPage } from "./pages/SignupPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignupPage /> },
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
      { path: "/query", element: <QueryPage /> },
      { path: "/connection", element: <ConnectionPage /> },
      // Old deep links to the token-management screen.
      { path: "/tokens", element: <Navigate to="/connection" replace /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
