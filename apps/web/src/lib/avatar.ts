import { Avatar, Style, type StyleOptions } from "@dicebear/core";
import lorelei from "@dicebear/styles/lorelei.json" with { type: "json" };
import { AvatarRecipe, type AvatarRecipe as AvatarRecipeType } from "@keva/schema";
import { Schema } from "effect";

const style = new Style(lorelei);
const dataUriCache = new Map<string, string>();

export const parseAvatarRecipe = (
  value: string | null | undefined,
): AvatarRecipeType | undefined => {
  if (!value) return undefined;
  try {
    return Schema.decodeUnknownSync(AvatarRecipe)(JSON.parse(value));
  } catch {
    return undefined;
  }
};

export const serializeAvatarRecipe = (recipe: AvatarRecipeType): string => JSON.stringify(recipe);

export const avatarRecipeForUser = (userId: string, value?: string | null): AvatarRecipeType =>
  parseAvatarRecipe(value) ?? { version: 1, seed: userId };

const optionalFeature = <Name extends string>(
  name: Name,
  value: string | null | undefined,
): Record<string, string | number> =>
  value === null
    ? { [`${name}Probability`]: 0 }
    : value
      ? { [`${name}Variant`]: value, [`${name}Probability`]: 100 }
      : {};

const optionsFor = (recipe: AvatarRecipeType): StyleOptions<typeof lorelei> => ({
  seed: recipe.seed,
  scale: 1.15,
  ...optionalFeature("beard", recipe.beard),
  ...optionalFeature("earrings", recipe.earrings),
  ...(recipe.eyebrows ? { eyebrowsVariant: recipe.eyebrows, eyebrowsProbability: 100 } : {}),
  ...(recipe.eyes ? { eyesVariant: recipe.eyes, eyesProbability: 100 } : {}),
  ...(recipe.freckles === undefined ? {} : { frecklesProbability: recipe.freckles ? 100 : 0 }),
  ...optionalFeature("glasses", recipe.glasses),
  ...(recipe.hair ? { hairVariant: recipe.hair, hairProbability: 100 } : {}),
  ...optionalFeature("hairAccessories", recipe.hairAccessory),
  ...(recipe.head ? { headVariant: recipe.head, headProbability: 100 } : {}),
  ...(recipe.mouth ? { mouthVariant: recipe.mouth, mouthProbability: 100 } : {}),
  ...(recipe.nose ? { noseVariant: recipe.nose, noseProbability: 100 } : {}),
});

export const resolveAvatarRecipe = (recipe: AvatarRecipeType): AvatarRecipeType => {
  const options = new Avatar(style, optionsFor(recipe)).toJSON().options;
  return Schema.decodeUnknownSync(AvatarRecipe)({
    version: 1,
    seed: recipe.seed,
    beard: options.beardVariant ?? null,
    earrings: options.earringsVariant ?? null,
    eyebrows: options.eyebrowsVariant,
    eyes: options.eyesVariant,
    freckles: options.frecklesVariant !== undefined,
    glasses: options.glassesVariant ?? null,
    hair: options.hairVariant,
    hairAccessory: options.hairAccessoriesVariant ?? null,
    head: options.headVariant,
    mouth: options.mouthVariant,
    nose: options.noseVariant,
  });
};

export const avatarDataUri = (recipe: AvatarRecipeType): string => {
  const key = serializeAvatarRecipe(recipe);
  const cached = dataUriCache.get(key);
  if (cached) return cached;
  const uri = new Avatar(style, optionsFor(recipe)).toDataUri();
  if (dataUriCache.size >= 300) dataUriCache.delete(dataUriCache.keys().next().value!);
  dataUriCache.set(key, uri);
  return uri;
};
