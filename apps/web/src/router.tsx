import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { FileDetailPage } from "./pages/FileDetailPage";
import { FilesPage } from "./pages/FilesPage";
import { LoginPage } from "./pages/LoginPage";
import { QueryPage } from "./pages/QueryPage";
import { SignupPage } from "./pages/SignupPage";
import { TokensPage } from "./pages/TokensPage";

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
      { path: "/objects/:id", element: <FileDetailPage /> },
      { path: "/query", element: <QueryPage /> },
      { path: "/tokens", element: <TokensPage /> },
    ],
  },
]);
