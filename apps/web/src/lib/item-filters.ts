import type { Operator, QueryCondition } from "@keva/schema";

export type FilterScalar = string | number | boolean;

export const FILTER_OPERATORS = [
  "eq",
  "neq",
  "in",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "exists",
] as const satisfies readonly Operator[];

export const FILTER_OPERATOR_LABELS: Record<Operator, string> = {
  eq: "is",
  neq: "is not",
  in: "is any of",
  contains: "contains",
  gt: "greater than",
  gte: "at least",
  lt: "less than",
  lte: "at most",
  exists: "exists",
};

export const opNeedsValue = (op: Operator): boolean => op !== "exists";
export const opAllowsMultiple = (op: Operator): boolean => op === "in" || op === "eq";

export const inferScalar = (raw: string): FilterScalar => {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
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
  // content_type alternatives matched by prefix/substring (`contains` / `in`)
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
    return [{ key: CONTENT_TYPE_KEY, op: "contains", value: alternatives[0]! }];
  }
  return [{ key: CONTENT_TYPE_KEY, op: "in", value: alternatives }];
};

const sizeConditions = (id: SizeFacetId): QueryCondition[] => {
  const facet = SIZE_OPTIONS.find((option) => option.id === id);
  if (!facet) return [];

  const conditions: QueryCondition[] = [];
  if (facet.min !== undefined) conditions.push({ key: SIZE_KEY, op: "gte", value: facet.min });
  if (facet.max !== undefined) conditions.push({ key: SIZE_KEY, op: "lt", value: facet.max });
  return conditions;
};

// `in` arrays must be homogeneous per the schema; mixed picks degrade to strings
const homogeneous = (values: readonly FilterScalar[]): string[] | number[] | boolean[] => {
  if (values.every((v): v is number => typeof v === "number")) return [...values];
  if (values.every((v): v is boolean => typeof v === "boolean")) return [...values];
  return values.map(String);
};

const rowCondition = (row: ConditionDraft): QueryCondition | null => {
  const key = row.key.trim();
  if (key.length === 0) return null;
  if (row.op === "exists") return { key, op: "exists" };
  if (row.values.length === 0) return null;
  if (row.values.length > 1 || row.op === "in") {
    return { key, op: "in", value: homogeneous(row.values) };
  }
  return { key, op: row.op, value: row.values[0]! };
};

export const buildFilterWhere = (draft: FilterDraft): QueryCondition[] => [
  ...kindConditions(draft.kinds),
  ...sizeConditions(draft.size),
  ...draft.rows.map(rowCondition).filter((c): c is QueryCondition => c !== null),
];

const isScalar = (value: unknown): value is FilterScalar =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const matchKindCondition = (condition: QueryCondition): KindId[] | null => {
  if (condition.key !== CONTENT_TYPE_KEY) return null;
  if (condition.op === "contains" && typeof condition.value === "string") {
    const value = condition.value;
    const kind = KIND_OPTIONS.find(
      (option) => option.alternatives.length === 1 && option.alternatives[0] === value,
    );
    return kind ? [kind.id] : null;
  }
  if (condition.op === "in" && Array.isArray(condition.value)) {
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
  const values = joinOr(row.values.map(formatScalar));
  if (row.op === "eq" && row.values.length <= 1) return `${key} is ${values}`;
  if (row.values.length > 1 || row.op === "in") return `${key} is any of ${values}`;
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
