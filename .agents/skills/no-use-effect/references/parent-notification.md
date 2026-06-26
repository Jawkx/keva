# Parent Notification

## Option A: update both in same event

```tsx
function Toggle({ onChange }) {
  const [isOn, setIsOn] = useState(false);

  function updateToggle(nextIsOn) {
    setIsOn(nextIsOn);
    onChange(nextIsOn);
  }

  return <button onClick={() => updateToggle(!isOn)}>Toggle</button>;
}
```

## Option B: fully controlled component (preferred)

```tsx
function Toggle({ isOn, onChange }) {
  return <button onClick={() => onChange(!isOn)}>Toggle</button>;
}
```

## Passing data to parent

```tsx
// BAD: child fetches, then notifies parent via effect
useEffect(() => { if (data) onFetched(data); }, [onFetched, data]);

// GOOD: parent owns the fetch, passes data down
function Parent() {
  const data = useSomeAPI();
  return <Child data={data} />;
}
```
