import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IconCode, IconPlus, IconX } from "@tabler/icons-react";
import type { Operator, QueryCondition } from "@keva/schema";
import { CodeBlock } from "./CodeBlock";
import {
  addConditionDraft,
  buildFilterWhere,
  FILTER_OPERATOR_LABELS,
  FILTER_OPERATORS,
  FILTER_VALUE_TYPES,
  KIND_FACETS,
  removeConditionDraft,
  SIZE_FACETS,
  updateConditionDraft,
  type ConditionDraft,
  type ConditionDraftPatch,
  type FacetOption,
  type FilterDraft,
  type FilterValueType,
  type KindFacetId,
  type SizeFacetId,
} from "../lib/item-filters";
import { usePropertyKeys, usePropertyValues } from "../lib/use-property-suggestions";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface QuerySnippets {
  curl: string;
  sdk: string;
}

function buildQuerySnippets(
  baseUrl: string,
  search: string,
  where: QueryCondition[],
): QuerySnippets {
  const trimmed = search.trim();
  const query = { where, ...(trimmed ? { search: trimmed } : {}), limit: 100 };
  const curl = `curl -X POST ${baseUrl}/query \\
  -H "Authorization: Bearer $KEVA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(query)}'`;
  const sdk = `import { KevaClient } from "@keva/sdk";

const keva = new KevaClient({
  baseUrl: "${baseUrl}",
  token: process.env.KEVA_TOKEN,
});

const { items } = await keva.query(${JSON.stringify(query, null, 2)});`;
  return { curl, sdk };
}

function FacetChips<Id extends string>({
  facets,
  selected,
  onSelect,
}: {
  facets: readonly FacetOption<Id>[];
  selected: Id;
  onSelect: (id: Id) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {facets.map((facet) => (
        <Button
          key={facet.id}
          type="button"
          size="sm"
          variant={facet.id === selected ? "default" : "outline"}
          onClick={() => onSelect(facet.id)}
        >
          {facet.label}
        </Button>
      ))}
    </div>
  );
}

