import type { Operator, QueryCondition } from "@keva/schema";
import { formatPropertyValue } from "../lib/format";
import { Badge } from "@/components/ui/badge";

const OP_SYMBOL: Record<Operator, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  contains: "∋",
  in: "∈",
  exists: "",
};

export const formatCondition = (condition: QueryCondition): string => {
  if (condition.op === "exists") return `${condition.key} exists`;
  const value = condition.value === undefined ? "" : formatPropertyValue(condition.value);
  return `${condition.key} ${OP_SYMBOL[condition.op]} ${value}`;
};

// Renders a grant's conditions as compact chips, for the share dialog preview
// and the management table. Empty conditions mean the share is unfiltered.
export function ConditionChips({ conditions }: { conditions: readonly QueryCondition[] }) {
  if (conditions.length === 0) {
    return <span className="text-sm text-muted-foreground">All files</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {conditions.map((condition, index) => (
        <Badge key={`${condition.key}-${condition.op}-${index}`} variant="secondary">
          {formatCondition(condition)}
        </Badge>
      ))}
    </div>
  );
}
