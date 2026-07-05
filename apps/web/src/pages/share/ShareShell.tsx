import type { ReactNode } from "react";
import { Wordmark } from "../../components/Wordmark";
import { ModeToggle } from "../../components/ModeToggle";

// Minimal standalone chrome for the public share page — no sidebar, no session.
// A sticky header with the Keva wordmark, the share's name, and the theme
// toggle, over a centered content column.
export function ShareShell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
          <Wordmark />
          <span className="min-w-0 truncate text-lg font-medium text-muted-foreground">
            / {name}
          </span>
          <div className="ml-auto">
            <ModeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
