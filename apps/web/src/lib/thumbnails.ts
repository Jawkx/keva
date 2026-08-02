export const loadOptionalThumbnailUrl = async (
  load: () => Promise<{ readonly url: string }>,
): Promise<string | null> => {
  try {
    return (await load()).url;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "_tag" in error &&
      error._tag === "NotFound"
    ) {
      return null;
    }
    throw error;
  }
};
