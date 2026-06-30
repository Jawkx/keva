# Adjusting State on Prop Change

When you only need to adjust some state (not reset everything):

## Best: derive it during render

```tsx
function List({ items }) {
  const [selectedId, setSelectedId] = useState(null);
  // If selected item no longer exists, selection clears automatically
  const selection = items.find((item) => item.id === selectedId) ?? null;
}
```

## Acceptable: adjust during render with previous props tracking

```tsx
function List({ items }) {
  const [isReverse, setIsReverse] = useState(false);
  const [selection, setSelection] = useState(null);
  const [prevItems, setPrevItems] = useState(items);

  if (items !== prevItems) {
    setPrevItems(items);
    setSelection(null);
  }
}
```
