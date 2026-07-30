import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "./components/AppShell";
import { RequireAuth } from "./components/RequireAuth";
import { AppErrorPage } from "./pages/AppErrorPage";

const ConnectionPage = lazy(() =>
  import("./pages/ConnectionPage").then(({ ConnectionPage }) => ({ default: ConnectionPage })),
);
const FilesPage = lazy(() =>
  import("./pages/FilesPage").then(({ FilesPage }) => ({ default: FilesPage })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then(({ LoginPage }) => ({ default: LoginPage })),
);
const NotFoundPage = lazy(() =>
  import("./pages/NotFoundPage").then(({ NotFoundPage }) => ({ default: NotFoundPage })),
);
const OAuthConsentPage = lazy(() =>
  import("./pages/OAuthConsentPage").then(({ OAuthConsentPage }) => ({
    default: OAuthConsentPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then(({ SettingsPage }) => ({ default: SettingsPage })),
);
const SharedViewPage = lazy(() =>
  import("./pages/SharedViewPage").then(({ SharedViewPage }) => ({ default: SharedViewPage })),
);
const SharedWithMePage = lazy(() =>
  import("./pages/SharedWithMePage").then(({ SharedWithMePage }) => ({
    default: SharedWithMePage,
  })),
);
const SharePage = lazy(() =>
  import("./pages/share/SharePage").then(({ SharePage }) => ({ default: SharePage })),
);
const SignupPage = lazy(() =>
  import("./pages/SignupPage").then(({ SignupPage }) => ({ default: SignupPage })),
);
const ViewSharesPage = lazy(() =>
  import("./pages/ViewSharesPage").then(({ ViewSharesPage }) => ({ default: ViewSharesPage })),
);
const TrashPage = lazy(() =>
  import("./pages/TrashPage").then(({ TrashPage }) => ({ default: TrashPage })),
);

const route = (Page: ComponentType) => (
  <Suspense fallback={<div className="min-h-svh bg-background" />}>
    <Page />
  </Suspense>
);

export const router = createBrowserRouter([
  { path: "/login", element: route(LoginPage) },
  { path: "/signup", element: route(SignupPage) },
  { path: "/s/:token", element: route(SharePage) },
  {
    path: "/oauth/consent",
    element: <RequireAuth>{route(OAuthConsentPage)}</RequireAuth>,
  },
  {
    errorElement: <AppErrorPage />,
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: "/", element: route(FilesPage) },
      { path: "/items/:id", element: route(FilesPage) },
      { path: "/v/:viewId", element: route(FilesPage) },
      { path: "/v/:viewId/items/:id", element: route(FilesPage) },
      { path: "/v/:viewId/shares", element: route(ViewSharesPage) },
      { path: "/shared", element: route(SharedWithMePage) },
      { path: "/trash", element: route(TrashPage) },
      { path: "/trash/items/:id", element: route(TrashPage) },
      { path: "/shared/:grantId", element: route(SharedViewPage) },
      { path: "/query", element: <Navigate to="/" replace /> },
      { path: "/connection", element: route(ConnectionPage) },
      { path: "/tokens", element: <Navigate to="/connection" replace /> },
      { path: "/settings", element: route(SettingsPage) },
      { path: "*", element: route(NotFoundPage) },
    ],
  },
]);
