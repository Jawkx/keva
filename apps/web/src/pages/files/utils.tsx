import type { PropertyValue, QueryCondition } from "@keva/schema";
import { formatPropertyValue } from "../../lib/format";
import { Badge } from "@/components/ui/badge";
import type { KindId } from "../../lib/item-filters";
import type { FileRow } from "./file-columns";

export const propertyChipLabel = (key: string, value: PropertyValue): string => {
  if (value === null) return key;
  return `${key}:${formatPropertyValue(value)}`;
};

export function UploadPropertyBadges({
  entries,
}: {
  entries: readonly (readonly [string, PropertyValue])[];
}) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {entries.map(([key, value]) => (
        <Badge key={key} variant="secondary">
          {key}
          {value !== null && `: ${formatPropertyValue(value)}`}
        </Badge>
      ))}
    </div>
  );
}

export const PAGE_SIZE = 50;
export const QUICK_KINDS: ReadonlyArray<{ id: KindId | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "document", label: "Document" },
  { id: "image", label: "Photo" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
];
export const plural = (n: number) => (n === 1 ? "item" : "items");
export const extensionStart = (name: string): number => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name.length : dot;
};

const canonCondition = (c: QueryCondition) => JSON.stringify([c.key, c.op, c.value ?? null]);
export const sameConditions = (
  a: readonly QueryCondition[],
  b: readonly QueryCondition[],
): boolean =>
  a.length === b.length &&
  a.map(canonCondition).sort().join("|") === b.map(canonCondition).sort().join("|");

export const EMPTY_FILE_ROWS: FileRow[] = [];
