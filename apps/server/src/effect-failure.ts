import { Cause, Option } from "effect";

export const failureOrElse = <E>(cause: Cause.Cause<E>, fallback: () => E): E =>
  Option.getOrElse(Cause.findErrorOption(cause), fallback);

export const defectTypes = <E>(cause: Cause.Cause<E>): ReadonlyArray<string> =>
  cause.reasons
    .filter(Cause.isDieReason)
    .map(({ defect }) => (defect instanceof Error ? defect.name : typeof defect));
