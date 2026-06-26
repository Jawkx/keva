# Effect-Ref Debt Spiral

When a `useEffect` causes problems (double-firing, stale closures, loops), developers often "patch" it with a `useRef` instead of fixing the root cause. This creates a brittle hybrid where two state systems compete: one React tracks (useState) and one it doesn't (useRef). The fix is always to eliminate the effect, not to bandage it.

## `hasRun` guard to prevent double-fire

```tsx
// BAD: ref guard hides the real problem — Strict Mode double-fire exists
// to surface missing cleanup, not to be silenced
function UserGreeting({ userId }) {
  const hasRun = useRef(false);
  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;
    showWelcomeToast(userId);
  }, [userId]);
}

// GOOD: if it's truly one-time mount setup
function UserGreeting({ userId }) {
  useMountEffect(() => {
    showWelcomeToast(userId);
  });
}

// BETTER: if the toast is a response to navigation, it belongs in the
// navigation handler, not in the component lifecycle at all
```

## `isMounted` ref to avoid set-state-after-unmount

```tsx
// BAD: isMounted ref masks a missing cancellation
function Profile({ userId }) {
  const [user, setUser] = useState(null);
  const isMounted = useRef(true);
  useEffect(() => {
    fetchUser(userId).then(data => {
      if (isMounted.current) setUser(data);
    });
    return () => { isMounted.current = false; };
  }, [userId]);
}

// GOOD: data-fetching library handles cancellation
function Profile({ userId }) {
  const { data: user } = useQuery(['user', userId], () => fetchUser(userId));
}

// GOOD: if no library, use a cleanup boolean in a custom hook (not a ref)
function useData(url) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let ignore = false;
    fetch(url)
      .then(r => r.json())
      .then(json => { if (!ignore) setData(json); });
    return () => { ignore = true; };
  }, [url]);
  return data;
}
```

**Why `ignore` is not the same as `isMounted.current`:** The `ignore` boolean is scoped to a single effect execution and cleaned up by that same execution's cleanup function. It doesn't persist across renders or leak into other parts of the component. A `useRef` persists across the entire component lifetime and creates a second, invisible state channel.

## Ref to capture latest callback (dodging the dependency array)

```tsx
// BAD: ref stores latest callback to avoid listing it as a dependency
function ChatRoom({ roomId, onMessage }) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const conn = createConnection(roomId);
    conn.on('message', (msg) => onMessageRef.current(msg));
    return () => conn.disconnect();
  }, [roomId]); // onMessage is missing — linter would complain without the ref trick
}

// GOOD: useEffectEvent (see section below)
// GOOD: if no useEffectEvent, isolate in a custom hook — never in a component
```
