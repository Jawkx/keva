import { Schema } from "effect";
import { isPropertyKey, PROPERTY_LIMITS, validateProperties } from "./fields.js";

export const PropertyKey = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(PROPERTY_LIMITS.keyLength)),
  Schema.check(
    Schema.makeFilter((key) => isPropertyKey(key), {
      message: "Property keys must be valid and non-reserved",
    }),
  ),
);
export type PropertyKey = typeof PropertyKey.Type;

export const PropertyString = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(
    Schema.makeFilter(
      (value) => new TextEncoder().encode(value).byteLength <= PROPERTY_LIMITS.stringBytes,
      { message: "String properties must be at most 8 KB" },
    ),
  ),
);

const PropertyArray = <S extends Schema.Constraint>(item: S) =>
  Schema.Array(item).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(PROPERTY_LIMITS.arrayItems)),
    Schema.check(
      Schema.makeFilter((values) => new Set(values).size === values.length, {
        message: "Array property values must be unique",
      }),
    ),
  );

export const PropertyValue = Schema.Union([
  PropertyString,
  Schema.Null,
  PropertyArray(PropertyString),
]);
export type PropertyValue = typeof PropertyValue.Type;

export const Properties = Schema.Record(Schema.String, PropertyValue).pipe(
  Schema.check(
    Schema.makeFilter((properties) => validateProperties(properties) === null, {
      message: "Invalid properties",
    }),
  ),
);
export type Properties = typeof Properties.Type;
