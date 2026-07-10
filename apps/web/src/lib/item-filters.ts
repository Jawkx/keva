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

export const FILTER_OPERATOR_LABELS: Record<Operator, string> = {
  eq: "is",
  neq: "is not",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  contains: "contains",
  in: "is any of",
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

export type KindFacetId = "all" | "image" | "video" | "audio" | "document";
export type SizeFacetId = "any" | "sm" | "md" | "lg" | "xl";

export interface FacetOption<Id extends string> {
  id: Id;
  label: string;
}

interface KindFacet extends FacetOption<KindFacetId> {
  prefix?: string;
  types?: readonly string[];
}

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
  { id: "document", label: "Documents", types: DOCUMENT_TYPES },
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

const CONTENT_TYPE_KEY = "system.content_type";
const SIZE_KEY = "system.size";

const kindConditions = (id: KindFacetId): QueryCondition[] => {
  const facet = KIND_FACETS.find((option) => option.id === id);
  if (facet?.types) return [{ key: CONTENT_TYPE_KEY, op: "in", value: [...facet.types] }];
  if (facet?.prefix) return [{ key: CONTENT_TYPE_KEY, op: "contains", value: facet.prefix }];
  return [];
};

const sizeConditions = (id: SizeFacetId): QueryCondition[] => {
  const facet = SIZE_FACETS.find((option) => option.id === id);
  if (!facet) return [];

  const conditions: QueryCondition[] = [];
  if (facet.min !== undefined) conditions.push({ key: SIZE_KEY, op: "gte", value: facet.min });
  if (facet.max !== undefined) conditions.push({ key: SIZE_KEY, op: "lt", value: facet.max });
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

const FILTER_VALUE_TYPE_SET = new Set<string>(FILTER_VALUE_TYPES);

const rowValueType = (condition: QueryCondition): FilterValueType => {
  if (condition.value === undefined) return "string";
  const type = valueType(condition.value);
  return FILTER_VALUE_TYPE_SET.has(type) ? (type as FilterValueType) : "string";
};

const sameStringArray = (a: readonly unknown[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const matchKindCondition = (condition: QueryCondition): KindFacetId | null => {
  if (condition.key !== CONTENT_TYPE_KEY) return null;
  if (condition.op === "in" && Array.isArray(condition.value)) {
    const facet = KIND_FACETS.find(
      (f) => f.types && sameStringArray(condition.value as unknown[], f.types),
    );
    return facet?.id ?? null;
  }
  if (condition.op === "contains" && typeof condition.value === "string") {
    const facet = KIND_FACETS.find((f) => f.prefix && f.prefix === condition.value);
    return facet?.id ?? null;
  }
  return null;
};

const matchSizeFacet = (min: number | undefined, max: number | undefined): SizeFacetId | null => {
  const facet = SIZE_FACETS.find((f) => f.id !== "any" && f.min === min && f.max === max);
  return facet?.id ?? null;
};

export const draftFromConditions = (conditions: readonly QueryCondition[]): FilterDraft => {
  const rest = [...conditions];

  let kind: KindFacetId = "all";
  const kindIndex = rest.findIndex((c) => matchKindCondition(c) !== null);
  if (kindIndex !== -1) {
    kind = matchKindCondition(rest[kindIndex]!)!;
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

  return {
    kind,
    size,
    rows:
      rest.length > 0
        ? rest.map((condition) => ({
            ...createConditionDraft(),
            key: condition.key,
            op: condition.op,
            valueType: rowValueType(condition),
            value: condition.value === undefined ? "" : scalarToInput(condition.value),
          }))
        : [createConditionDraft()],
  };
};

export interface FilterChip {
  id: string;
  label: string;
  remove: (draft: FilterDraft) => FilterDraft;
}

const OP_LABEL: Partial<Record<Operator, string>> = {
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "∋",
  in: "∈",
};

const rowChipLabel = (row: ConditionDraft): string => {
  const key = row.key.trim();
  if (row.op === "exists") return key;
  if (row.op === "eq") return `${key}:${row.value}`;
  return `${key} ${OP_LABEL[row.op] ?? row.op} ${row.value}`;
};

export const filterChips = (draft: FilterDraft): FilterChip[] => {
  const chips: FilterChip[] = [];
  if (draft.kind !== "all") {
    const label = KIND_FACETS.find((f) => f.id === draft.kind)?.label ?? draft.kind;
    chips.push({ id: "kind", label, remove: (d) => ({ ...d, kind: "all" }) });
  }
  if (draft.size !== "any") {
    const label = SIZE_FACETS.find((f) => f.id === draft.size)?.label ?? draft.size;
    chips.push({ id: "size", label, remove: (d) => ({ ...d, size: "any" }) });
  }
  for (const row of draft.rows) {
    if (row.key.trim().length === 0) continue;
    chips.push({
      id: row.id,
      label: rowChipLabel(row),
      remove: (d) => removeConditionDraft(d, row.id),
    });
  }
  return chips;
};

const SIZE_PHRASE: Record<Exclude<SizeFacetId, "any">, string> = {
  sm: "Smaller than 1 MB",
  md: "Between 1 and 10 MB",
  lg: "Between 10 and 100 MB",
  xl: "Larger than 100 MB",
};

const ROW_OP_PHRASE: Partial<Record<Operator, string>> = {
  neq: "is not",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  contains: "contains",
  in: "is any of",
};

const prettyKey = (key: string): string => key.replace(/^system\./, "");

const rowPhrase = (row: ConditionDraft): string => {
  const key = prettyKey(row.key.trim());
  if (row.op === "exists") return `has ${key}`;
  if (row.op === "eq") return `${key} is ${row.value}`;
  return `${key} ${ROW_OP_PHRASE[row.op] ?? row.op} ${row.value}`;
};

export const describeFilter = (conditions: readonly QueryCondition[]): string[] => {
  const draft = draftFromConditions(conditions);
  const parts: string[] = [];
  if (draft.kind !== "all") {
    const label = KIND_FACETS.find((f) => f.id === draft.kind)?.label ?? draft.kind;
    parts.push(`All ${label.toLowerCase()}`);
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
    return parsed.filter(
      (c): c is QueryCondition =>
        typeof c === "object" &&
        c !== null &&
        typeof c.key === "string" &&
        typeof c.op === "string",
    );
  } catch {
    return [];
  }
};
