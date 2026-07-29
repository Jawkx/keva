import { Schema } from "effect";

export const PropertyKeysResult = Schema.Struct({
  keys: Schema.Array(Schema.String),
});
export type PropertyKeysResult = typeof PropertyKeysResult.Type;

export const PropertyScalar = Schema.String;
export type PropertyScalar = typeof PropertyScalar.Type;

export const PropertyValuesResult = Schema.Struct({
  values: Schema.Array(PropertyScalar),
});
export type PropertyValuesResult = typeof PropertyValuesResult.Type;

// Observed value shapes for one property key across a tenant's ready items.
// "tag" is the product name for a bare `null` value (pure membership tag); a
// key can be mixed, e.g. ["tag", "string"] when some items carry it bare.
export const PropertyKind = Schema.Literal("tag", "string", "array");
export type PropertyKind = typeof PropertyKind.Type;

export const PropertySummary = Schema.Struct({
  key: Schema.String,
  kinds: Schema.Array(PropertyKind),
  values: Schema.Array(PropertyScalar),
});
export type PropertySummary = typeof PropertySummary.Type;

export const PropertySummaryResult = Schema.Struct({
  entries: Schema.Array(PropertySummary),
});
export type PropertySummaryResult = typeof PropertySummaryResult.Type;

export const PropertySuggestion = Schema.Struct({
  key: Schema.String,
  value: Schema.optional(PropertyScalar),
});
export type PropertySuggestion = typeof PropertySuggestion.Type;

export const PropertySuggestionsResult = Schema.Struct({
  entries: Schema.Array(PropertySuggestion),
});
export type PropertySuggestionsResult = typeof PropertySuggestionsResult.Type;
