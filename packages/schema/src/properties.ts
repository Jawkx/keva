import { Schema } from "effect";
import { isPropertyKey, PROPERTY_LIMITS, validateProperties } from "./fields.js";

export const PropertyKey = Schema.String.pipe(
  Schema.maxLength(PROPERTY_LIMITS.keyLength),
  Schema.filter((key) => isPropertyKey(key), {
    message: () => "Property keys must be valid and non-reserved",
  }),
);
export type PropertyKey = typeof PropertyKey.Type;

export const PropertyString = Schema.String.pipe(
  Schema.minLength(1),
  Schema.filter(
    (value) => new TextEncoder().encode(value).byteLength <= PROPERTY_LIMITS.stringBytes,
    { message: () => "String properties must be at most 8 KB" },
  ),
);

const PropertyArray = <A, I, R>(item: Schema.Schema<A, I, R>) =>
  Schema.Array(item).pipe(
    Schema.minItems(1),
    Schema.maxItems(PROPERTY_LIMITS.arrayItems),
    Schema.filter((values) => new Set(values).size === values.length, {
      message: () => "Array property values must be unique",
    }),
  );

export const PropertyValue = Schema.Union(
  PropertyString,
  Schema.Null,
  PropertyArray(PropertyString),
);
export type PropertyValue = typeof PropertyValue.Type;

export const Properties = Schema.Record({
  key: Schema.String,
  value: PropertyValue,
}).pipe(
  Schema.filter((properties) => validateProperties(properties) === null, {
    message: () => "Invalid properties",
  }),
);
export type Properties = typeof Properties.Type;
