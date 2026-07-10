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
  { path: "/s/:token", element: <SharePage /> },
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
      { path: "/v/:viewId", element: <FilesPage /> },
      { path: "/v/:viewId/items/:id", element: <FilesPage /> },
      { path: "/query", element: <Navigate to="/" replace /> },
      { path: "/shares", element: <SharesPage /> },
      { path: "/connection", element: <ConnectionPage /> },
      { path: "/tokens", element: <Navigate to="/connection" replace /> },
      { path: "/connection/shares", element: <Navigate to="/shares" replace /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
