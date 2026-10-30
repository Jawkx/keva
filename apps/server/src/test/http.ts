import { Schema } from "effect";

export const decodeResponseJson = async <A>(
  schema: Schema.ConstraintDecoder<A>,
  response: Response,
): Promise<A> => Schema.decodeUnknownPromise(schema)(await response.json());
