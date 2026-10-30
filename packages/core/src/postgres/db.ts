import {
  decodeCursor as decodeSharedCursor,
  Internal,
  ValidationError,
  type Cursor,
  type ItemEvent,
  type KevaError,
  type QueryOrder,
} from "@keva/schema";
import { Effect, Schema } from "effect";
import type { TransactionSql } from "postgres";
import { jsonbParam } from "./mappers.js";

export const insertEvent = async (sql: TransactionSql, event: ItemEvent): Promise<void> => {
  await sql`
    insert into item_events (id, tenant_id, item_id, item_name, action, actor, payload, created_at)
    values (
      ${event.id}, ${event.tenantId}, ${event.itemId}, ${event.itemName}, ${event.action},
      ${jsonbParam(event.actor)}::text::jsonb, ${jsonbParam(event.payload)}::text::jsonb, ${event.createdAt}
    )
  `;
};

export const encodeEventCursor = (event: ItemEvent): string =>
  btoa(JSON.stringify([event.createdAt, event.id]));

export const dbFailure = (): Internal => new Internal({ message: "Metadata store unavailable" });

export const attempt = <A>(operation: () => Promise<A>): Effect.Effect<A, KevaError> =>
  Effect.tryPromise({ try: operation, catch: dbFailure });

export const decodeCursor = (cursor: string): Effect.Effect<Cursor, ValidationError> => {
  const decoded = decodeSharedCursor(cursor);
  return decoded
    ? Effect.succeed(decoded)
    : Effect.fail(new ValidationError({ message: "Invalid query cursor" }));
};

export const invalidCursor = () =>
  new ValidationError({ message: "Cursor does not match query order" });

const isNumber = Schema.is(Schema.Number);
const isString = Schema.is(Schema.String);

export const decodeQueryCursor = (
  cursor: string,
  order: QueryOrder,
): Effect.Effect<Cursor, ValidationError> =>
  Effect.flatMap(decodeCursor(cursor), (decoded) =>
    (order.startsWith("size_") ? isNumber(decoded[0]) : isString(decoded[0])) &&
    (decoded[2] === order || (decoded[2] === undefined && order.startsWith("created_at_")))
      ? Effect.succeed(decoded)
      : Effect.fail(invalidCursor()),
  );

export const decodeEventCursor = (
  cursor: string,
): Effect.Effect<readonly [string, string], ValidationError> =>
  Effect.flatMap(decodeCursor(cursor), (decoded) =>
    isString(decoded[0]) && decoded[2] === undefined
      ? Effect.succeed([decoded[0], decoded[1]])
      : Effect.fail(invalidCursor()),
  );
