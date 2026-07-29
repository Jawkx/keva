import {
  Braces,
  List,
  LockKeyhole,
  Plus,
  Rows3,
  Save,
  Tag,
  TriangleAlert,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import type { PropertyValue, Properties } from "@keva/schema";
import {
  buildPropertyValue,
  diffProperties,
  inferPropertyValue,
  parsePropertiesJson,
  prettyJson,
  scalarToInput,
  type ValueType,
  validateKey,
  valueType,
} from "../lib/properties";
import { usePropertyKeys, usePropertyValues } from "../lib/use-property-suggestions";
import { SuggestInput } from "./SuggestInput";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type Mode = "rows" | "json";

export interface SystemField {
  key: string;
  value: ReactNode;
  title?: string | undefined;
}

export const propertyListClass = "divide-y divide-border overflow-hidden rounded-lg border";

const editTypeOf = valueType;

const TYPE_OPTS: { type: ValueType; label: string; icon: LucideIcon }[] = [
  { type: "tag", label: "Tag", icon: Tag },
  { type: "single", label: "Single value", icon: Type },
  { type: "multiple", label: "Multiple values", icon: List },
];
const typeMeta = (type: ValueType) => TYPE_OPTS.find((o) => o.type === type)!;

const GHOST_INPUT =
  "h-7 border-transparent bg-transparent px-1.5 shadow-none hover:border-input dark:bg-transparent";

interface PropertiesEditorProps {
  properties: Properties;
  systemRows: readonly SystemField[];
  onPatch: (set: Record<string, PropertyValue>, unset: string[]) => Promise<Properties>;
}

interface FieldProps {
  properties: Properties;
  systemRows: readonly SystemField[];
  busy: boolean;
  knownKeys: readonly string[];
  knownSet: ReadonlySet<string>;
  onSet: (key: string, value: PropertyValue) => Promise<Properties>;
  onUnset: (key: string) => Promise<Properties>;
}

export function PropertiesEditor({ properties, systemRows, onPatch }: PropertiesEditorProps) {
  const [mode, setMode] = useState<Mode>("rows");
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const jsonDirty = useRef(false);
  const knownKeys = usePropertyKeys();
  const knownSet = useMemo(() => new Set(knownKeys), [knownKeys]);

  const commit = async (set: Record<string, PropertyValue>, unset: string[]) => {
    setBusy(true);
    setSaveState("idle");
    try {
      const updated = await onPatch(set, unset);
      setSaveState("saved");
      return updated;
    } catch (error) {
      setSaveState("error");
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const field: FieldProps = {
    properties,
    systemRows,
    busy,
    knownKeys,
    knownSet,
    onSet: (key, value) => commit({ [key]: value }, []),
    onUnset: (key) => commit({}, [key]),
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Properties
        </h3>
        <div className="ml-auto text-xs text-muted-foreground" role="status" aria-live="polite">
          {busy
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : saveState === "error"
                ? "Save failed"
                : mode === "rows"
                  ? "Changes save automatically"
                  : ""}
        </div>
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[mode]}
          onValueChange={(value) => {
            const next = value[0] as Mode | undefined;
            if (!next || next === mode) return;
            if (jsonDirty.current && !window.confirm("Discard your unsaved JSON changes?")) return;
            jsonDirty.current = false;
            setMode(next);
          }}
          aria-label="Editor mode"
        >
          <ToggleGroupItem value="rows" title="Rows">
            <Rows3 />
          </ToggleGroupItem>
          <ToggleGroupItem value="json" title="JSON">
            <Braces />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {mode === "rows" ? (
        <RowsField {...field} />
      ) : (
        <JsonView
          {...field}
          commit={commit}
          onDirtyChange={(dirty) => {
            jsonDirty.current = dirty;
          }}
        />
      )}
    </div>
  );
}

function PropRow({
  icon,
  label,
  labelNode,
  labelTitle,
  mono,
  muted,
  action,
  children,
}: {
  icon: ReactNode;
  label?: string | undefined;
  labelNode?: ReactNode;
  labelTitle?: string | undefined;
  mono?: boolean;
  muted?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="group flex items-center gap-2 px-3 py-1.5">
      <span className="flex size-6 shrink-0 items-center justify-center">{icon}</span>
      {labelNode ?? (
        <span
          className={cn(
            "w-24 shrink-0 truncate text-sm",
            mono && "font-mono",
            muted && "text-muted-foreground",
          )}
          title={labelTitle ?? label}
        >
          {label}
        </span>
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">{children}</div>
      {action}
    </div>
  );
}

const systemRowNodes = (rows: readonly SystemField[]) =>
  rows.map((f) => (
    <PropRow
      key={`sys:${f.key}`}
      icon={
        <span title="System · read-only">
          <LockKeyhole className="size-3.5 text-muted-foreground" />
        </span>
      }
      label={f.key}
      labelTitle={f.title}
      muted
    >
      {f.value}
    </PropRow>
  ));

function RemoveButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Remove ${label}`}
      disabled={busy}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100 [&>svg]:size-4"
      onClick={onClick}
    >
      <X />
    </button>
  );
}

function TypeMenu({
  value,
  disabled,
  onChange,
}: {
  value: ValueType;
  disabled?: boolean | undefined;
  onChange: (type: ValueType) => void;
}) {
  const CurrentIcon = typeMeta(value).icon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            title={`${typeMeta(value).label} — change type`}
          />
        }
      >
        <CurrentIcon className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        {TYPE_OPTS.map(({ type, label, icon: Icon }) => (
          <DropdownMenuItem
            key={type}
            onClick={() => onChange(type)}
            className={cn(type === value && "bg-accent/60")}
          >
            <Icon />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SingleValue({
  draft,
  valueSuggestions,
  busy,
  autoFocus,
  onDraft,
  onCommit,
  onEnter,
}: {
  draft: string;
  valueSuggestions: readonly string[];
  busy: boolean;
  autoFocus?: boolean | undefined;
  onDraft: (draft: string) => void;
  onCommit?: ((draft: string) => void) | undefined;
  onEnter?: (() => void) | undefined;
}) {
  return (
    <SuggestInput
      value={draft}
      onValueChange={onDraft}
      onBlur={onCommit ? () => onCommit(draft) : undefined}
      onEnter={onEnter}
      suggestions={valueSuggestions}
      placeholder="value"
      className={GHOST_INPUT}
      autoFocus={autoFocus}
      disabled={busy}
    />
  );
}

function MultipleValues({
  values,
  suggestions,
  busy,
  onCommit,
}: {
  values: readonly string[];
  suggestions: readonly string[];
  busy: boolean;
  onCommit: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const next = draft.trim();
    if (!next || values.includes(next)) return;
    onCommit([...values, next]);
    setDraft("");
  };
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
      {values.map((value) => (
        <span key={value} className="flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5">
          <span>{value}</span>
          <button
            type="button"
            aria-label={`Remove value ${value}`}
            disabled={busy || values.length === 1}
            onClick={() => onCommit(values.filter((item) => item !== value))}
            className="text-muted-foreground hover:text-destructive disabled:opacity-40"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <SuggestInput
        value={draft}
        onValueChange={setDraft}
        onEnter={add}
        suggestions={suggestions.filter((item) => !values.includes(item))}
        placeholder="Add value"
        aria-label="Add property value"
        className={cn(GHOST_INPUT, "min-w-28 flex-1")}
        disabled={busy}
      />
    </div>
  );
}

function CustomRow({
  propKey,
  value,
  busy,
  known,
  onCommit,
  onRemove,
}: {
  propKey: string;
  value: PropertyValue;
  busy: boolean;
  known: boolean;
  onCommit: (value: PropertyValue) => Promise<Properties>;
  onRemove: () => void;
}) {
  const [type, setType] = useState<ValueType>(editTypeOf(value));
  const [draft, setDraft] = useState(scalarToInput(value));
  const [inputError, setInputError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(value);
  const valueSuggestions = usePropertyValues(propKey, known);
  const baselineChanged = JSON.stringify(baseline) !== JSON.stringify(value);
  const dirty = draft !== scalarToInput(baseline) || type !== editTypeOf(baseline);
  const conflict = dirty && baselineChanged;
  if (baselineChanged && !dirty) {
    setBaseline(value);
    setType(editTypeOf(value));
    setDraft(scalarToInput(value));
  }

  // Diff against the last value this row *sent*, not the `value` prop — the
  // prop lags the patch response, so rapid double-triggers (Enter then blur)
  // would pass a prop-based guard and double-send the same patch.
  const lastCommitted = useRef(value);

  const commitValue = (next: ReturnType<typeof buildPropertyValue>) => {
    if (!next.ok) {
      setInputError(next.error);
      return;
    }
    setInputError(null);
    if (JSON.stringify(next.value) === JSON.stringify(lastCommitted.current)) return;
    const rollback = lastCommitted.current;
    lastCommitted.current = next.value;
    onCommit(next.value)
      .then((updated) => {
        const authoritative = updated[propKey];
        if (authoritative === undefined) return;
        lastCommitted.current = authoritative;
        setBaseline(authoritative);
        setType(editTypeOf(authoritative));
        setDraft(scalarToInput(authoritative));
      })
      .catch(() => {
        lastCommitted.current = rollback;
      });
  };

  const overwrite = () => {
    setBaseline(value);
    lastCommitted.current = value;
    commitValue(buildPropertyValue(type, draft, Array.isArray(baseline) ? baseline : []));
  };

  return (
    <PropRow
      icon={
        <TypeMenu
          value={type}
          disabled={busy}
          onChange={(nextType) => {
            setType(nextType);
            const values = Array.isArray(value) ? value : value === null ? [] : [value];
            commitValue(buildPropertyValue(nextType, draft || values[0] || "", values));
          }}
        />
      }
      label={propKey}
      mono
      action={
        <>
          {conflict && (
            <Button variant="ghost" size="xs" disabled={busy} onClick={overwrite}>
              Keep mine
            </Button>
          )}
          <RemoveButton label={propKey} busy={busy} onClick={onRemove} />
        </>
      }
    >
      {type === "tag" ? (
        <span className="text-muted-foreground">Tag</span>
      ) : type === "multiple" ? (
        <MultipleValues
          values={Array.isArray(value) ? value : value === null ? [] : [value]}
          suggestions={valueSuggestions}
          busy={busy}
          onCommit={(values) => commitValue(buildPropertyValue("multiple", "", values))}
        />
      ) : (
        <SingleValue
          draft={draft}
          valueSuggestions={valueSuggestions}
          busy={busy}
          onDraft={setDraft}
          onCommit={(d) => commitValue(buildPropertyValue("single", d))}
        />
      )}
      {inputError && <span className="text-xs text-destructive">{inputError}</span>}
      {conflict && <span className="text-xs text-destructive">Changed elsewhere.</span>}
    </PropRow>
  );
}

function AddRow({
  busy,
  availableKeys,
  appliedKeys,
  knownSet,
  onAdd,
}: {
  busy: boolean;
  availableKeys: readonly string[];
  appliedKeys: ReadonlySet<string>;
  knownSet: ReadonlySet<string>;
  onAdd: (key: string, value: PropertyValue) => void;
}) {
  const [key, setKey] = useState("");
  const [draft, setDraft] = useState("");

  const trimmedKey = key.trim();
  const keyError = trimmedKey ? validateKey(trimmedKey) : null;
  const duplicate = appliedKeys.has(trimmedKey);
  const valueSuggestions = usePropertyValues(trimmedKey, knownSet.has(trimmedKey));
  const value = inferPropertyValue(draft);
  const type = value.ok ? valueType(value.value) : "tag";
  const Icon = typeMeta(type).icon;
  const canAdd = trimmedKey !== "" && !keyError && !duplicate && value.ok;

  const submit = () => {
    if (!canAdd) return;
    if (!value.ok) return;
    onAdd(trimmedKey, value.value);
    setKey("");
    setDraft("");
  };

  return (
    <PropRow
      icon={
        <span title={typeMeta(type).label}>
          <Icon className="size-4 text-muted-foreground" />
        </span>
      }
      labelNode={
        <div className="w-24 shrink-0">
          <SuggestInput
            value={key}
            onValueChange={setKey}
            suggestions={availableKeys}
            placeholder="new prop"
            className={cn(GHOST_INPUT, "font-mono")}
            invalid={!!keyError || duplicate}
            onEnter={submit}
            disabled={busy}
          />
        </div>
      }
      action={
        <button
          type="button"
          aria-label="Add property"
          title={
            keyError ??
            (duplicate ? "That key already exists" : value.ok ? "Add property" : value.error)
          }
          disabled={busy || !canAdd}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none disabled:opacity-40 [&>svg]:size-4"
          onClick={submit}
        >
          <Plus />
        </button>
      }
    >
      {trimmedKey && (
        <SingleValue
          draft={draft}
          valueSuggestions={valueSuggestions}
          busy={busy}
          onDraft={setDraft}
          onEnter={submit}
        />
      )}
      {!value.ok && <span className="text-xs text-destructive">{value.error}</span>}
    </PropRow>
  );
}

function RowsField({
  properties,
  systemRows,
  busy,
  knownKeys,
  knownSet,
  onSet,
  onUnset,
}: FieldProps) {
  const entries = Object.entries(properties);
  const appliedKeys = useMemo(() => new Set(Object.keys(properties)), [properties]);
  const availableKeys = useMemo(
    () => knownKeys.filter((key) => !appliedKeys.has(key)),
    [knownKeys, appliedKeys],
  );

  return (
    <div className={propertyListClass}>
      {systemRowNodes(systemRows)}
      {entries.map(([key, value]) => (
        <CustomRow
          key={key}
          propKey={key}
          value={value}
          busy={busy}
          known={knownSet.has(key)}
          onCommit={(next) => onSet(key, next)}
          onRemove={() => void onUnset(key)}
        />
      ))}
      <AddRow
        busy={busy}
        availableKeys={availableKeys}
        appliedKeys={appliedKeys}
        knownSet={knownSet}
        onAdd={(key, value) => void onSet(key, value)}
      />
    </div>
  );
}

function JsonView({
  properties,
  systemRows,
  busy,
  commit,
  onDirtyChange,
}: FieldProps & {
  commit: (set: Record<string, PropertyValue>, unset: string[]) => Promise<Properties>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const baseline = prettyJson(properties);
  const [draft, setDraft] = useState({ baseline, text: baseline });
  const dirty = draft.text !== draft.baseline;
  const conflict = dirty && draft.baseline !== baseline;
  if (!dirty && draft.baseline !== baseline) {
    setDraft({ baseline, text: baseline });
  }

  const parsed = useMemo(() => parsePropertiesJson(draft.text), [draft.text]);
  const diff = useMemo(
    () => (parsed.ok ? diffProperties(properties, parsed.value) : null),
    [parsed, properties],
  );
  const changeCount = diff ? Object.keys(diff.set).length + diff.unset.length : 0;
  const modified = draft.text !== baseline;

  const save = async () => {
    if (!parsed.ok || !diff || changeCount === 0 || conflict) return;
    const updated = await commit(diff.set, diff.unset);
    const nextBaseline = prettyJson(updated);
    setDraft({ baseline: nextBaseline, text: nextBaseline });
    onDirtyChange(false);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className={propertyListClass}>{systemRowNodes(systemRows)}</div>
      <Textarea
        spellCheck={false}
        autoComplete="off"
        value={draft.text}
        onChange={(e) => {
          const text = e.target.value;
          setDraft((current) => ({ ...current, text }));
          onDirtyChange(text !== draft.baseline);
        }}
        aria-invalid={!parsed.ok}
        className="min-h-56 resize-y font-mono text-xs leading-relaxed"
      />
      <div className="flex items-center justify-between gap-3">
        {conflict ? (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" />
            Server properties changed while you were editing.
          </p>
        ) : !parsed.ok ? (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" />
            <span className="truncate" title={parsed.error}>
              {parsed.error}
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {changeCount === 0
              ? "No pending changes"
              : `${changeCount} pending change${changeCount === 1 ? "" : "s"}`}
          </p>
        )}
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !modified}
            onClick={() => {
              setDraft({ baseline, text: baseline });
              onDirtyChange(false);
            }}
          >
            Discard
          </Button>
          {conflict && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setDraft((current) => ({ ...current, baseline }))}
            >
              Keep mine
            </Button>
          )}
          <Button
            size="sm"
            disabled={busy || conflict || !parsed.ok || changeCount === 0}
            onClick={() => void save()}
          >
            <Save data-icon="inline-start" />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
