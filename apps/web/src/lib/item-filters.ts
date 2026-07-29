import {
  QueryCondition as QueryConditionSchema,
  type Operator,
  type PropertyKind,
  type QueryCondition,
} from "@keva/schema";
import { Schema } from "effect";

export type FilterScalar = string | number;

export const FILTER_OPERATORS = [
  "eq",
  "neq",
  "missing",
  "is_tag",
  "has_value",
  "has_any",
  "has_all",
  "contains_text",
  "contains_any",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
] as const satisfies readonly Operator[];

export const FILTER_OPERATOR_LABELS: Record<Operator, string> = {
  eq: "is",
  neq: "is not",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  exists: "exists",
  missing: "is missing",
  is_tag: "is a tag",
  has_value: "is",
  has_any: "is",
  has_all: "has all",
  contains_text: "contains",
  contains_any: "contains",
  in: "is one of",
};

export const opNeedsValue = (op: Operator): boolean =>
  op !== "exists" && op !== "missing" && op !== "is_tag";
export const opAllowsMultiple = (op: Operator): boolean =>
  op === "has_any" || op === "has_all" || op === "contains_any" || op === "in";

const CUSTOM_OPERATORS: readonly Operator[] = [
  "exists",
  "missing",
  "is_tag",
  "has_value",
  "has_all",
  "contains_text",
];
const UNKNOWN_CUSTOM_OPERATORS: readonly Operator[] = [
  "exists",
  "missing",
  "is_tag",
  "has_value",
  "contains_text",
];
const TEXT_OPERATORS: readonly Operator[] = ["eq", "neq", "contains_text"];
const RANGE_OPERATORS: readonly Operator[] = ["eq", "neq", "gt", "gte", "lt", "lte"];

export const operatorsForKey = (
  key: string,
  kinds?: readonly PropertyKind[],
): readonly Operator[] => {
  if (!key.startsWith("system.") && key !== "name") {
    if (!kinds) return UNKNOWN_CUSTOM_OPERATORS;
    if (kinds.every((kind) => kind === "tag")) return ["exists", "missing"];
    return CUSTOM_OPERATORS.filter((op) => {
      if (op === "is_tag") return kinds.includes("tag");
      if (op === "has_all") return kinds.includes("array");
      return true;
    });
  }
  if (key === "system.size") return RANGE_OPERATORS;
  if (key === "system.created_at" || key === "system.updated_at") return RANGE_OPERATORS;
  return TEXT_OPERATORS;
};

export const visibleOperator = (op: Operator): Operator => {
  if (op === "has_any") return "has_value";
  if (op === "contains_any") return "contains_text";
  return op;
};

export const operatorForValueCount = (op: Operator, count: number): Operator => {
  const visible = visibleOperator(op);
  if (visible === "has_value" && count > 1) return "has_any";
  if (visible === "contains_text" && count > 1) return "contains_any";
  return visible;
};

export const inferScalar = (raw: string, key = ""): FilterScalar => {
  const trimmed = raw.trim();
  if (key === "system.size" && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
};

export const formatScalar = (value: FilterScalar): string => String(value);

export type KindId = "image" | "video" | "audio" | "document";
export type SizeFacetId = "any" | "sm" | "md" | "lg" | "xl";

const DOCUMENT_TYPES = [
  "application/pdf",
  "text/",
  "application/json",
  "application/rtf",
  "application/msword",
  "application/vnd.ms-",
  "application/vnd.openxmlformats-officedocument",
  "application/vnd.oasis.opendocument",
] as const;

export interface KindOption {
  id: KindId;
  label: string;
  // content_type alternatives matched by substring.
  alternatives: readonly string[];
}

export const KIND_OPTIONS: readonly KindOption[] = [
  { id: "image", label: "Images", alternatives: ["image/"] },
  { id: "video", label: "Videos", alternatives: ["video/"] },
  { id: "audio", label: "Audio", alternatives: ["audio/"] },
  { id: "document", label: "Documents", alternatives: DOCUMENT_TYPES },
];

export interface SizeOption {
  id: SizeFacetId;
  label: string;
  min?: number;
  max?: number;
}

const MB = 1024 * 1024;

export const SIZE_OPTIONS: readonly SizeOption[] = [
  { id: "any", label: "Any size" },
  { id: "sm", label: "< 1 MB", max: MB },
  { id: "md", label: "1-10 MB", min: MB, max: 10 * MB },
  { id: "lg", label: "10-100 MB", min: 10 * MB, max: 100 * MB },
  { id: "xl", label: "> 100 MB", min: 100 * MB },
];

export interface ConditionDraft {
  id: string;
  key: string;
  op: Operator;
  values: FilterScalar[];
}

export interface FilterDraft {
  kinds: KindId[];
  size: SizeFacetId;
  rows: ConditionDraft[];
}

let fallbackConditionId = 0;

const nextConditionId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `condition:${crypto.randomUUID()}`;
  }
  fallbackConditionId += 1;
  return `condition:${fallbackConditionId}`;
};

