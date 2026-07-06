import type { ReactNode } from "react";
import { Wordmark } from "../../components/Wordmark";
import { ModeToggle } from "../../components/ModeToggle";

// Minimal standalone chrome for the public share page — no sidebar, no session.
// A header with the Keva wordmark, the share's name, and the theme toggle, over
// a full-height content region. The body owns its own scrolling and width (the
// read view runs edge-to-edge like the Files page; write-only centers its hero),
// so this fixes the viewport height and leaves layout to the children.
export function ShareShell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <header className="shrink-0 border-b bg-background/80 backdrop-blur">
        <div className="flex w-full items-center gap-3 px-4 py-3">
          <Wordmark />
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
