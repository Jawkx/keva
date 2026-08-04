import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { ModeToggle } from "../../components/ModeToggle";
import { ProductBetaBadge } from "../../components/ProductBetaBadge";
import { authClient } from "../../lib/auth";
import { Button } from "@/components/ui/button";

export function ShareShell({ name, children }: { name: string; children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  const location = useLocation();
  const isVisitor = !data || data.user.isAnonymous;
  const returnPath = `${location.pathname}${location.search}${location.hash}`;

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background/80 backdrop-blur">
        <div className="flex w-full items-center gap-3 px-4 py-3">
          <span className="font-heading text-[29px] leading-none font-semibold text-primary">
            Keva
          </span>
          <ProductBetaBadge />
          <span className="min-w-0 truncate text-lg font-medium text-muted-foreground">
            / {name}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {!isPending && isVisitor && (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                render={<Link to="/login" state={{ from: returnPath }} />}
              >
                Sign in
              </Button>
            )}
            {data?.user.isAnonymous && (
              <Button
                size="sm"
                nativeButton={false}
                render={<Link to="/signup" target="_blank" rel="noreferrer" />}
              >
                Create account
              </Button>
            )}
            <ModeToggle />
          </div>
        </div>
      </header>
      <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
