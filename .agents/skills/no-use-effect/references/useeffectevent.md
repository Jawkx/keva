# useEffectEvent

`useEffectEvent` is an experimental React API that solves the "latest value in an effect" problem. It wraps non-reactive logic so that it always reads the latest values without being a dependency of the effect.

## Reading latest callback without refs

```tsx
// BAD: ref workaround for latest callback
function ChatRoom({ roomId, onMessage }) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  useEffect(() => {
    const conn = createConnection(roomId);
    conn.on("message", (msg) => onMessageRef.current(msg));
    return () => conn.disconnect();
  }, [roomId]);
}

// GOOD: useEffectEvent captures latest values automatically
function ChatRoom({ roomId, onMessage }) {
  const onMsg = useEffectEvent((msg) => {
    onMessage(msg);
  });

  useEffect(() => {
    const conn = createConnection(roomId);
    conn.on("message", onMsg);
    return () => conn.disconnect();
  }, [roomId]); // onMsg is stable, no need to list it
}
```

## Logging with latest state

```tsx
// BAD: ref to read latest theme in effect
function Page({ url }) {
  const [theme, setTheme] = useState("light");
  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => {
    logVisit(url, themeRef.current);
  }, [url]); // eslint-disable-next-line — lying to the linter

  // ...
}

// GOOD: useEffectEvent
function Page({ url }) {
  const [theme, setTheme] = useState("light");
  const onVisit = useEffectEvent(() => {
    logVisit(url, theme); // always reads latest theme
  });
  useEffect(() => {
    onVisit();
  }, [url]);

  // ...
}
```

**Until `useEffectEvent` is stable:** prefer moving logic to event handlers or `useMountEffect`. If neither fits, isolate the ref workaround in a custom hook — never directly in a component.
