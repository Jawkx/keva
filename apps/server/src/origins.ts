export const trustedOriginsFor = (
  baseUrl: string,
  configured: string | undefined,
  defaults: ReadonlyArray<string> = [],
): string[] => [
  baseUrl,
  ...(configured
    ? configured
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    : defaults),
];
