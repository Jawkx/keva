import { createBrowserRouter, useParams } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { FileDetailPage } from "./pages/FileDetailPage";
import { FilesPage } from "./pages/FilesPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { QueryPage } from "./pages/QueryPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignupPage } from "./pages/SignupPage";
import { TokensPage } from "./pages/TokensPage";

// Remount the detail page when the object id changes so its mount-time load
// re-runs (react-router reuses the component across param-only navigations).
function FileDetailPageRoute() {
  const { id } = useParams<{ id: string }>();
  return <FileDetailPage key={id} />;
}

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/signup", element: <SignupPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: "/", element: <FilesPage /> },
      { path: "/objects/:id", element: <FileDetailPageRoute /> },
      { path: "/query", element: <QueryPage /> },
      { path: "/tokens", element: <TokensPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
