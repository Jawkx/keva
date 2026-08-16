type JsonPrimitive = string | number | boolean | null;
interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}
interface JsonArray extends ReadonlyArray<JsonValue | undefined> {}
type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export const jsonbParam = (value: JsonValue | undefined): string | null =>
  value === undefined || value === null ? null : JSON.stringify(value);
