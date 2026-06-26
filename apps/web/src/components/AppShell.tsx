import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  IconDatabase,
  IconFiles,
  IconKey,
  IconLogout,
  IconSearch,
  IconSelector,
} from "@tabler/icons-react";
import { authClient } from "../lib/auth";
import { ModeToggle } from "./ModeToggle";
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
  { title: "Query", url: "/query", icon: IconSearch, exact: false },
  { title: "Tokens", url: "/tokens", icon: IconKey, exact: false },
] as const;

export function AppShell() {
  const { data } = authClient.useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await authClient.signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  };

  const email = data?.user?.email ?? "";
  const name = data?.user?.name || email;
  const isActive = (url: string, exact: boolean) =>
    exact ? location.pathname === url : location.pathname.startsWith(url);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" render={<Link to="/" />}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <IconDatabase className="size-5" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-heading font-semibold">keva</span>
                  <span className="text-xs text-muted-foreground">
                    structured storage
                  </span>
                </div>
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
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarMenuButton
                      size="lg"
                      className="data-[state=open]:bg-sidebar-accent"
                    />
                  }
                >
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted text-sm font-medium uppercase">
                    {(name || "?").charAt(0)}
                  </div>
                  <div className="flex flex-1 flex-col gap-0.5 text-left leading-none">
                    <span className="truncate text-sm font-medium">{name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {email}
                    </span>
                  </div>
                  <IconSelector className="ml-auto size-4 text-muted-foreground" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  className="min-w-56"
                >
                  <DropdownMenuLabel>{email}</DropdownMenuLabel>
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

      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="flex-1" />
          <ModeToggle />
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
          <div className="mx-auto w-full max-w-5xl">
            <Outlet />
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
