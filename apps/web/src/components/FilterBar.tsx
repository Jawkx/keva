import { Check, ListFilter, LockKeyhole, Plus, X } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import {
  Operator,
  QueryCondition as QueryConditionSchema,
  type PropertySummary,
  type PropertyValue,
  type QueryCondition,
} from "@keva/schema";
import { Schema } from "effect";
import { formatPropertyValue } from "../lib/format";
import {
  buildFilterWhere,
  createConditionDraft,
  FILTER_OPERATOR_LABELS,
  formatScalar,
  inferScalar,
  KIND_OPTIONS,
  opAllowsMultiple,
  opNeedsValue,
  operatorForValueCount,
  operatorsForKey,
  removeConditionDraft,
  SIZE_OPTIONS,
  updateConditionDraft,
  visibleOperator,
  type ConditionDraft,
  type FilterDraft,
  type FilterScalar,
  type KindId,
  type SizeFacetId,
} from "../lib/item-filters";
import { usePropertySummary, usePropertyValueScalars } from "../lib/use-property-suggestions";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function MenuRow({
  checked,
  highlighted,
  onHover,
  onSelect,
  children,
}: {
  checked?: boolean | undefined;
  highlighted?: boolean;
  onHover?: () => void;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none",
        highlighted
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent hover:text-accent-foreground",
      )}
      onMouseEnter={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      {checked !== undefined && (
        <span
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-sm border border-input",
            checked && "border-primary bg-primary text-primary-foreground",
          )}
        >
          {checked && <Check className="size-3" />}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

const listNavKeys = (
  count: number,
  active: number,
  setHighlight: (index: number) => void,
  pick: (index: number) => void,
) => {
  return (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight(Math.min(active + 1, count - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(Math.max(active - 1, 0));
    } else if (event.key === "Enter" && count > 0) {
      event.preventDefault();
      pick(active);
    }
  };
};

function KindMenu({
  selected,
  onToggle,
}: {
  selected: readonly KindId[];
  onToggle: (id: KindId) => void;
}) {
  return (
    <div className="flex flex-col">
      {KIND_OPTIONS.map((option) => (
        <MenuRow
          key={option.id}
          checked={selected.includes(option.id)}
          onSelect={() => onToggle(option.id)}
        >
          {option.label}
        </MenuRow>
      ))}
    </div>
  );
}

function SizeMenu({
  selected,
  onSelect,
}: {
  selected: SizeFacetId;
  onSelect: (id: SizeFacetId) => void;
}) {
  return (
    <div className="flex flex-col">
      {SIZE_OPTIONS.map((option) => (
        <MenuRow
          key={option.id}
          checked={option.id === selected}
          onSelect={() => onSelect(option.id)}
        >
          {option.label}
        </MenuRow>
      ))}
    </div>
  );
}

function ScalarValueMenu({
  keyName,
  values,
  multi,
  suggest,
  onChange,
  onDone,
}: {
  keyName: string;
  values: readonly FilterScalar[];
  multi: boolean;
  suggest: boolean;
  onChange: (values: FilterScalar[]) => void;
  onDone: () => void;
}) {
  const suggestions = usePropertyValueScalars(keyName, suggest);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const q = query.trim().toLowerCase();
  const visible = q
    ? suggestions.filter((s) => formatScalar(s).toLowerCase().includes(q))
    : suggestions;
  const selectedTokens = new Set(values.map(formatScalar));
  const trimmed = query.trim();
  const custom = trimmed.length > 0 && !visible.some((s) => formatScalar(s) === trimmed);
  const count = visible.length + (custom ? 1 : 0);
  const active = Math.min(highlight, Math.max(count - 1, 0));

  const toggle = (value: FilterScalar) => {
    const token = formatScalar(value);
    if (multi) {
      onChange(
        selectedTokens.has(token)
          ? values.filter((v) => formatScalar(v) !== token)
          : [...values, value],
      );
    } else {
      onChange([value]);
      onDone();
    }
  };

  const pick = (index: number) => {
    if (index < visible.length) toggle(visible[index]!);
    else if (custom) {
      toggle(inferScalar(trimmed, keyName));
      setQuery("");
    }
  };

  return (
    <div className="flex flex-col gap-1" onKeyDown={listNavKeys(count, active, setHighlight, pick)}>
      <Input
        autoFocus
        placeholder="Value…"
        aria-label="Filter value"
        className="h-8"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
      />
      <div className="flex max-h-64 flex-col overflow-y-auto">
        {visible.map((value, index) => (
          <MenuRow
            key={formatScalar(value)}
            checked={multi ? selectedTokens.has(formatScalar(value)) : undefined}
            highlighted={index === active}
            onHover={() => setHighlight(index)}
            onSelect={() => toggle(value)}
          >
            {formatScalar(value)}
          </MenuRow>
        ))}
        {custom && (
          <MenuRow
            highlighted={active === visible.length}
            onHover={() => setHighlight(visible.length)}
            onSelect={() => pick(visible.length)}
          >
            Use “{trimmed}”
          </MenuRow>
        )}
        {count === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">Type a value…</div>
        )}
      </div>
    </div>
  );
}

function TextValueMenu({
  keyName,
  value,
  onCommit,
}: {
  keyName: string;
  value: FilterScalar | undefined;
  onCommit: (value: FilterScalar) => void;
}) {
  const [text, setText] = useState(value === undefined ? "" : formatScalar(value));
  return (
    <div className="flex flex-col gap-1.5">
      <Input
        autoFocus
        placeholder="Value…"
        aria-label="Filter value"
        className="h-8"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && text.trim().length > 0) onCommit(inferScalar(text, keyName));
        }}
      />
      <p className="px-1 text-xs text-muted-foreground">Press Enter to apply</p>
    </div>
  );
}

