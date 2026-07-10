// Do not revoke on component unmount: StrictMode remounts can leave a rendered
// image with a revoked URL, so this bounded LRU owns the URL lifecycle instead.
const MAX_ENTRIES = 12;

const cache = new Map<string, string>();

export function objectUrlFor(id: string, blob: Blob): string {
  const existing = cache.get(id);
  if (existing) {
    cache.delete(id);
    cache.set(id, existing);
    return existing;
  }
  const url = URL.createObjectURL(blob);
  cache.set(id, url);
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    revokeObjectUrl(oldest);
  }
  return url;
}

export function revokeObjectUrl(id: string): void {
  const url = cache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    cache.delete(id);
  }
}
