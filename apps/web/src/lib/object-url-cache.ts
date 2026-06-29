// Object URLs for previewed item content, keyed by item id. The bytes
// themselves are cached by React Query (`['content', id]`); this owns only the
// blob: URL string and its `revokeObjectURL` lifecycle.
//
// This is an LRU, not a per-component lifecycle. Deliberately NOT revoked on
// component unmount: under StrictMode a mount→unmount→mount cycle would revoke
// the URL a freshly-rendered <img> is still pointing at (the memo that built it
// won't re-run, so it never recovers). Instead the URL lives until evicted, so
// reopening a cached file renders instantly from the same valid URL. Memory is
// bounded by evicting (and revoking) the least-recently-used entry.
//
// Mirrors the module-level URL cache already used for PDF thumbnails
// (pdf-thumbnail-utils), which likewise never revokes per-component.
const MAX_ENTRIES = 12;

// Insertion order is the LRU order: re-inserting on access moves an entry to
// the most-recently-used end.
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
