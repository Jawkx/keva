import type { ReactNode } from "react";
import { ModeToggle } from "../../components/ModeToggle";

export function ShareShell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background/80 backdrop-blur">
        <div className="flex w-full items-center gap-3 px-4 py-3">
          <span className="font-heading text-[29px] leading-none font-semibold text-primary">Keva</span>
          <span className="min-w-0 truncate text-lg font-medium text-muted-foreground">
            / {name}
          </span>
          <div className="ml-auto">
            <ModeToggle />
          </div>
        </div>
      </header>
      <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
