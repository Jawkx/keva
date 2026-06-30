# Callback Refs

When you need a side effect tied to a DOM node's presence, a callback ref is more reliable than `useRef` + `useMountEffect`. It fires exactly when the node attaches or detaches, with no timing issues.

## Measuring a DOM node

```tsx
// BAD: ref.current may be null on first render if the node is conditionally rendered
function MeasuredBox() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useMountEffect(() => {
    setHeight(ref.current!.getBoundingClientRect().height);
  });
  return <div ref={ref}>Content</div>;
}

// GOOD: callback ref fires when node is attached
function MeasuredBox() {
  const [height, setHeight] = useState(0);
  const measuredRef = useCallback((node: HTMLDivElement | null) => {
    if (node !== null) {
      setHeight(node.getBoundingClientRect().height);
    }
  }, []);
  return <div ref={measuredRef}>Content</div>;
}
```

## Focus on mount

```tsx
// BAD
const inputRef = useRef<HTMLInputElement>(null);
useMountEffect(() => {
  inputRef.current?.focus();
});
return <input ref={inputRef} />;

// GOOD: callback ref
<input ref={(node) => node?.focus()} />;
```

## Third-party library initialization (React 19+)

```tsx
// BAD: ref + useMountEffect
const containerRef = useRef<HTMLDivElement>(null);
useMountEffect(() => {
  const chart = new Chart(containerRef.current!, config);
  return () => chart.destroy();
});
return <div ref={containerRef} />;

// GOOD: callback ref with cleanup (React 19+ supports return values)
const chartRef = useCallback(
  (node: HTMLDivElement | null) => {
    if (node === null) return;
    const chart = new Chart(node, config);
    return () => chart.destroy(); // cleanup when node detaches
  },
  [config],
);
return <div ref={chartRef} />;
```

**Note:** React 19 supports cleanup return values from callback refs. For earlier versions, store the cleanup in a ref inside a custom hook.
