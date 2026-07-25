import {
  ChevronsUpDown,
  Database,
  Files,
  Inbox,
  LogOut,
  PanelLeft,
  Plug,
  Settings,
} from "lucide-react";
import { type MouseEvent, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppHeaderSlotContext } from "../lib/app-header-slot";
import { authClient } from "../lib/auth";
import { formatBytes } from "../lib/format";
import { listReceivedShares, receivedSharesQueryKey } from "../lib/account-shares";
import { useUsage } from "../lib/use-usage";
import { listViews, viewsQueryKey } from "../lib/views";
import { viewIcon } from "./view-icons";
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
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

function AppSidebar() {
  const { data } = authClient.useSession();
  const { data: usage } = useUsage();
  const { data: views } = useQuery({ queryKey: viewsQueryKey, queryFn: listViews });
  const { data: receivedShares } = useQuery({
    queryKey: receivedSharesQueryKey,
    queryFn: listReceivedShares,
    refetchInterval: 60_000,
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, toggleSidebar, setOpen } = useSidebar();
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
  const acceptedShares = (receivedShares ?? []).filter((share) => share.status === "accepted");
  const pendingShareCount = (receivedShares ?? []).filter(
    (share) => share.status === "pending",
  ).length;
  const isActive = (url: string, exact: boolean) =>
    exact ? location.pathname === url : location.pathname.startsWith(url);

  const expandOnEmptyClick =
    state === "collapsed"
      ? (event: MouseEvent) => {
          if ((event.target as HTMLElement).closest('[data-sidebar="menu-button"]')) return;
          setOpen(true);
        }
      : undefined;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="relative h-12 overflow-hidden transition-[height] duration-200 group-data-[collapsible=icon]:h-8">
          <div className="flex h-full items-center justify-between gap-2 opacity-100 transition-opacity duration-200 group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0">
            <Link to="/" className="flex items-center gap-2 rounded-md px-2">
              <img src="/keva-mark.svg" alt="" className="size-7 rounded-sm" />
              <span className="font-heading text-[27px] leading-[27px] font-semibold text-primary">
                Keva
              </span>
            </Link>
            <SidebarTrigger size="icon-lg" className="[&_svg:not([class*='size-'])]:size-4.5" />
          </div>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            className="group/logo pointer-events-none absolute inset-0 m-auto flex size-8 items-center justify-center rounded-md opacity-0 transition-opacity duration-200 hover:bg-sidebar-accent group-data-[collapsible=icon]:pointer-events-auto group-data-[collapsible=icon]:opacity-100"
          >
            <img
              src="/keva-mark.svg"
              alt="Keva"
              className="size-7 rounded-sm object-cover opacity-100 transition-opacity duration-200 group-hover/logo:opacity-0"
            />
            <PanelLeft className="absolute size-5 opacity-0 transition-opacity duration-200 group-hover/logo:opacity-100" />
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent
        onClick={expandOnEmptyClick}
        className={state === "collapsed" ? "cursor-e-resize" : undefined}
      >
        <SidebarGroup>
          <SidebarGroupLabel>Views</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActive("/", true) || location.pathname.startsWith("/items/")}
                  tooltip="All files"
                  render={<Link to="/" />}
                >
                  <Files />
                  <span>All</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {views?.map((view) => {
                const Icon = viewIcon(view.icon);
                return (
                  <SidebarMenuItem key={view.id}>
                    <SidebarMenuButton
                      isActive={location.pathname.startsWith(`/v/${view.id}`)}
                      tooltip={view.name}
                      render={<Link to={`/v/${view.id}`} />}
                    >
                      <Icon />
                      <span>{view.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Shared</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location.pathname === "/shared"}
                  tooltip="Shared with me"
                  render={<Link to="/shared" />}
                >
                  <Inbox />
                  <span>Shared with me</span>
                  {pendingShareCount > 0 && (
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {pendingShareCount}
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              {acceptedShares.map((share) => {
                const Icon = viewIcon(share.icon);
                return (
                  <SidebarMenuItem key={share.id}>
                    <SidebarMenuButton
                      isActive={location.pathname.startsWith(`/shared/${share.id}`)}
                      tooltip={`${share.name} · ${share.owner.name}`}
                      render={<Link to={`/shared/${share.id}`} />}
                    >
                      <Icon />
                      <span>{share.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={isActive("/connection", false)}
              tooltip="Connection"
              render={<Link to="/connection" />}
            >
              <Plug />
              <span>Connection</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {usage && usage.itemCount > 0 && (
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            <Database className="size-3.5 shrink-0" />
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
                <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{email}</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<Link to="/settings" />}>
                    <Settings />
                    Settings
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem variant="destructive" disabled={signingOut} onClick={onSignOut}>
                    <LogOut />
                    {signingOut ? "Signing out…" : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export function AppShell() {
  const location = useLocation();
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  const fullBleed =
    location.pathname === "/" ||
    location.pathname.startsWith("/items/") ||
    location.pathname.startsWith("/v/") ||
    location.pathname.startsWith("/shared/");

  return (
    <SidebarProvider>
      <AppSidebar />

      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <div ref={setHeaderSlot} className="flex min-w-0 flex-1 items-center gap-2" />
        </header>
        <AppHeaderSlotContext.Provider value={headerSlot}>
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
        </AppHeaderSlotContext.Provider>
      </SidebarInset>
    </SidebarProvider>
  );
}
