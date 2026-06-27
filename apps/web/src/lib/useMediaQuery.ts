import { useCallback, useSyncExternalStore } from "react";

// Subscribe to a CSS media query without touching useEffect — useSyncExternalStore
// wires the matchMedia listener and keeps React in sync. Returns false during SSR
// (the server can't know the viewport), which is the safe "narrow" default.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
