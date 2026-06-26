# Key-Based Reset

## Resetting all state when entity changes

```tsx
// BAD
function ProfilePage({ userId }) {
  const [comment, setComment] = useState('');
  useEffect(() => { setComment(''); }, [userId]);
}

// GOOD: key forces full reset
function ProfilePage({ userId }) {
  return <Profile userId={userId} key={userId} />;
}

function Profile({ userId }) {
  const [comment, setComment] = useState('');
  // Fresh state on each userId change
}
```

## Resetting form state

```tsx
// BAD: effect clears form fields
useEffect(() => {
  setName('');
  setEmail('');
  setNotes('');
}, [contactId]);

// GOOD
<EditForm key={contactId} contact={contact} />
```
