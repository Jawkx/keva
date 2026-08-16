import { Effect, Schema } from "effect";
import { FIELD_BY_KEY, isQueryKey, PROPERTY_LIMITS } from "./fields.js";
import { isIsoInstant } from "./common.js";
import { KevaItem } from "./item.js";

export const Operator = Schema.Literals([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
  "missing",
  "is_tag",
  "has_value",
  "has_any",
  "has_all",
  "contains_text",
  "contains_any",
  "in",
]);
export type Operator = typeof Operator.Type;

export const QueryKey = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(PROPERTY_LIMITS.keyLength)),
  Schema.check(
    Schema.makeFilter((key) => isQueryKey(key), {
      message: "Invalid query key",
    }),
  ),
);

const QueryOperand = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Null,
  Schema.Array(Schema.String),
]);

const isNonEmptyUniqueStrings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((entry) => typeof entry === "string" && entry.length > 0) &&
  new Set(value).size === value.length;

export const QueryCondition = Schema.Struct({
  key: QueryKey,
  op: Operator,
  value: Schema.optional(QueryOperand),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      ({ key, op, value }) => {
        const field = FIELD_BY_KEY.get(key);
        if (!field) {
          if (["exists", "missing", "is_tag"].includes(op)) return value === undefined;
          if (op === "has_value" || op === "contains_text")
            return typeof value === "string" && value.length > 0;
          if (op === "has_any" || op === "has_all" || op === "contains_any")
            return isNonEmptyUniqueStrings(value);
          return false;
        }

        if (op === "exists" || op === "missing") return !field.required && value === undefined;
        if (["is_tag", "has_value", "has_any", "has_all"].includes(op)) return false;
        const nullable = !field.required;
        if (op === "eq" || op === "neq") {
          if (value === null) return nullable;
          if (field.queryType === "number") return typeof value === "number";
          if (field.queryType === "timestamp")
            return typeof value === "string" && isIsoInstant(value);
          return typeof value === "string" && value.length > 0;
        }
        if (op === "in") {
          return field.queryType === "string" && isNonEmptyUniqueStrings(value);
        }
        if (["gt", "gte", "lt", "lte"].includes(op)) {
          return field.queryType === "number"
            ? typeof value === "number"
            : field.queryType === "timestamp" && typeof value === "string" && isIsoInstant(value);
        }
        if (op === "contains_text")
          return (
            (field.queryType === "string" || field.queryType === "nullable-string") &&
            typeof value === "string" &&
            value.length > 0
          );
        if (op === "contains_any")
          return (
            (field.queryType === "string" || field.queryType === "nullable-string") &&
            isNonEmptyUniqueStrings(value)
          );
        return false;
      },
      { message: "Operator and value type are incompatible" },
    ),
  ),
);
export type QueryCondition = typeof QueryCondition.Type;

export const QueryOrder = Schema.Literals([
  "created_at_asc",
  "created_at_desc",
  "size_asc",
  "size_desc",
  "name_asc",
  "name_desc",
  "updated_at_asc",
  "updated_at_desc",
]);
export type QueryOrder = typeof QueryOrder.Type;

export const QuerySearchField = Schema.Literals(["name", "content_type"]);
export type QuerySearchField = typeof QuerySearchField.Type;

export const Query = Schema.Struct({
  where: Schema.Array(QueryCondition).pipe(Schema.withDecodingDefaultType(Effect.succeed([]))),
  search: Schema.optional(Schema.String.pipe(Schema.check(Schema.isMaxLength(256)))),
  searchFields: Schema.optional(
    Schema.Array(QuerySearchField).pipe(Schema.check(Schema.isMinLength(1))),
  ),
  limit: Schema.Number.pipe(
    Schema.check(Schema.isInt()),
    Schema.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
    Schema.withDecodingDefaultType(Effect.succeed(100)),
  ),
  cursor: Schema.optional(Schema.String),
  offset: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    ),
  ),
  order: QueryOrder.pipe(Schema.withDecodingDefaultType(Effect.succeed("created_at_asc" as const))),
}).pipe(
  Schema.check(
    Schema.makeFilter((query) => query.cursor === undefined || query.offset === undefined, {
      message: "Query cursor and offset are mutually exclusive",
    }),
  ),
);
export type Query = typeof Query.Type;

export const QueryResult = Schema.Struct({
  items: Schema.Array(KevaItem),
  nextCursor: Schema.optional(Schema.String),
  totalCount: Schema.optional(
    Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    ),
  ),
});
export type QueryResult = typeof QueryResult.Type;
