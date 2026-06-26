import { useEffect, type EffectCallback } from "react";

// The single sanctioned place we touch useEffect. Components must not call
// useEffect directly — for one-time work on mount (initial data loads,
// subscriptions) use this helper, and drive everything else from derived state
// (useMemo), event handlers, or key-based resets.
export function useMountEffect(effect: EffectCallback): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}
