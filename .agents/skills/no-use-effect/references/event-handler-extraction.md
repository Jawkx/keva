# Event Handler Extraction

## Shared logic between multiple handlers

```tsx
// BAD: effect watches product.isInCart
useEffect(() => {
  if (product.isInCart) {
    showNotification(`Added ${product.name}!`);
  }
}, [product]);

// GOOD: shared function called from handlers
function buyProduct() {
  addToCart(product);
  showNotification(`Added ${product.name}!`);
}

function handleBuyClick() { buyProduct(); }
function handleCheckoutClick() { buyProduct(); navigateTo('/checkout'); }
```

## Form submission

```tsx
// BAD: effect watches jsonToSubmit
const [jsonToSubmit, setJsonToSubmit] = useState(null);
useEffect(() => {
  if (jsonToSubmit !== null) post('/api/register', jsonToSubmit);
}, [jsonToSubmit]);

// GOOD: submit in the handler
function handleSubmit(e) {
  e.preventDefault();
  post('/api/register', { firstName, lastName });
}
```

## Analytics vs. user actions

Analytics that fire "because the component was displayed" are valid for `useMountEffect`. Form submission that fires "because the user clicked submit" belongs in the handler.
