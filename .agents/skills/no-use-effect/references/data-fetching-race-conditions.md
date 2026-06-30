# Data Fetching Race Conditions

## The problem with bare fetch in effects

User types "hello" fast. Requests fire for "h", "he", "hel", "hell", "hello". Response for "hell" may arrive after "hello", showing wrong results.

## If you must use an effect for fetching (no library available)

Encapsulate in a custom hook — never use `useEffect` directly in a component. Always add cleanup:

## Extract into a custom hook

```tsx
function useData(url) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let ignore = false;
    fetch(url)
      .then((r) => r.json())
      .then((json) => {
        if (!ignore) setData(json);
      });
    return () => {
      ignore = true;
    };
  }, [url]);
  return data;
}
```

**Note:** `useEffect` inside a custom hook like `useData` is the accepted escape hatch — the rule bans direct `useEffect` in components, not in reusable hooks that encapsulate side effects behind a clean interface.

## Best: use a data-fetching library

React Query, SWR, TanStack Query, or framework-provided fetching. These handle caching, deduplication, cancellation, retries, background refetching, stale-while-revalidate, and SSR hydration.