const SEGMENT = "flex items-center gap-1 px-2 text-xs whitespace-nowrap";
const SEGMENT_BUTTON = cn(SEGMENT, "hover:bg-muted");

function Chip({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-7 shrink-0 items-stretch divide-x divide-border overflow-hidden rounded-md border bg-background">
      {children}
    </div>
  );
}

function RemoveSegment({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      className="flex items-center px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={onRemove}
    >
      <X className="size-3" />
    </button>
  );
}

function ValueSegment({
  open,
  onOpenChange,
  label,
  ariaLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label={ariaLabel}
        className={cn(SEGMENT_BUTTON, "max-w-48 font-medium", !label && "text-muted-foreground")}
      >
        <span className="truncate">{label || "select…"}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        {children}
      </PopoverContent>
    </Popover>
  );
}

const TEXT_INPUT_OPS: readonly Operator[] = ["gt", "gte", "lt", "lte"];

function RowChip({
  row,
  suggest,
  open,
  onOpenChange,
  onOpChange,
  operators,
  onValuesChange,
  onRemove,
}: {
  row: ConditionDraft;
  suggest: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpChange: (op: Operator) => void;
  operators: readonly Operator[];
  onValuesChange: (values: FilterScalar[], done?: boolean) => void;
  onRemove: () => void;
}) {
  const displayedOp = visibleOperator(row.op);
  const opLabel = FILTER_OPERATOR_LABELS[displayedOp];
  const valueLabel = row.values.map(formatScalar).join(", ");

  return (
    <Chip>
      <span className={cn(SEGMENT, "max-w-40 text-muted-foreground")}>
        <span className="truncate">{row.key}</span>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Change operator for ${row.key}`}
          className={cn(SEGMENT_BUTTON, "text-muted-foreground")}
        >
          {opLabel}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-40">
          {operators.map((op) => (
            <DropdownMenuItem key={op} onClick={() => onOpChange(op)}>
              <span className="flex-1">{FILTER_OPERATOR_LABELS[op]}</span>
              {op === displayedOp && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {opNeedsValue(row.op) && (
        <ValueSegment
          open={open}
          onOpenChange={onOpenChange}
          label={valueLabel}
          ariaLabel={`Change value for ${row.key}`}
        >
          {TEXT_INPUT_OPS.includes(row.op) ? (
            <TextValueMenu
              keyName={row.key}
              value={row.values[0]}
              onCommit={(value) => onValuesChange([value], true)}
            />
          ) : (
            <ScalarValueMenu
              keyName={row.key}
              values={row.values}
              multi={
                opAllowsMultiple(row.op) ||
                displayedOp === "has_value" ||
                displayedOp === "contains_text"
              }
              suggest={suggest}
              onChange={(values) => onValuesChange(values)}
              onDone={() => onOpenChange(false)}
            />
          )}
        </ValueSegment>
      )}
      <RemoveSegment label={`Remove filter on ${row.key}`} onRemove={onRemove} />
    </Chip>
  );
}

const kindLabel = (id: KindId): string => KIND_OPTIONS.find((o) => o.id === id)?.label ?? id;

// A key whose observed values are only bare nulls — a pure membership tag.
const isTagOnly = (entry: PropertySummary): boolean =>
  entry.kinds.length > 0 && entry.kinds.every((kind) => kind === "tag");

export interface PropertyStampChip {
  id: string;
  key: string;
  value: PropertyValue;
}

interface LockedPropertyStampChip {
  key: string;
  value: PropertyValue;
}

function CustomPropertyDialog({
  open,
  onOpenChange,
  keyOptions,
  lockedKeys,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyOptions: string[];
  lockedKeys: ReadonlySet<string>;
  onAdd: (key: string, value: PropertyValue) => void;
}) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const trimmedKey = key.trim();
  const suggestions = usePropertyValueScalars(trimmedKey, open && keyOptions.includes(trimmedKey));
  const valueOptions = useMemo(() => suggestions.map(formatScalar), [suggestions]);
  const canAdd = trimmedKey.length > 0 && value.trim().length > 0 && !lockedKeys.has(trimmedKey);

  const submit = () => {
    if (!canAdd) return;
    onAdd(trimmedKey, value.trim());
    onOpenChange(false);
    setKey("");
    setValue("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add upload property</DialogTitle>
          <DialogDescription>
            Choose a property and value to stamp on every upload through this share.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Combobox
            aria-label="Upload property key"
            placeholder="key"
            options={keyOptions}
            emptyText="No matching keys"
            value={key}
            onValueChange={setKey}
          />
          <Combobox
            aria-label="Upload property value"
            placeholder="value"
            options={valueOptions}
            emptyText="No matching values"
            value={value}
            onValueChange={setValue}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canAdd} onClick={submit}>
            Add property
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PropertyStampChips({
  locked,
  value,
  onChange,
}: {
  locked: readonly LockedPropertyStampChip[];
  value: readonly PropertyStampChip[];
  onChange: (value: PropertyStampChip[]) => void;
}) {
  const summary = usePropertySummary();
  const keySet = useMemo(() => new Set(summary.map((entry) => entry.key)), [summary]);
  const lockedKeys = new Set(locked.map((row) => row.key));
  const available = summary.filter((entry) => !lockedKeys.has(entry.key));
  const [valueMenuFor, setValueMenuFor] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);

  const upsert = (key: string, nextValue: PropertyValue) => {
    if (lockedKeys.has(key)) return;
    const existing = value.find((row) => row.key === key);
    onChange(
      existing
        ? value.map((row) => (row.id === existing.id ? { ...row, value: nextValue } : row))
        : [...value, { id: `stamp:${crypto.randomUUID()}`, key, value: nextValue }],
    );
  };

  const toggleTag = (key: string) => {
    const existing = value.find((row) => row.key === key);
    if (existing?.value === null) {
      onChange(value.filter((row) => row.id !== existing.id));
      return;
    }
    upsert(key, null);
  };

  const toggle = (key: string, nextValue: string) => {
    const existing = value.find((row) => row.key === key);
    if (!existing || existing.value === null) {
      upsert(key, nextValue);
      return;
    }
    const current = Array.isArray(existing.value) ? [...existing.value] : [existing.value];
    const next = current.includes(nextValue)
      ? current.filter((item) => item !== nextValue)
      : [...current, nextValue];
    if (next.length === 0) onChange(value.filter((row) => row.id !== existing.id));
    else upsert(key, next.length === 1 ? next[0]! : next);
  };

  return (
    <>
      {locked.map((row) => (
        <Chip key={row.key}>
          <span className={cn(SEGMENT, "max-w-40 text-muted-foreground")}>
            <span className="truncate">{row.key}</span>
          </span>
          <span className={cn(SEGMENT, "text-muted-foreground")}>is</span>
          <span className={cn(SEGMENT, "max-w-48 font-medium")}>
            <span className="truncate">{formatPropertyValue(row.value)}</span>
          </span>
          <span
            className="flex items-center px-2 text-muted-foreground"
            title="Fixed by current view"
            aria-label={`${row.key} is fixed by current view`}
          >
            <LockKeyhole className="size-3" />
          </span>
        </Chip>
      ))}

      {value.map((row) => (
        <Chip key={row.id}>
          <span className={cn(SEGMENT, "max-w-40 text-muted-foreground")}>
            <span className="truncate">{row.key}</span>
          </span>
          <span className={cn(SEGMENT, "text-muted-foreground")}>is</span>
          <ValueSegment
            open={valueMenuFor === row.id}
            onOpenChange={(open) => setValueMenuFor(open ? row.id : null)}
            label={formatPropertyValue(row.value)}
            ariaLabel={`Change upload value for ${row.key}`}
          >
            <ScalarValueMenu
              keyName={row.key}
              values={Schema.is(Schema.String)(row.value) ? [row.value] : []}
              multi={false}
              suggest={keySet.has(row.key)}
              onChange={(values) => {
                const next = values[0];
                if (next !== undefined) upsert(row.key, String(next));
              }}
              onDone={() => setValueMenuFor(null)}
            />
          </ValueSegment>
          <RemoveSegment
            label={`Remove upload property ${row.key}`}
            onRemove={() => onChange(value.filter((candidate) => candidate.id !== row.id))}
          />
        </Chip>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-sm" aria-label="Add upload property" />}
        >
          <Plus className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Properties</DropdownMenuLabel>
            {available.length > 0 ? (
              available.map((entry) => (
                <DropdownMenuSub key={entry.key}>
                  <DropdownMenuSubTrigger>{entry.key}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-80 w-44 overflow-y-auto">
                    {entry.kinds.includes("tag") && (
                      <DropdownMenuCheckboxItem
                        checked={value.some((row) => row.key === entry.key && row.value === null)}
                        closeOnClick={false}
                        onCheckedChange={() => toggleTag(entry.key)}
                      >
                        Tag
                      </DropdownMenuCheckboxItem>
                    )}
                    {entry.values.map((option) => {
                      const selected = value.some(
                        (row) =>
                          row.key === entry.key &&
                          (row.value === option ||
                            (Array.isArray(row.value) && row.value.includes(option))),
                      );
                      return (
                        <DropdownMenuCheckboxItem
                          key={formatScalar(option)}
                          checked={selected}
                          closeOnClick={false}
                          onCheckedChange={() => toggle(entry.key, option)}
                        >
                          {formatScalar(option)}
                        </DropdownMenuCheckboxItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))
            ) : (
              <DropdownMenuItem disabled>No available properties</DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setCustomOpen(true)}>Advanced…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CustomPropertyDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        keyOptions={[...keySet].filter((key) => !lockedKeys.has(key))}
        lockedKeys={lockedKeys}
        onAdd={upsert}
      />
    </>
  );
}

function AdvancedConditionDialog({
  open,
  onOpenChange,
  keyOptions,
  summary,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keyOptions: string[];
  summary: readonly PropertySummary[];
  onAdd: (row: ConditionDraft) => void;
}) {
  const [key, setKey] = useState("");
  const [op, setOp] = useState<Operator>("has_value");
  const [value, setValue] = useState("");

  const trimmedKey = key.trim();
  const kinds = summary.find((entry) => entry.key === trimmedKey)?.kinds;
  const suggestions = usePropertyValueScalars(
    trimmedKey,
    open && opNeedsValue(op) && keyOptions.includes(trimmedKey),
  );
  const valueOptions = useMemo(() => suggestions.map(formatScalar), [suggestions]);
  const draftCondition = trimmedKey
    ? buildFilterWhere({
        kinds: [],
        size: "any",
        rows: [
          createConditionDraft(
            trimmedKey,
            op,
            opNeedsValue(op) ? [inferScalar(value, trimmedKey)] : [],
          ),
        ],
      })[0]
    : undefined;
  const validationError = !trimmedKey
    ? "Enter a key"
    : opNeedsValue(op) && !value.trim()
      ? "Enter a value"
      : !draftCondition || !Schema.is(QueryConditionSchema)(draftCondition)
        ? "This operator and value are not valid for the selected key"
        : null;
  const canAdd = validationError === null;

  const submit = () => {
    if (!canAdd) return;
    onAdd(
      createConditionDraft(
        trimmedKey,
        op,
        opNeedsValue(op) ? [inferScalar(value, trimmedKey)] : [],
      ),
    );
    onOpenChange(false);
    setKey("");
    setOp("has_value");
    setValue("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Advanced filter</DialogTitle>
          <DialogDescription>
            Filter by any key and operator, including values that don’t exist yet or{" "}
            <code className="font-mono">system.*</code> fields.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel>Key</FieldLabel>
            <Combobox
              aria-label="Condition key"
              placeholder="key"
              options={keyOptions}
              emptyText="No matching keys"
              value={key}
              onValueChange={(nextKey) => {
                setKey(nextKey);
                const nextKinds = summary.find((entry) => entry.key === nextKey.trim())?.kinds;
                const allowed = operatorsForKey(nextKey.trim(), nextKinds);
                if (!allowed.includes(op)) setOp(allowed[0] ?? "has_value");
              }}
            />
          </Field>
          <Field>
            <FieldLabel>Operator</FieldLabel>
            <Select
              value={op}
              onValueChange={(next) => {
                if (Schema.is(Operator)(next)) setOp(next);
              }}
            >
              <SelectTrigger aria-label="Condition operator">
                <SelectValue>{(current: Operator) => FILTER_OPERATOR_LABELS[current]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {operatorsForKey(trimmedKey, kinds).map((option) => (
                    <SelectItem key={option} value={option}>
                      {FILTER_OPERATOR_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {opNeedsValue(op) && (
            <Field data-invalid={Boolean(validationError && value.trim())}>
              <FieldLabel>Value</FieldLabel>
              <Combobox
                aria-label="Condition value"
                placeholder="value"
                options={valueOptions}
                emptyText="No matching values"
                value={value}
                onValueChange={setValue}
              />
            </Field>
          )}
          {validationError && trimmedKey && (
            <FieldDescription className="text-destructive">{validationError}</FieldDescription>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canAdd} onClick={submit}>
            Add filter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface FilterMenuProps {
  draft: FilterDraft;
  onDraftChange: (draft: FilterDraft) => void;
  onApply: (where: QueryCondition[]) => void;
}

function FilterMenu({
  draft,
  onDraftChange,
  onApply,
  trigger,
  triggerContent,
}: FilterMenuProps & { trigger: ReactElement; triggerContent: ReactNode }) {
  const summary = usePropertySummary();
  const keySet = useMemo(() => new Set(summary.map((entry) => entry.key)), [summary]);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const commit = (next: FilterDraft) => {
    onDraftChange(next);
    onApply(buildFilterWhere(next));
  };

  const toggleKind = (id: KindId) =>
    commit({
      ...draft,
      kinds: draft.kinds.includes(id)
        ? draft.kinds.filter((kind) => kind !== id)
        : [...draft.kinds, id],
    });

  const existsRow = (key: string) =>
    draft.rows.find((r) => r.key === key && (r.op === "exists" || r.op === "is_tag"));

  const toggleExists = (key: string, tagOnly = false) => {
    const row = existsRow(key);
    commit(
      row
        ? removeConditionDraft(draft, row.id)
        : {
            ...draft,
            rows: [...draft.rows, createConditionDraft(key, tagOnly ? "is_tag" : "exists", [])],
          },
    );
  };

  // The row a value toggle operates on: scalar/array membership for the key.
  const valueRow = (key: string) =>
    draft.rows.find((r) => r.key === key && (r.op === "has_value" || r.op === "has_any"));

  const valueSelected = (key: string, value: FilterScalar) =>
    valueRow(key)?.values.some((v) => formatScalar(v) === formatScalar(value)) ?? false;

  const toggleValue = (key: string, value: FilterScalar) => {
    const row = valueRow(key);
    if (!row) {
      commit({ ...draft, rows: [...draft.rows, createConditionDraft(key, "has_value", [value])] });
      return;
    }
    const token = formatScalar(value);
    const values = row.values.some((v) => formatScalar(v) === token)
      ? row.values.filter((v) => formatScalar(v) !== token)
      : [...row.values, value];
    commit(
      values.length === 0
        ? removeConditionDraft(draft, row.id)
        : updateConditionDraft(draft, row.id, { values }),
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger}>{triggerContent}</DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Kind</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              {KIND_OPTIONS.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.id}
                  checked={draft.kinds.includes(option.id)}
                  closeOnClick={false}
                  onCheckedChange={() => toggleKind(option.id)}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Size</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-40">
              {SIZE_OPTIONS.filter((option) => option.id !== "any").map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.id}
                  checked={draft.size === option.id}
                  onCheckedChange={() =>
                    commit({ ...draft, size: draft.size === option.id ? "any" : option.id })
                  }
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {summary.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Properties</DropdownMenuLabel>
              {summary.map((entry) =>
                isTagOnly(entry) ? (
                  <DropdownMenuCheckboxItem
                    key={entry.key}
                    checked={Boolean(existsRow(entry.key))}
                    closeOnClick={false}
                    onCheckedChange={() => toggleExists(entry.key, true)}
                  >
                    {entry.key}
                  </DropdownMenuCheckboxItem>
                ) : (
                  <DropdownMenuSub key={entry.key}>
                    <DropdownMenuSubTrigger>{entry.key}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-80 w-44 overflow-y-auto">
                      <DropdownMenuCheckboxItem
                        checked={Boolean(existsRow(entry.key))}
                        closeOnClick={false}
                        onCheckedChange={() => toggleExists(entry.key)}
                      >
                        Any value
                      </DropdownMenuCheckboxItem>
                      {entry.values.length > 0 && <DropdownMenuSeparator />}
                      {entry.values.map((value) => (
                        <DropdownMenuCheckboxItem
                          key={formatScalar(value)}
                          checked={valueSelected(entry.key, value)}
                          closeOnClick={false}
                          onCheckedChange={() => toggleValue(entry.key, value)}
                        >
                          {formatScalar(value)}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ),
              )}
            </DropdownMenuGroup>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAdvancedOpen(true)}>Advanced…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AdvancedConditionDialog
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        keyOptions={[...keySet]}
        summary={summary}
        onAdd={(row) => commit({ ...draft, rows: [...draft.rows, row] })}
      />
    </>
  );
}

export function FilterMenuButton({
  className,
  ...props
}: FilterMenuProps & { className?: string }) {
  return (
    <FilterMenu
      {...props}
      trigger={<Button variant="outline" className={className} />}
      triggerContent={
        <>
          <ListFilter data-icon="inline-start" />
          Filter
        </>
      }
    />
  );
}

export interface FilterBarProps {
  draft: FilterDraft;
  onDraftChange: (draft: FilterDraft) => void;
  onApply: (where: QueryCondition[]) => void;
  onClear: () => void;
}

export function FilterBar({ draft, onDraftChange, onApply, onClear }: FilterBarProps) {
  const summary = usePropertySummary();
  const keySet = useMemo(() => new Set(summary.map((entry) => entry.key)), [summary]);
  const [valueMenuFor, setValueMenuFor] = useState<string | null>(null);

  const commit = (next: FilterDraft) => {
    onDraftChange(next);
    onApply(buildFilterWhere(next));
  };

  const where = useMemo(() => buildFilterWhere(draft), [draft]);
  const showKindChip = draft.kinds.length > 0;
  const showSizeChip = draft.size !== "any";

  const dropIfEmpty = (rowId: string) => {
    const row = draft.rows.find((r) => r.id === rowId);
    if (row && opNeedsValue(row.op) && row.values.length === 0) {
      onDraftChange(removeConditionDraft(draft, rowId));
    }
  };

  const closeValueMenu = (id: string) => {
    setValueMenuFor((current) => (current === id ? null : current));
    if (id !== "kind" && id !== "size") dropIfEmpty(id);
  };

  const valueMenuChange = (id: string) => (open: boolean) => {
    if (open) setValueMenuFor(id);
    else closeValueMenu(id);
  };

  const changeRowOp = (row: ConditionDraft, op: Operator) => {
    if (op === row.op) return;
    let values = row.values;
    if (!opNeedsValue(op)) values = [];
    else if (
      !opAllowsMultiple(op) &&
      op !== "has_value" &&
      op !== "contains_text" &&
      values.length > 1
    )
      values = values.slice(0, 1);
    const storedOp = operatorForValueCount(op, values.length);
    commit(updateConditionDraft(draft, row.id, { op: storedOp, values }));
    if (opNeedsValue(op) && values.length === 0) setValueMenuFor(row.id);
  };

  return (
    <>
      {showKindChip && (
        <Chip>
          <span className={cn(SEGMENT, "text-muted-foreground")}>Kind</span>
          <span className={cn(SEGMENT, "text-muted-foreground")}>
            {draft.kinds.length > 1 ? "is any of" : "is"}
          </span>
          <ValueSegment
            open={valueMenuFor === "kind"}
            onOpenChange={valueMenuChange("kind")}
            label={draft.kinds.map(kindLabel).join(", ")}
            ariaLabel="Change kind filter"
          >
            <KindMenu
              selected={draft.kinds}
              onToggle={(id) =>
                commit({
                  ...draft,
                  kinds: draft.kinds.includes(id)
                    ? draft.kinds.filter((k) => k !== id)
                    : [...draft.kinds, id],
                })
              }
            />
          </ValueSegment>
          <RemoveSegment
            label="Remove kind filter"
            onRemove={() => commit({ ...draft, kinds: [] })}
          />
        </Chip>
      )}

      {showSizeChip && (
        <Chip>
          <span className={cn(SEGMENT, "text-muted-foreground")}>Size</span>
          <span className={cn(SEGMENT, "text-muted-foreground")}>is</span>
          <ValueSegment
            open={valueMenuFor === "size"}
            onOpenChange={valueMenuChange("size")}
            label={
              draft.size === "any"
                ? ""
                : (SIZE_OPTIONS.find((o) => o.id === draft.size)?.label ?? draft.size)
            }
            ariaLabel="Change size filter"
          >
            <SizeMenu
              selected={draft.size}
              onSelect={(id) => {
                commit({ ...draft, size: id });
                setValueMenuFor(null);
              }}
            />
          </ValueSegment>
          <RemoveSegment
            label="Remove size filter"
            onRemove={() => commit({ ...draft, size: "any" })}
          />
        </Chip>
      )}

      {draft.rows.map((row) =>
        row.values.length > 0 || !opNeedsValue(row.op) || valueMenuFor === row.id ? (
          <RowChip
            key={row.id}
            row={row}
            suggest={keySet.has(row.key)}
            open={valueMenuFor === row.id}
            onOpenChange={valueMenuChange(row.id)}
            onOpChange={(op) => changeRowOp(row, op)}
            operators={operatorsForKey(
              row.key,
              summary.find((entry) => entry.key === row.key)?.kinds,
            )}
            onValuesChange={(values, done) => {
              commit(
                updateConditionDraft(draft, row.id, {
                  op: operatorForValueCount(row.op, values.length),
                  values,
                }),
              );
              if (done) setValueMenuFor(null);
            }}
            onRemove={() => commit(removeConditionDraft(draft, row.id))}
          />
        ) : null,
      )}

      <FilterMenu
        draft={draft}
        onDraftChange={onDraftChange}
        onApply={onApply}
        trigger={<Button variant="ghost" size="icon-sm" aria-label="Add filter" />}
        triggerContent={<Plus className="size-3.5" />}
      />
      {where.length > 0 && (
        <Button variant="ghost" size="sm" onClick={onClear}>
          Clear
        </Button>
      )}
    </>
  );
}
