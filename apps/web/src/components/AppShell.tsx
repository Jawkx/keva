import { type MouseEvent, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DatabaseIcon,
  Files01Icon,
  Logout01Icon,
  Plug01Icon,
  Settings01Icon,
  Share03Icon,
  SidebarLeftIcon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { AppHeaderSlotContext } from "../lib/app-header-slot";
import { authClient } from "../lib/auth";
import { formatBytes } from "../lib/format";
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

// "Files" now lives in the Views group as the default "All" entry (Linear-style,
// where the all-items list is itself a view), so it's dropped from this static nav.
const NAV = [
  { title: "Share", url: "/shares", icon: Share03Icon, exact: false },
] satisfies readonly { title: string; url: string; icon: IconSvgElement; exact: boolean }[];

function AppSidebar() {
  const { data } = authClient.useSession();
  const { data: usage } = useUsage();
  const { data: views } = useQuery({ queryKey: viewsQueryKey, queryFn: listViews });
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
  const isActive = (url: string, exact: boolean) =>
    exact ? location.pathname === url : location.pathname.startsWith(url);

  // When collapsed, clicking any empty part of the sidebar expands it, while
  // clicking a menu item still just navigates. The guard bails on clicks that
  // originated inside a menu button so icons keep behaving as links.
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
        {/* The expanded row (wordmark + collapse trigger) and the collapsed
            icon button are layered in the same box and cross-fade on collapse,
            so the swap eases with the sidebar's width transition instead of
            snapping. overflow-hidden clips the wide wordmark once it has faded
            out so it can't disturb the collapsed layout. */}
        <div className="relative h-12 overflow-hidden transition-[height] duration-200 group-data-[collapsible=icon]:h-8">
          <div className="flex h-full items-center justify-between gap-2 opacity-100 transition-opacity duration-200 group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0">
            <Link to="/" className="flex items-center rounded-md px-2">
              <span className="font-heading text-[27px] leading-[27px] font-semibold text-primary">
                Keva
              </span>
            </Link>
            <SidebarTrigger className="size-8" />
          </div>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            className="group/logo pointer-events-none absolute inset-0 m-auto flex size-8 items-center justify-center rounded-md opacity-0 transition-opacity duration-200 hover:bg-sidebar-accent group-data-[collapsible=icon]:pointer-events-auto group-data-[collapsible=icon]:opacity-100"
          >
            {/* Logo and expand icon stack in the same spot and cross-fade on
                hover so the swap eases in/out rather than snapping. */}
            <img
              src="/main-icon.png"
              alt="Keva"
              className="size-7 rounded-sm object-cover opacity-100 transition-opacity duration-200 group-hover/logo:opacity-0"
            />
            <HugeiconsIcon
              icon={SidebarLeftIcon}
              className="absolute size-5 opacity-0 transition-opacity duration-200 group-hover/logo:opacity-100"
            />
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
              {/* Default "All" — the unfiltered file list at the root. Active in
                    root mode (`/` or `/items/*`), i.e. whenever no view is open. */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={isActive("/", true) || location.pathname.startsWith("/items/")}
                  tooltip="All files"
                  render={<Link to="/" />}
                >
                  <HugeiconsIcon icon={Files01Icon} />
                  <span>All</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {views?.map((view) => (
                <SidebarMenuItem key={view.id}>
                  <SidebarMenuButton
                    isActive={location.pathname.startsWith(`/v/${view.id}`)}
                    tooltip={view.name}
                    render={<Link to={`/v/${view.id}`} />}
                  >
                    <HugeiconsIcon icon={viewIcon(view.icon)} />
                    <span>{view.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

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
                    <HugeiconsIcon icon={item.icon} />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
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
              <HugeiconsIcon icon={Plug01Icon} />
              <span>Connection</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {usage && usage.itemCount > 0 && (
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            <HugeiconsIcon icon={DatabaseIcon} className="size-3.5 shrink-0" />
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
                <HugeiconsIcon
                  icon={UnfoldMoreIcon}
                  className="ml-auto size-4 text-muted-foreground"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{email}</DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<Link to="/settings" />}>
                    <HugeiconsIcon icon={Settings01Icon} />
                    Settings
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem variant="destructive" disabled={signingOut} onClick={onSignOut}>
                    <HugeiconsIcon icon={Logout01Icon} />
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
  // Callback ref: publishing the mounted header element via state re-renders
  // the provider so the portal target becomes available to route content.
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  // The Files screen owns its own full-height, edge-to-edge master/detail
  // layout; every other page gets the centered, padded container.
  const fullBleed =
    location.pathname === "/" ||
    location.pathname.startsWith("/items/") ||
    location.pathname.startsWith("/v/");

  return (
    <SidebarProvider>
      <AppSidebar />

      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 px-4">
          {/* Desktop collapses via the in-sidebar trigger; on mobile the sidebar
              is an off-canvas sheet, so keep a trigger here to open it. */}
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
