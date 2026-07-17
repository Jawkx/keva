import { Cause, Option } from "effect";

export const failureOrElse = <E>(cause: Cause.Cause<E>, fallback: () => E): E =>
  Option.getOrElse(Cause.failureOption(cause), fallback);

export const defectTypes = <E>(cause: Cause.Cause<E>): ReadonlyArray<string> =>
  Array.from(Cause.defects(cause), (defect) =>
    defect instanceof Error ? defect.name : typeof defect,
  );
