# App Initialization

```tsx
// BAD: runs twice in dev, can invalidate tokens
useEffect(() => {
  loadDataFromLocalStorage();
  checkAuthToken();
}, []);

// GOOD option 1: module-level
if (typeof window !== 'undefined') {
  checkAuthToken();
  loadDataFromLocalStorage();
}

// GOOD option 2: guard variable with useMountEffect
let didInit = false;
function App() {
  useMountEffect(() => {
    if (!didInit) {
      didInit = true;
      loadDataFromLocalStorage();
      checkAuthToken();
    }
  });
}
```