function ConditionRow({
  row,
  keyOptions,
  onUpdate,
  onRemove,
}: {
  row: ConditionDraft;
  keyOptions: string[];
  onUpdate: (patch: ConditionDraftPatch) => void;
  onRemove: () => void;
}) {
  // Only fetch value suggestions once the key names a known property and the
  // condition actually takes a scalar value (booleans use a fixed dropdown).
  const trimmedKey = row.key.trim();
  const valuesEnabled =
    row.op !== "exists" && row.valueType !== "boolean" && keyOptions.includes(trimmedKey);
  const valueOptions = usePropertyValues(trimmedKey, valuesEnabled);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Combobox
        aria-label="Condition key"
        placeholder="key"
        className="w-44"
        options={keyOptions}
        emptyText="No matching keys"
        value={row.key}
        onValueChange={(next) => onUpdate({ key: next })}
      />
      <Select value={row.op} onValueChange={(next) => onUpdate({ op: next as Operator })}>
        <SelectTrigger className="w-40">
          <SelectValue>{(op: Operator) => FILTER_OPERATOR_LABELS[op]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {FILTER_OPERATORS.map((op) => (
              <SelectItem key={op} value={op}>
                {FILTER_OPERATOR_LABELS[op]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {row.op === "exists" ? (
        <span className="text-sm text-muted-foreground">(no value)</span>
      ) : (
        <>
          <Select
            value={row.valueType}
            onValueChange={(next) => onUpdate({ valueType: next as FilterValueType })}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {FILTER_VALUE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {row.valueType === "boolean" ? (
            <Select
              value={row.value || "true"}
              onValueChange={(next) => onUpdate({ value: String(next) })}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="true">true</SelectItem>
                  <SelectItem value="false">false</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <Combobox
              aria-label="Condition value"
              placeholder="value"
              className="w-44"
              options={valueOptions}
              emptyText="No matching values"
              type={row.valueType === "number" ? "number" : "text"}
              inputMode={row.valueType === "number" ? "decimal" : undefined}
              value={row.value}
              onValueChange={(next) => onUpdate({ value: next })}
            />
          )}
        </>
      )}

      <Button size="icon" variant="ghost" aria-label="Remove condition" onClick={onRemove}>
        <IconX />
      </Button>
    </div>
  );
}

function ApiGuide({ snippets }: { snippets: QuerySnippets }) {
  return (
    <div className="flex flex-col gap-4">
      <CodeBlock label="curl" code={snippets.curl} />
      <CodeBlock label="TypeScript SDK" code={snippets.sdk} />
      <p className="text-sm text-muted-foreground">
        Generate a token on the{" "}
        <Link to="/connection" className="text-primary hover:underline">
          Connection
        </Link>{" "}
        page and export it as <code className="font-mono">KEVA_TOKEN</code>.
      </p>
    </div>
  );
}

interface FilterPanelProps {
  open: boolean;
  search: string;
  draft: FilterDraft;
  onDraftChange: (draft: FilterDraft) => void;
  onApply: (where: QueryCondition[]) => void;
  onClear: () => void;
  onClose: () => void;
}

export function FilterPanel({
  open,
  search,
  draft,
  onDraftChange,
  onApply,
  onClear,
  onClose,
}: FilterPanelProps) {
  const [showApi, setShowApi] = useState(false);
  const keyOptions = usePropertyKeys();

  const where = useMemo(() => buildFilterWhere(draft), [draft]);
  const snippets = useMemo(
    () => buildQuerySnippets(`${window.location.origin}/api`, search, where),
    [search, where],
  );

  const updateRow = (id: string, patch: ConditionDraftPatch) => {
    onDraftChange(updateConditionDraft(draft, id, patch));
  };

  const selectKind = (kind: KindFacetId) => {
    const nextDraft = { ...draft, kind };
    onDraftChange(nextDraft);
    onApply(buildFilterWhere(nextDraft));
  };

  const selectSize = (size: SizeFacetId) => {
    const nextDraft = { ...draft, size };
    onDraftChange(nextDraft);
    onApply(buildFilterWhere(nextDraft));
  };

  const close = () => {
    setShowApi(false);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="mx-3 mb-2 flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={showApi ? "outline" : "default"}
            onClick={() => setShowApi(false)}
          >
            Filters
          </Button>
          <Button
            size="sm"
            variant={showApi ? "default" : "outline"}
            onClick={() => setShowApi(true)}
          >
            <IconCode data-icon="inline-start" />
            API
          </Button>
        </div>
        <Button size="icon" variant="ghost" aria-label="Close filters" onClick={close}>
          <IconX />
        </Button>
      </div>

      {showApi ? (
        <ApiGuide snippets={snippets} />
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Kind</span>
            <FacetChips facets={KIND_FACETS} selected={draft.kind} onSelect={selectKind} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Size</span>
            <FacetChips facets={SIZE_FACETS} selected={draft.size} onSelect={selectSize} />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Conditions</span>
            <p className="text-xs text-muted-foreground">
              Keys can be a bare property name, <code className="font-mono">name</code>, or{" "}
              <code className="font-mono">system.&lt;field&gt;</code> (e.g.{" "}
              <code className="font-mono">system.content_type</code>,{" "}
              <code className="font-mono">system.size</code>).
            </p>
            {draft.rows.map((row) => (
              <ConditionRow
                key={row.id}
                row={row}
                keyOptions={keyOptions}
                onUpdate={(patch) => updateRow(row.id, patch)}
                onRemove={() => onDraftChange(removeConditionDraft(draft, row.id))}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => onDraftChange(addConditionDraft(draft))}>
              <IconPlus data-icon="inline-start" />
              Add condition
            </Button>
            {where.length > 0 && (
              <Button variant="ghost" className="ml-auto" onClick={onClear}>
                Clear
              </Button>
            )}
            <Button
              className={where.length > 0 ? undefined : "ml-auto"}
              onClick={() => onApply(where)}
            >
              Apply
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
