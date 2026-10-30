import { Schema } from "effect";

export const ImageRotation = Schema.Literals([0, 90, 180, 270]);
export type ImageRotation = typeof ImageRotation.Type;

export const ImagePresentation = Schema.Struct({
  rotation: Schema.optional(ImageRotation),
});
export type ImagePresentation = typeof ImagePresentation.Type;

export const ItemPresentation = Schema.Struct({
  image: Schema.optional(ImagePresentation),
});
export type ItemPresentation = typeof ItemPresentation.Type;