export const createConditionDraft = (
  key: string,
  op: Operator,
  values: FilterScalar[],
): ConditionDraft => ({ id: nextConditionId(), key, op, values });

export const createFilterDraft = (): FilterDraft => ({ kinds: [], size: "any", rows: [] });

export const updateConditionDraft = (
  draft: FilterDraft,
  id: string,
  patch: Partial<Omit<ConditionDraft, "id">>,
): FilterDraft => ({
  ...draft,
  rows: draft.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
});

export const removeConditionDraft = (draft: FilterDraft, id: string): FilterDraft => ({
  ...draft,
  rows: draft.rows.filter((row) => row.id !== id),
});

const CONTENT_TYPE_KEY = "system.content_type";
const SIZE_KEY = "system.size";

const kindById = (id: KindId): KindOption => KIND_OPTIONS.find((option) => option.id === id)!;

const kindConditions = (kinds: readonly KindId[]): QueryCondition[] => {
  if (kinds.length === 0) return [];
  const alternatives = kinds.flatMap((id) => kindById(id).alternatives);
  if (alternatives.length === 1) {
    return [{ key: CONTENT_TYPE_KEY, op: "contains_text", value: alternatives[0]! }];
  }
  return [{ key: CONTENT_TYPE_KEY, op: "contains_any", value: alternatives }];
};

const sizeConditions = (id: SizeFacetId): QueryCondition[] => {
  const facet = SIZE_OPTIONS.find((option) => option.id === id);
  if (!facet) return [];

  const conditions: QueryCondition[] = [];
  if (facet.min !== undefined) conditions.push({ key: SIZE_KEY, op: "gte", value: facet.min });
  if (facet.max !== undefined) conditions.push({ key: SIZE_KEY, op: "lt", value: facet.max });
  return conditions;
};

const rowCondition = (row: ConditionDraft): QueryCondition | null => {
  const key = row.key.trim();
  if (key.length === 0) return null;
  if (!opNeedsValue(row.op)) return { key, op: row.op };
  if (row.values.length === 0) return null;
  const op = operatorForValueCount(row.op, row.values.length);
  if (opAllowsMultiple(op)) return { key, op, value: row.values.map(String) };
  return { key, op, value: row.values[0]! };
};

export const buildFilterWhere = (draft: FilterDraft): QueryCondition[] => [
  ...kindConditions(draft.kinds),
  ...sizeConditions(draft.size),
  ...draft.rows.map(rowCondition).filter((c): c is QueryCondition => c !== null),
];

const isScalar = (value: unknown): value is FilterScalar =>
  typeof value === "string" || typeof value === "number";

