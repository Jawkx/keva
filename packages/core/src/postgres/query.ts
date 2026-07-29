import {
  FIELD_BY_KEY,
  type Cursor,
  type KevaItem,
  type QueryCondition,
  type QueryOrder,
} from "@keva/schema";
import type { Sql } from "postgres";
import { jsonbParam } from "./mappers.js";

export type Fragment = ReturnType<Sql["unsafe"]>;
export type CursorPredicate = (cursor: Cursor) => Fragment;

export const systemColumn = (
  sql: Sql,
  key: string,
): {
  fragment: Fragment;
  type: "string" | "number" | "nullable-string" | "timestamp";
} | null => {
  const field = FIELD_BY_KEY.get(key);
  return field ? { fragment: sql.unsafe(field.column), type: field.queryType } : null;
};

export const comparison = (sql: Sql, operator: string): Fragment => {
  const allowed: Record<string, string> = {
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
  };
  return sql.unsafe(allowed[operator] ?? "=");
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
      return value === null
        ? sql`${column.fragment} is null`
        : sql`${column.fragment} = ${value as string | number}`;
    }
    if (condition.op === "neq") {
      return value === null
        ? sql`${column.fragment} is not null`
        : sql`(${column.fragment} is null or ${column.fragment} <> ${value as string | number})`;
    }
    if (condition.op === "in") {
      return sql`${column.fragment} in ${sql(value as readonly string[])}`;
    }
    if (condition.op === "contains_text") {
      return sql`position(${value as string} in ${column.fragment}) > 0`;
    }
    if (condition.op === "contains_any") {
      return anyOf(
        sql,
        (value as readonly string[]).map(
          (member) => sql`position(${member} in ${column.fragment}) > 0`,
        ),
      );
    }
    return sql`${column.fragment} ${comparison(sql, condition.op)} ${value as string | number}`;
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
  if (condition.op === "has_value") return hasValue(value as string);
  if (condition.op === "has_any") {
    return anyOf(sql, (value as readonly string[]).map(hasValue));
  }
  if (condition.op === "has_all") {
    return (value as readonly string[])
      .map(hasValue)
      .reduce((left, right) => sql`${left} and ${right}`);
  }
  if (condition.op === "contains_text") return containsText(value as string);
  if (condition.op === "contains_any") {
    return anyOf(sql, (value as readonly string[]).map(containsText));
  }
  return sql`false`;
};

export const escapeLikePattern = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

export const queryOrder = (
  sql: Sql,
  order: QueryOrder,
): {
  readonly by: Fragment;
  readonly afterCursor: CursorPredicate;
  readonly cursorFor: (item: KevaItem) => Cursor;
} => {
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
