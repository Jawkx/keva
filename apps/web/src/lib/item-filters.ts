import type { Operator, QueryCondition } from "@keva/schema";
import { coerceScalar, scalarToInput, valueType } from "./properties";

export const FILTER_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "exists",
] as const satisfies readonly Operator[];

// Human-readable labels for the operator dropdown; the wire value stays `eq`
// etc. so the query API is unchanged.
export const FILTER_OPERATOR_LABELS: Record<Operator, string> = {
  eq: "is",
  neq: "is not",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  contains: "contains",
  exists: "exists",
};

export const FILTER_VALUE_TYPES = ["string", "number", "boolean"] as const;
export type FilterValueType = (typeof FILTER_VALUE_TYPES)[number];

export interface ConditionDraft {
  id: string;
  key: string;
  op: Operator;
  valueType: FilterValueType;
  value: string;
}

export type ConditionDraftPatch = Partial<Omit<ConditionDraft, "id">>;

export type KindFacetId = "all" | "image" | "video" | "audio";
export type SizeFacetId = "any" | "sm" | "md" | "lg" | "xl";

export interface FacetOption<Id extends string> {
  id: Id;
  label: string;
}

interface KindFacet extends FacetOption<KindFacetId> {
  prefix?: string;
}

interface SizeFacet extends FacetOption<SizeFacetId> {
  min?: number;
  max?: number;
}

export interface FilterDraft {
  kind: KindFacetId;
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

export const createConditionDraft = (): ConditionDraft => ({
  id: nextConditionId(),
  key: "",
  op: "eq",
  valueType: "string",
  value: "",
});

export const createFilterDraft = (): FilterDraft => ({
  kind: "all",
  size: "any",
  rows: [createConditionDraft()],
});

const MB = 1024 * 1024;

export const KIND_FACETS: readonly KindFacet[] = [
  { id: "all", label: "All" },
  { id: "image", label: "Images", prefix: "image/" },
  { id: "video", label: "Videos", prefix: "video/" },
  { id: "audio", label: "Audio", prefix: "audio/" },
];

export const SIZE_FACETS: readonly SizeFacet[] = [
  { id: "any", label: "Any size" },
  { id: "sm", label: "< 1 MB", max: MB },
  { id: "md", label: "1-10 MB", min: MB, max: 10 * MB },
  { id: "lg", label: "10-100 MB", min: 10 * MB, max: 100 * MB },
  { id: "xl", label: "> 100 MB", min: 100 * MB },
];

export const updateConditionDraft = (
  draft: FilterDraft,
  id: string,
  patch: ConditionDraftPatch,
): FilterDraft => ({
  ...draft,
  rows: draft.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
});

export const addConditionDraft = (draft: FilterDraft): FilterDraft => ({
  ...draft,
  rows: [...draft.rows, createConditionDraft()],
});

export const removeConditionDraft = (draft: FilterDraft, id: string): FilterDraft => {
  const rows = draft.rows.filter((row) => row.id !== id);
  return { ...draft, rows: rows.length > 0 ? rows : [createConditionDraft()] };
};

const kindConditions = (id: KindFacetId): QueryCondition[] => {
  const facet = KIND_FACETS.find((option) => option.id === id);
  return facet?.prefix ? [{ key: "system.content_type", op: "contains", value: facet.prefix }] : [];
};

const sizeConditions = (id: SizeFacetId): QueryCondition[] => {
  const facet = SIZE_FACETS.find((option) => option.id === id);
  if (!facet) return [];

  const conditions: QueryCondition[] = [];
  if (facet.min !== undefined) conditions.push({ key: "system.size", op: "gte", value: facet.min });
  if (facet.max !== undefined) conditions.push({ key: "system.size", op: "lt", value: facet.max });
  return conditions;
};

const rowConditions = (rows: readonly ConditionDraft[]): QueryCondition[] =>
  rows
    .filter((row) => row.key.trim().length > 0)
    .map((row) =>
      row.op === "exists"
        ? { key: row.key.trim(), op: row.op }
        : { key: row.key.trim(), op: row.op, value: coerceScalar(row.valueType, row.value) },
    );

export const buildFilterWhere = (draft: FilterDraft): QueryCondition[] => [
  ...kindConditions(draft.kind),
  ...sizeConditions(draft.size),
  ...rowConditions(draft.rows),
];

// Inverse of buildFilterWhere for seeding the panel from a saved view. Every
// condition becomes a plain row (the kind/size quick facets are just UI sugar
// over the same conditions, so a facet-derived view shows as raw rows but
// round-trips identically). Array/null values fall back to an empty string
// input — edit those through JSON if needed.
const FILTER_VALUE_TYPE_SET = new Set<string>(FILTER_VALUE_TYPES);

const rowValueType = (condition: QueryCondition): FilterValueType => {
  if (condition.value === undefined) return "string";
  const type = valueType(condition.value);
  return FILTER_VALUE_TYPE_SET.has(type) ? (type as FilterValueType) : "string";
};

export const draftFromConditions = (conditions: readonly QueryCondition[]): FilterDraft => ({
  kind: "all",
  size: "any",
  rows:
    conditions.length > 0
      ? conditions.map((condition) => ({
          ...createConditionDraft(),
          key: condition.key,
          op: condition.op,
          valueType: rowValueType(condition),
          value: condition.value === undefined ? "" : scalarToInput(condition.value),
        }))
      : [createConditionDraft()],
});
