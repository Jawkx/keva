# Derived State

## Chained derived values

```tsx
// BAD: effect chain for tax/total
function Cart({ subtotal }) {
  const [tax, setTax] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => { setTax(subtotal * 0.1); }, [subtotal]);
  useEffect(() => { setTotal(subtotal + tax); }, [subtotal, tax]);
}

// GOOD: inline computation
function Cart({ subtotal }) {
  const tax = subtotal * 0.1;
  const total = subtotal + tax;
}
```

## fullName from firstName + lastName

```tsx
// BAD
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(firstName + ' ' + lastName);
}, [firstName, lastName]);

// GOOD
const fullName = firstName + ' ' + lastName;
```
