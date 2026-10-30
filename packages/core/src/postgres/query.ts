import {
  FIELD_BY_KEY,
  type Cursor,
  type KevaItem,
  type QueryCondition,
  type QueryOrder,
} from "@keva/schema";
import { Schema } from "effect";
import type { Sql } from "postgres";
import { jsonbParam } from "./mappers.js";

export type Fragment = ReturnType<Sql["unsafe"]>;
export type CursorPredicate = (cursor: Cursor) => Fragment;

interface SystemColumn {
  readonly fragment: Fragment;
  readonly type: "string" | "number" | "nullable-string" | "timestamp";
}

interface QueryOrderPlan {
  readonly by: Fragment;
  readonly afterCursor: CursorPredicate;
  readonly cursorFor: (item: KevaItem) => Cursor;
}

const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);
const isStrings = Schema.is(Schema.Array(Schema.String));

export const systemColumn = (sql: Sql, key: string): SystemColumn | null => {
  const field = FIELD_BY_KEY.get(key);
  return field ? { fragment: sql.unsafe(field.column), type: field.queryType } : null;
};

export const comparison = (sql: Sql, operator: string): Fragment => {
  switch (operator) {
    case "gt":
      return sql.unsafe(">");
    case "gte":
      return sql.unsafe(">=");
    case "lt":
      return sql.unsafe("<");
    case "lte":
      return sql.unsafe("<=");
    default:
      return sql.unsafe("=");
  }
};

// OR-join a list of fragments into `(a or b or …)`. An empty list matches
// nothing (an `in` with no compatible members can never be satisfied).
export const anyOf = (sql: Sql, fragments: readonly Fragment[]): Fragment =>
  fragments.length === 0
    ? sql`false`
    : sql`(${fragments.reduce((left, right) => sql`${left} or ${right}`)})`;

export const compileCondition = (sql: Sql, condition: QueryCondition): Fragment => {
  const column = systemColumn(sql, condition.key);
  const value = condition.value;
  if (column) {
    if (condition.op === "exists") return sql`${column.fragment} is not null`;
    if (condition.op === "missing") return sql`${column.fragment} is null`;
    if (condition.op === "eq") {
      if (value === null) return sql`${column.fragment} is null`;
      return isString(value) || isNumber(value) ? sql`${column.fragment} = ${value}` : sql`false`;
    }
    if (condition.op === "neq") {
      if (value === null) return sql`${column.fragment} is not null`;
      return isString(value) || isNumber(value)
        ? sql`(${column.fragment} is null or ${column.fragment} <> ${value})`
        : sql`false`;
    }
    if (condition.op === "in") {
      return isStrings(value) ? sql`${column.fragment} in ${sql(value)}` : sql`false`;
    }
    if (condition.op === "contains_text") {
      return isString(value) ? sql`position(${value} in ${column.fragment}) > 0` : sql`false`;
    }
    if (condition.op === "contains_any") {
      return isStrings(value)
        ? anyOf(
            sql,
            value.map((member) => sql`position(${member} in ${column.fragment}) > 0`),
          )
        : sql`false`;
    }
    return isString(value) || isNumber(value)
      ? sql`${column.fragment} ${comparison(sql, condition.op)} ${value}`
      : sql`false`;
  }

  const key = condition.key;
  if (condition.op === "exists") return sql`properties ? ${key}`;
  if (condition.op === "missing") return sql`not (properties ? ${key})`;
  if (condition.op === "is_tag") return sql`properties -> ${key} = 'null'::jsonb`;
  const hasValue = (member: string): Fragment => {
    const arrayMatch = sql`(jsonb_typeof(properties -> ${key}) = 'array' and (properties -> ${key}) @> ${jsonbParam([member])}::text::jsonb)`;
    return sql`(${arrayMatch} or (jsonb_typeof(properties -> ${key}) = 'string' and properties ->> ${key} = ${member}))`;
  };
  const containsText = (text: string): Fragment => sql`(
    (jsonb_typeof(properties -> ${key}) = 'string' and position(${text} in properties ->> ${key}) > 0)
    or (jsonb_typeof(properties -> ${key}) = 'array' and exists (
      select 1 from jsonb_array_elements_text(properties -> ${key}) as member
      where position(${text} in member) > 0
    ))
  )`;
  if (condition.op === "has_value") return isString(value) ? hasValue(value) : sql`false`;
  if (condition.op === "has_any") {
    return isStrings(value) ? anyOf(sql, value.map(hasValue)) : sql`false`;
  }
  if (condition.op === "has_all") {
    return isStrings(value) && value.length > 0
      ? value.map(hasValue).reduce((left, right) => sql`${left} and ${right}`)
      : sql`false`;
  }
  if (condition.op === "contains_text") {
    return isString(value) ? containsText(value) : sql`false`;
  }
  if (condition.op === "contains_any") {
    return isStrings(value) ? anyOf(sql, value.map(containsText)) : sql`false`;
  }
  return sql`false`;
};

export const escapeLikePattern = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

export const queryOrder = (sql: Sql, order: QueryOrder): QueryOrderPlan => {
  if (order === "created_at_desc") {
    return {
      by: sql`created_at desc, id desc`,
      afterCursor: (cursor) =>
        sql`(created_at, id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`,
      cursorFor: (item) => [item.createdAt, item.id],
    };
  }
  if (order === "created_at_asc") {
    return {
      by: sql`created_at asc, id asc`,
      afterCursor: (cursor) =>
        sql`(created_at, id) > (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`,
      cursorFor: (item) => [item.createdAt, item.id],
    };
  }
  if (order === "updated_at_desc") {
    return {
      by: sql`updated_at desc, id desc`,
      afterCursor: (cursor) =>
        sql`(updated_at, id) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`,
      cursorFor: (item) => [item.updatedAt, item.id],
    };
  }
  if (order === "updated_at_asc") {
    return {
      by: sql`updated_at asc, id asc`,
      afterCursor: (cursor) =>
        sql`(updated_at, id) > (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`,
      cursorFor: (item) => [item.updatedAt, item.id],
    };
  }
  const name = sql`lower(name)`;
  if (order === "name_desc") {
    return {
      by: sql`${name} desc, id desc`,
      afterCursor: (cursor) => sql`(${name}, id) < (${cursor[0]}::text, ${cursor[1]}::uuid)`,
      cursorFor: (item) => [item.name.toLowerCase(), item.id],
    };
  }
  if (order === "name_asc") {
    return {
      by: sql`${name} asc, id asc`,
      afterCursor: (cursor) => sql`(${name}, id) > (${cursor[0]}::text, ${cursor[1]}::uuid)`,
      cursorFor: (item) => [item.name.toLowerCase(), item.id],
    };
  }
  const size = sql`coalesce(size, declared_size)`;
  if (order === "size_desc") {
    return {
      by: sql`${size} desc, id desc`,
      afterCursor: (cursor) => sql`(${size}, id) < (${cursor[0]}::bigint, ${cursor[1]}::uuid)`,
      cursorFor: (item) => [item.size ?? item.declaredSize, item.id],
    };
  }
  return {
    by: sql`${size} asc, id asc`,
    afterCursor: (cursor) => sql`(${size}, id) > (${cursor[0]}::bigint, ${cursor[1]}::uuid)`,
    cursorFor: (item) => [item.size ?? item.declaredSize, item.id],
  };
};
