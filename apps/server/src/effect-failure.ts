import { Cause, Option, Predicate } from "effect";

export const failureOrElse = <E>(cause: Cause.Cause<E>, fallback: () => E): E =>
  Option.getOrElse(Cause.findErrorOption(cause), fallback);

const defectType = <Defect>(defect: Defect): string => {
  if (defect instanceof Error) return defect.name;
  if (Predicate.isUndefined(defect)) return "undefined";
  if (Predicate.isString(defect)) return "string";
  if (Predicate.isNumber(defect)) return "number";
  if (Predicate.isBoolean(defect)) return "boolean";
  if (Predicate.isBigInt(defect)) return "bigint";
  if (Predicate.isSymbol(defect)) return "symbol";
  if (Predicate.isFunction(defect)) return "function";
  return "object";
};

export const defectTypes = <E>(cause: Cause.Cause<E>): ReadonlyArray<string> =>
  cause.reasons.filter(Cause.isDieReason).map(({ defect }) => defectType(defect));
