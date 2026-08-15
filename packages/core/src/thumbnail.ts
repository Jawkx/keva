export const THUMBNAIL_RECIPE_VERSION = 1;

const GENERATED_THUMBNAIL_CONTENT_TYPES = new Set([
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const supportsGeneratedThumbnail = (contentType: string): boolean =>
  GENERATED_THUMBNAIL_CONTENT_TYPES.has(contentType.toLowerCase().split(";", 1)[0]!.trim());

export const GENERATED_THUMBNAIL_CONTENT_TYPE_ALLOWLIST = [
  ...GENERATED_THUMBNAIL_CONTENT_TYPES,
] as const;
