import { isNotFound } from "./errors";

export type ThumbnailTarget = {
  readonly url: string;
  readonly expiresAt: string;
};

export const THUMBNAIL_EXPIRY_MARGIN_MS = 60_000;
export const thumbnailQueryKey = (itemId: string) => ["thumbnail", itemId] as const;

export const thumbnailRefreshInterval = (
  expiresAt: string | undefined,
  now = Date.now(),
): number | false => {
  if (!expiresAt) return false;
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return false;
  return Math.max(1_000, expiresAtMs - now - THUMBNAIL_EXPIRY_MARGIN_MS);
};

export const loadOptionalThumbnail = async (
  load: () => Promise<ThumbnailTarget>,
): Promise<ThumbnailTarget | null> => {
  try {
    return await load();
  } catch (cause) {
    if (isNotFound(cause)) return null;
    throw cause;
  }
};

export const loadOptionalThumbnailUrl = async (
  load: () => Promise<ThumbnailTarget>,
): Promise<string | null> => (await loadOptionalThumbnail(load))?.url ?? null;
