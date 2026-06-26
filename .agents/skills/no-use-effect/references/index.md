# Pattern References

Concise guide to the detailed no-`useEffect` replacement patterns.

- [Derived State](derived-state.md): Compute values during render instead of storing derived copies in state.
- [Expensive Calculations with useMemo](expensive-calculations-with-usememo.md): Use `useMemo` only for measured expensive render-time calculations.
- [Data Fetching Race Conditions](data-fetching-race-conditions.md): Avoid direct fetch effects in components; prefer fetching libraries or custom hooks with cleanup.
- [Event Handler Extraction](event-handler-extraction.md): Put user-action side effects directly in event handlers instead of effect-triggered state flags.
- [Conditional Mounting](conditional-mounting.md): Move lifecycle-dependent behavior behind conditional component mounting.
- [Key-Based Reset](key-based-reset.md): Reset all component state by changing a component `key` when the entity changes.
- [Adjusting State on Prop Change](adjusting-state-on-prop-change.md): Derive adjusted state during render, or narrowly adjust during render when necessary.
- [Effect Chains](effect-chains.md): Collapse chained effect updates into event-handler logic and render-time derived state.
- [Parent Notification](parent-notification.md): Notify parents in the same event or use controlled components instead of child effects.
- [External Store Subscription](external-store-subscription.md): Replace manual subscription effects with `useSyncExternalStore`.
- [App Initialization](app-initialization.md): Run app-level initialization outside component effects or behind an explicit mount guard.
- [Effect-Ref Debt Spiral](effect-ref-debt-spiral.md): Avoid patching problematic effects with refs; remove the effect or isolate the side effect.
- [useEffectEvent](useeffectevent.md): Use `useEffectEvent` for non-reactive latest-value reads inside effects when available.
- [Callback Refs](callback-refs.md): Tie DOM-node side effects to node attachment with callback refs.
