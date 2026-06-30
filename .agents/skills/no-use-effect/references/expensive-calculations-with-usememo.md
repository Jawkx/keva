# Expensive Calculations with useMemo

```tsx
// BAD
const [visibleTodos, setVisibleTodos] = useState([]);
useEffect(() => {
  setVisibleTodos(getFilteredTodos(todos, filter));
}, [todos, filter]);

// GOOD
const visibleTodos = useMemo(() => getFilteredTodos(todos, filter), [todos, filter]);
```

**When is a calculation expensive?** Measure with `console.time`. Generally only worth memoizing if >1ms on throttled CPU.
