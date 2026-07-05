import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconDatabase,
  IconFiles,
  IconLogout,
  IconPlugConnected,
  IconSelector,
  IconSettings,
  IconShare3,
} from "@tabler/icons-react";
import { authClient } from "../lib/auth";
import { formatBytes } from "../lib/format";
import { useUsage } from "../lib/use-usage";
import { ModeToggle } from "./ModeToggle";
import { Wordmark } from "./Wordmark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const NAV = [
  { title: "Files", url: "/", icon: IconFiles, exact: true },
  { title: "Share", url: "/shares", icon: IconShare3, exact: false },
  { title: "Connection", url: "/connection", icon: IconPlugConnected, exact: false },
] as const;

export function AppShell() {
  const { data } = authClient.useSession();
  const { data: usage } = useUsage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      queryClient.clear();
      navigate("/login", { replace: true });
    }
  };

  const email = data?.user?.email ?? "";
  const name = data?.user?.name || email;
  const isActive = (url: string, exact: boolean) =>
    exact ? location.pathname === url : location.pathname.startsWith(url);
  // The Files screen owns its own full-height, edge-to-edge master/detail
  // layout; every other page gets the centered, padded container.
  const fullBleed = location.pathname === "/" || location.pathname.startsWith("/items/");

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" render={<Link to="/" />}>
                <Wordmark textClassName="group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      isActive={isActive(item.url, item.exact)}
                      tooltip={item.title}
                      render={<Link to={item.url} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          {usage && usage.itemCount > 0 && (
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              <IconDatabase className="size-3.5 shrink-0" />
              <span className="truncate">
                <span className="font-medium text-foreground tabular-nums">
                  {formatBytes(usage.totalBytes)}
                </span>{" "}
                used · <span className="tabular-nums">{usage.itemCount.toLocaleString()}</span>{" "}
                {usage.itemCount === 1 ? "item" : "items"}
              </span>
            </div>
          )}
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent" />
                  }
                >
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted text-sm font-medium uppercase">
                    {(name || "?").charAt(0)}
                  </div>
                  <div className="flex flex-1 flex-col gap-0.5 text-left leading-none">
                    <span className="truncate text-sm font-medium">{name}</span>
                    <span className="truncate text-xs text-muted-foreground">{email}</span>
                  </div>
                  <IconSelector className="ml-auto size-4 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="min-w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>{email}</DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem render={<Link to="/settings" />}>
                      <IconSettings />
                      Settings
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={signingOut}
                      onClick={onSignOut}
                    >
                      <IconLogout />
                      {signingOut ? "Signing out…" : "Sign out"}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="flex-1" />
          <ModeToggle />
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {fullBleed ? (
            <Outlet />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
                <Outlet />
              </div>
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
