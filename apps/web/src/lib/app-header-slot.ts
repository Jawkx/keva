import { createContext, useContext } from "react";

// The top-bar (SidebarInset header) exposes a portal target so route content
// can render its title/actions up beside the sidebar-collapse button while
// keeping that content inside its own React tree (state + context intact).
// AppShell publishes the mounted element; pages read it via useAppHeaderSlot
// and createPortal into it.
export const AppHeaderSlotContext = createContext<HTMLElement | null>(null);

export const useAppHeaderSlot = () => useContext(AppHeaderSlotContext);
