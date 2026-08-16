import { Option, Schema } from "effect";

export const ITEM_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const Scope = Schema.Literals(["read", "write", "delete", "views", "shares", "admin"]);
export type Scope = typeof Scope.Type;

export const ItemStatus = Schema.Literals(["pending", "confirming", "ready", "deleting"]);
export type ItemStatus = typeof ItemStatus.Type;

export const ItemId = Schema.String.pipe(Schema.check(Schema.isPattern(ITEM_ID_PATTERN)));
export type ItemId = typeof ItemId.Type;

// Accepts any RFC-3339 / ISO-8601 instant: date + time + zone, with optional
// fractional seconds and a numeric offset or `Z`. Rejects loose inputs like
// "2026" or "Jan 1 2020" that `Date.parse` would otherwise coerce.
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

export const isIsoInstant = (value: string): boolean =>
  ISO_INSTANT_PATTERN.test(value) && Number.isFinite(Date.parse(value));

export const isFutureInstant = (value: string, now = Date.now()): boolean =>
  isIsoInstant(value) && Date.parse(value) > now;

export const IsoInstant = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isIsoInstant, { message: "Expected an ISO-8601 instant" })),
);
export type IsoInstant = typeof IsoInstant.Type;

const CURSOR_ORDERS = [
  "created_at_asc",
  "created_at_desc",
  "size_asc",
  "size_desc",
  "name_asc",
  "name_desc",
  "updated_at_asc",
  "updated_at_desc",
] as const;
type CursorOrder = (typeof CURSOR_ORDERS)[number];

export type Cursor = readonly [sortValue: string | number, id: string, order?: CursorOrder];

export const encodeCursor = (cursor: Cursor): string => btoa(JSON.stringify(cursor));

const CursorPayload = Schema.Union([
  Schema.Tuple([Schema.Union([Schema.String, Schema.Number]), Schema.String]),
  Schema.Tuple([
    Schema.Union([Schema.String, Schema.Number]),
    Schema.String,
    Schema.Literals(CURSOR_ORDERS),
  ]),
]);
const isString = Schema.is(Schema.String);
const isNumber = Schema.is(Schema.Number);

export const decodeCursor = (cursor: string): Cursor | null => {
  try {
    const decoded = Schema.decodeUnknownOption(CursorPayload)(JSON.parse(atob(cursor)));
    if (Option.isNone(decoded)) return null;
    const value = decoded.value;
    const order = value[2];
    const numericValue = isNumber(value[0]) && Number.isSafeInteger(value[0]) && value[0] >= 0;
    const timestampValue = isString(value[0]) && Number.isFinite(Date.parse(value[0]));
    const sortValueValid =
      order === undefined
        ? numericValue || timestampValue
        : order.startsWith("size_")
          ? numericValue
          : order.startsWith("name_")
            ? isString(value[0])
            : timestampValue;
    if (!sortValueValid || !ITEM_ID_PATTERN.test(value[1])) return null;
    return order ? [value[0], value[1], order] : [value[0], value[1]];
  } catch {
    return null;
  }
};
