import { Effect } from "effect";
import { Database, Files, LogOut, PanelLeft, Plug, Settings, Trash2 } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReceivedShare } from "@keva/sdk";
import { toast } from "sonner";
import { AppHeaderSlotContext } from "../lib/app-header-slot";
import { authClient } from "../lib/auth";
import { authOperationEffect } from "../lib/auth-effect";
import { errorMessage } from "../lib/errors";
import { brandIconUrl, brandWordmarkColorClass } from "../lib/brand";
import { formatBytes, formatDate } from "../lib/format";
import {
  acceptReceivedShare,
  declineReceivedShare,
  listReceivedShares,
  receivedSharesQueryKey,
} from "../lib/account-shares";
import { useUsage } from "../lib/use-usage";
import { listViews, viewsQueryKey } from "../lib/views";
import { viewIcon } from "./view-icons";
import { UserAvatar } from "./UserAvatar";
import { ProductBetaBadge } from "./ProductBetaBadge";
import { RealtimeSync } from "./RealtimeSync";
import { avatarRecipeForUser } from "../lib/avatar";
import { GlobalSearch } from "./GlobalSearch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

function InvitationDialog({
  invitation,
  onClose,
}: {
  invitation: ReceivedShare | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const acceptMutation = useMutation({
    mutationFn: acceptReceivedShare,
    onSuccess: (share) => {
      onClose();
      void queryClient.invalidateQueries({ queryKey: receivedSharesQueryKey });
      toast.success("Shared view added");
      void navigate(`/shared/${share.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const declineMutation = useMutation({
    mutationFn: declineReceivedShare,
    onSuccess: () => {
      onClose();
      void queryClient.invalidateQueries({ queryKey: receivedSharesQueryKey });
      toast.success("Invitation declined");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const isPending = acceptMutation.isPending || declineMutation.isPending;
  const canRead = invitation?.scopes.includes("read") ?? false;
  const canWrite = invitation?.scopes.includes("write") ?? false;

  return (
    <Dialog open={invitation !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {invitation && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 pr-8">
                <UserAvatar
                  avatar={invitation.owner.avatar}
                  name={invitation.owner.name}
                  className="size-10"
                />
                <div className="min-w-0">
                  <DialogTitle className="truncate">{invitation.name}</DialogTitle>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    From {invitation.owner.name} · {formatDate(invitation.createdAt)}
                  </p>
                </div>
              </div>
              <DialogDescription>
                {invitation.owner.name} invited you to access this shared view.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Access included
              </p>
              <div className="flex flex-wrap gap-1">
                {canRead && <Badge variant="secondary">View &amp; download</Badge>}
                {canWrite && <Badge variant="secondary">Upload</Badge>}
                {invitation.allowOwnDelete && <Badge variant="secondary">Remove own uploads</Badge>}
              </div>
              <p className="text-xs text-muted-foreground">
                {canWrite
                  ? `Uploads become files in ${invitation.owner.name}’s space. They control organization, retention, and permanent deletion.`
                  : `You can view files matching this view in ${invitation.owner.name}’s space.`}
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() => declineMutation.mutate(invitation.id)}
              >
                Decline
              </Button>
              <Button disabled={isPending} onClick={() => acceptMutation.mutate(invitation.id)}>
                Accept invitation
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AppSidebar() {
  const { data: usage } = useUsage();
  const { data: views } = useQuery({ queryKey: viewsQueryKey, queryFn: listViews });
  const { data: receivedShares } = useQuery({
    queryKey: receivedSharesQueryKey,
    queryFn: listReceivedShares,
    refetchInterval: 60_000,
  });
  const location = useLocation();
  const [selectedInvitationId, setSelectedInvitationId] = useState<string | null>(null);
  const { state, toggleSidebar, setOpen, isMobile, setOpenMobile } = useSidebar();
  const acceptedShares = (receivedShares ?? []).filter((share) => share.status === "accepted");
  const pendingShares = (receivedShares ?? []).filter((share) => share.status === "pending");
  const selectedInvitation =
    pendingShares.find((share) => share.id === selectedInvitationId) ?? null;
  const isActive = (url: string, exact: boolean) =>
    exact ? location.pathname === url : location.pathname.startsWith(url);

  const expandOnEmptyClick =
    state === "collapsed"
      ? (event: MouseEvent) => {
          if ((event.target as HTMLElement).closest('[data-sidebar="menu-button"]')) return;
          setOpen(true);
        }
      : undefined;

  const sidebar = (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="relative h-12 overflow-hidden transition-[height] duration-200 group-data-[collapsible=icon]:h-8">
          <div className="flex h-full items-center justify-between gap-2 opacity-100 transition-opacity duration-200 group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:opacity-0">
            <Link to="/" className="flex items-center gap-2 rounded-md px-2">
              <span
                className={`font-heading text-[27px] leading-[27px] font-semibold ${brandWordmarkColorClass}`}
              >
                Keva
              </span>
              <ProductBetaBadge />
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
              src={brandIconUrl}
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
        {(pendingShares.length > 0 || acceptedShares.length > 0) && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <span>Shared</span>
              {pendingShares.length > 0 && (
                <Badge variant="secondary" className="ml-auto tabular-nums">
                  {pendingShares.length}
                </Badge>
              )}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {pendingShares.map((share) => {
                  const Icon = viewIcon(share.icon);
                  return (
                    <SidebarMenuItem key={share.id}>
                      <SidebarMenuButton
                        tooltip={`${share.name} · Invitation from ${share.owner.name}`}
                        onClick={() => {
                          setSelectedInvitationId(share.id);
                          if (isMobile) setOpenMobile(false);
                        }}
                      >
                        <Icon />
                        <span className="min-w-0 flex-1 truncate">{share.name}</span>
                        <Badge variant="outline" className="ml-auto shrink-0">
                          Pending
                        </Badge>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
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
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={isActive("/trash", false)}
              tooltip="Trash"
              render={<Link to="/trash" />}
            >
              <Trash2 />
              <span>Trash</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator className="data-horizontal:w-[calc(100%-1rem)]" />
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
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={isActive("/settings", false)}
              tooltip="Settings"
              render={<Link to="/settings" />}
            >
              <Settings />
              <span>Settings</span>
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
      </SidebarFooter>
    </Sidebar>
  );

  return (
    <>
      {sidebar}
      <InvitationDialog
        invitation={selectedInvitation}
        onClose={() => setSelectedInvitationId(null)}
      />
    </>
  );
}

function HeaderAccount() {
  const { data } = authClient.useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const email = data?.user?.email ?? "";
  const name = data?.user?.name || email;

  const onSignOut = () => {
    setSigningOut(true);
    const signOut = authOperationEffect(() => authClient.signOut()).pipe(
      Effect.catchAll((failure) => Effect.sync(() => toast.error(errorMessage(failure)))),
      Effect.ensuring(
        Effect.sync(() => {
          queryClient.clear();
          navigate("/login", { replace: true });
        }),
      ),
    );
    void Effect.runPromise(signOut);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted">
        {data?.user ? (
          <UserAvatar avatar={avatarRecipeForUser(data.user.id, data.user.avatar)} name={name} />
        ) : (
          <div className="size-8 shrink-0 rounded-full bg-muted" />
        )}
        <span className="hidden max-w-36 truncate text-sm font-medium lg:block">{name}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
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
  );
}

export function AppShell() {
  const location = useLocation();
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  const fullBleed =
    location.pathname === "/" ||
    location.pathname.startsWith("/items/") ||
    location.pathname.startsWith("/v/") ||
    location.pathname.startsWith("/shared/") ||
    location.pathname.startsWith("/trash");

  return (
    <SidebarProvider>
      <RealtimeSync />
      <AppSidebar />

      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <GlobalSearch />
          <div
            ref={setHeaderSlot}
            className="flex min-w-0 flex-1 items-center gap-2 sm:justify-end"
          />
          <HeaderAccount />
        </header>
        <AppHeaderSlotContext.Provider value={headerSlot}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {fullBleed ? (
              <Outlet />
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <div
                  className={
                    location.pathname.startsWith("/settings")
                      ? "w-full p-4 md:p-6 lg:px-8"
                      : "mx-auto w-full max-w-5xl p-4 md:p-6"
                  }
                >
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
