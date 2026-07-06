import { Wordmark } from "./Wordmark";

// The sidebar's "Keva" wordmark: the shared Wordmark, with "eva" hidden when the
// sidebar collapses to icons so only the "K" remains. Alignment lives in
// Wordmark itself now (no bespoke nudges here).
export function SidebarWordmark() {
  return <Wordmark textClassName="group-data-[collapsible=icon]:hidden" />;
}