const matchKindCondition = (condition: QueryCondition): KindId[] | null => {
  if (condition.key !== CONTENT_TYPE_KEY) return null;
  if (condition.op === "contains_text" && typeof condition.value === "string") {
    const value = condition.value;
    const kind = KIND_OPTIONS.find(
      (option) => option.alternatives.length === 1 && option.alternatives[0] === value,
    );
    return kind ? [kind.id] : null;
  }
  if (condition.op === "contains_any" && Array.isArray(condition.value)) {
    const values = new Set(condition.value.map(String));
    const kinds = KIND_OPTIONS.filter((option) =>
      option.alternatives.every((alt) => values.has(alt)),
    );
    const covered = new Set(kinds.flatMap((option) => option.alternatives));
    if (kinds.length > 0 && covered.size === values.size) return kinds.map((option) => option.id);
    return null;
  }
  return null;
};

const matchSizeFacet = (min: number | undefined, max: number | undefined): SizeFacetId | null => {
  const facet = SIZE_OPTIONS.find((f) => f.id !== "any" && f.min === min && f.max === max);
  return facet?.id ?? null;
};

export const draftFromConditions = (conditions: readonly QueryCondition[]): FilterDraft => {
  const rest = [...conditions];

  let kinds: KindId[] = [];
  const kindIndex = rest.findIndex((c) => matchKindCondition(c) !== null);
  if (kindIndex !== -1) {
    kinds = matchKindCondition(rest[kindIndex]!)!;
    rest.splice(kindIndex, 1);
  }

  let size: SizeFacetId = "any";
  const sizeRows = rest.filter((c) => c.key === SIZE_KEY && (c.op === "gte" || c.op === "lt"));
  if (sizeRows.length > 0) {
    const min = sizeRows.find((c) => c.op === "gte")?.value;
    const max = sizeRows.find((c) => c.op === "lt")?.value;
    const matched = matchSizeFacet(
      typeof min === "number" ? min : undefined,
      typeof max === "number" ? max : undefined,
    );
    if (matched) {
      size = matched;
      for (const row of sizeRows) rest.splice(rest.indexOf(row), 1);
    }
  }

  const rows = rest.map((condition) => {
    const values = Array.isArray(condition.value)
      ? condition.value.filter(isScalar)
      : isScalar(condition.value)
        ? [condition.value]
        : [];
    return createConditionDraft(condition.key, condition.op, values);
  });

  return { kinds, size, rows };
};

const SIZE_PHRASE: Record<Exclude<SizeFacetId, "any">, string> = {
  sm: "Smaller than 1 MB",
  md: "Between 1 and 10 MB",
  lg: "Between 10 and 100 MB",
  xl: "Larger than 100 MB",
};

const joinOr = (parts: readonly string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;

const prettyKey = (key: string): string => key.replace(/^system\./, "");

const rowPhrase = (row: ConditionDraft): string => {
  const key = prettyKey(row.key.trim());
  if (row.op === "exists") return `has ${key}`;
  if (row.op === "missing") return `does not have ${key}`;
  if (row.op === "is_tag") return `${key} is a tag`;
  const values = joinOr(row.values.map(formatScalar));
  if (row.op === "eq" && row.values.length <= 1) return `${key} is ${values}`;
  if (row.op === "has_any" || row.op === "contains_any") return `${key} has any of ${values}`;
  if (row.op === "has_all") return `${key} has all of ${values}`;
  return `${key} ${FILTER_OPERATOR_LABELS[row.op]} ${values}`;
};

export const describeFilter = (conditions: readonly QueryCondition[]): string[] => {
  const draft = draftFromConditions(conditions);
  const parts: string[] = [];
  if (draft.kinds.length > 0) {
    const labels = draft.kinds.map((id) => kindById(id).label.toLowerCase());
    parts.push(`All ${joinOr(labels)}`);
  }
  if (draft.size !== "any") parts.push(SIZE_PHRASE[draft.size]);
  for (const row of draft.rows) {
    if (row.key.trim().length > 0) parts.push(rowPhrase(row));
  }
  return parts;
};

export const encodeFilterParam = (where: readonly QueryCondition[]): string =>
  JSON.stringify(where);

export const decodeFilterParam = (raw: string | null): QueryCondition[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Schema.is(QueryConditionSchema));
  } catch {
    return [];
  }
};
