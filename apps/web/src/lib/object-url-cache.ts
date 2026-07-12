// Do not revoke on component unmount: StrictMode remounts can leave a rendered
// image with a revoked URL, so this LRU owns the URL lifecycle. Its 32 MB
// budget matches the largest supported preview plus one warm entry.
const MAX_BYTES = 32 * 1024 * 1024;

interface ObjectUrlEntry {
  readonly url: string;
  readonly bytes: number;
}

const cache = new Map<string, ObjectUrlEntry>();

const cachedBytes = () => [...cache.values()].reduce((total, entry) => total + entry.bytes, 0);

export function objectUrlFor(id: string, blob: Blob): string {
  const existing = cache.get(id);
  if (existing) {
    cache.delete(id);
    cache.set(id, existing);
    return existing.url;
  }
  const url = URL.createObjectURL(blob);
  cache.set(id, { url, bytes: blob.size });
  while (cachedBytes() > MAX_BYTES && cache.size > 1) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    revokeObjectUrl(oldest);
  }
  return url;
}

export function revokeObjectUrl(id: string): void {
  const url = cache.get(id);
  if (url) {
    URL.revokeObjectURL(url.url);
    cache.delete(id);
  }
}

export function revokeAllObjectUrls(): void {
  while (cache.size > 0) {
    const id = cache.keys().next().value;
    if (id === undefined) return;
    revokeObjectUrl(id);
  }
}
