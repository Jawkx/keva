# Conditional Mounting

Instead of guarding inside an effect, control mounting in the parent:

```tsx
// BAD
function VideoPlayer({ isLoading }) {
  useEffect(() => {
    if (!isLoading) playVideo();
  }, [isLoading]);
}

// GOOD: parent controls when to mount
function VideoPlayerWrapper({ isLoading }) {
  if (isLoading) return <LoadingScreen />;
  return <VideoPlayer />;
}

function VideoPlayer() {
  useMountEffect(() => playVideo());
}
```

## Persistent shell + conditional instance

When you need a persistent container but conditional behavior:

```tsx
function VideoPlayerContainer({ isLoading }) {
  return (
    <>
      <VideoPlayerShell isLoading={isLoading} />
      {!isLoading && <VideoPlayerInstance />}
    </>
  );
}

function VideoPlayerInstance() {
  useMountEffect(() => playVideo());
}
```
