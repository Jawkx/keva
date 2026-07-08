import { type ReactNode, useMemo, useState } from "react";
import {
  Add01Icon,
  Alert02Icon,
  BracesIcon,
  Cancel01Icon,
  FloppyDiskIcon,
  HashIcon,
  ListViewIcon,
  LockIcon,
  TableRowsSplitIcon,
  Tag01Icon,
  TextFontIcon,
  ToggleOnIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { PropertyValue, Properties } from "@keva/schema";
import {
  coerceScalar,
  diffProperties,
  parsePropertiesJson,
  prettyJson,
  scalarToInput,
  type ScalarType,
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
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type Mode = "rows" | "json";

export interface SystemField {
  key: string;
  value: ReactNode;
  title?: string | undefined;
}

export const propertyListClass = "divide-y divide-border overflow-hidden rounded-lg border";

const editTypeOf = (value: PropertyValue): ScalarType => {
  const type = valueType(value);
  return type === "array" ? "string" : type;
};

// Fold the type + draft string a control produced into a value to store. A blank
// text/number field is treated as a bare membership tag (null) so you never
// accidentally store an empty string.
const buildValue = (type: ScalarType, draft: string): PropertyValue => {
  if ((type === "string" || type === "number") && draft.trim() === "") return null;
  return coerceScalar(type, draft);
};

const TYPE_OPTS: { type: ScalarType; label: string; icon: IconSvgElement }[] = [
  { type: "null", label: "Bare tag", icon: Tag01Icon },
  { type: "string", label: "Text", icon: TextFontIcon },
  { type: "number", label: "Number", icon: HashIcon },
  { type: "boolean", label: "Boolean", icon: ToggleOnIcon },
];
const typeMeta = (type: ScalarType) => TYPE_OPTS.find((o) => o.type === type)!;

const GHOST_INPUT =
  "h-7 border-transparent bg-transparent px-1.5 shadow-none hover:border-input dark:bg-transparent";

interface PropertiesEditorProps {
  properties: Properties;
  systemRows: readonly SystemField[];
  onPatch: (set: Record<string, PropertyValue>, unset: string[]) => Promise<void>;
}

interface FieldProps {
  properties: Properties;
  systemRows: readonly SystemField[];
  busy: boolean;
  knownKeys: readonly string[];
  knownSet: ReadonlySet<string>;
  onSet: (key: string, value: PropertyValue) => Promise<void>;
  onUnset: (key: string) => Promise<void>;
}

export function PropertiesEditor({ properties, systemRows, onPatch }: PropertiesEditorProps) {
  const [mode, setMode] = useState<Mode>("rows");
  const [busy, setBusy] = useState(false);
  const knownKeys = usePropertyKeys();
  const knownSet = useMemo(() => new Set(knownKeys), [knownKeys]);

  const commit = async (set: Record<string, PropertyValue>, unset: string[]) => {
    setBusy(true);
    try {
      await onPatch(set, unset);
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
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[mode]}
          onValueChange={(value) => {
            const next = value[0] as Mode | undefined;
            if (next) setMode(next);
          }}
          aria-label="Editor mode"
        >
          <ToggleGroupItem value="rows" title="Rows">
            <HugeiconsIcon icon={TableRowsSplitIcon} />
          </ToggleGroupItem>
          <ToggleGroupItem value="json" title="JSON">
            <HugeiconsIcon icon={BracesIcon} />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {mode === "rows" ? <RowsField {...field} /> : <JsonView {...field} commit={commit} />}
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
          <HugeiconsIcon icon={LockIcon} className="size-3.5 text-muted-foreground" />
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
      <HugeiconsIcon icon={Cancel01Icon} />
    </button>
  );
}

function TypeMenu({
  value,
  disabled,
  onChange,
}: {
  value: ScalarType;
  disabled?: boolean | undefined;
  onChange: (type: ScalarType) => void;
}) {
  const currentIcon = typeMeta(value).icon;
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
        <HugeiconsIcon icon={currentIcon} className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        {TYPE_OPTS.map(({ type, label, icon }) => (
          <DropdownMenuItem
            key={type}
            onClick={() => onChange(type)}
            className={cn(type === value && "bg-accent/60")}
          >
            <HugeiconsIcon icon={icon} />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ScalarValue({
  type,
  draft,
  valueSuggestions,
  busy,
  autoFocus,
  onDraft,
  onCommit,
  onEnter,
}: {
  type: ScalarType;
  draft: string;
  valueSuggestions: readonly string[];
  busy: boolean;
  autoFocus?: boolean | undefined;
  onDraft: (draft: string) => void;
  onCommit?: ((draft: string) => void) | undefined;
  onEnter?: (() => void) | undefined;
}) {
  if (type === "null") return <span className="text-muted-foreground">—</span>;
  if (type === "boolean") {
    return (
      <Toggle
        variant="outline"
        size="sm"
        pressed={draft === "true"}
        disabled={busy}
        className="min-w-14 font-mono"
        onPressedChange={(pressed) => {
          const d = pressed ? "true" : "false";
          onDraft(d);
          onCommit?.(d);
        }}
      >
        {draft === "true" ? "true" : "false"}
      </Toggle>
    );
  }
  return (
    <SuggestInput
      value={draft}
      onValueChange={onDraft}
      onBlur={onCommit ? () => onCommit(draft) : undefined}
      onEnter={onEnter}
      suggestions={valueSuggestions}
      inputMode={type === "number" ? "decimal" : undefined}
      placeholder={type === "number" ? "0" : "value"}
      className={GHOST_INPUT}
      autoFocus={autoFocus}
      disabled={busy}
    />
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
  onCommit: (value: PropertyValue) => void;
  onRemove: () => void;
}) {
  const [type, setType] = useState<ScalarType>(editTypeOf(value));
  const [draft, setDraft] = useState(scalarToInput(value));
  const valueSuggestions = usePropertyValues(propKey, known);
  const isArray = Array.isArray(value);

  const commitScalar = (next: PropertyValue) => {
    if (next !== value) onCommit(next);
  };

  return (
    <PropRow
      icon={
        isArray ? (
          <HugeiconsIcon icon={ListViewIcon} className="size-3.5 text-muted-foreground" />
        ) : (
          <TypeMenu
            value={type}
            disabled={busy}
            onChange={(nextType) => {
              setType(nextType);
              commitScalar(buildValue(nextType, draft));
            }}
          />
        )
      }
      label={propKey}
      mono
      action={<RemoveButton label={propKey} busy={busy} onClick={onRemove} />}
    >
      {isArray ? (
        <span className="truncate font-mono text-muted-foreground" title={value.join(" | ")}>
          {value.join(" | ")}
        </span>
      ) : (
        <ScalarValue
          type={type}
          draft={draft}
          valueSuggestions={valueSuggestions}
          busy={busy}
          onDraft={setDraft}
          onCommit={(d) => commitScalar(buildValue(type, d))}
        />
      )}
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
  const [type, setType] = useState<ScalarType>("string");
  const [draft, setDraft] = useState("");

  const trimmedKey = key.trim();
  const keyError = trimmedKey ? validateKey(trimmedKey) : null;
  const duplicate = appliedKeys.has(trimmedKey);
  const valueSuggestions = usePropertyValues(trimmedKey, knownSet.has(trimmedKey));
  const canAdd = trimmedKey !== "" && !keyError && !duplicate;

  const submit = () => {
    if (!canAdd) return;
    onAdd(trimmedKey, buildValue(type, draft));
    setKey("");
    setType("string");
    setDraft("");
  };

  return (
    <PropRow
      icon={<TypeMenu value={type} disabled={busy} onChange={setType} />}
      labelNode={
        <div className="w-24 shrink-0">
          <SuggestInput
            value={key}
            onValueChange={setKey}
            suggestions={availableKeys}
            placeholder="new key"
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
          title={keyError ?? (duplicate ? "That key already exists" : "Add property")}
          disabled={busy || !canAdd}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none disabled:opacity-40 [&>svg]:size-4"
          onClick={submit}
        >
          <HugeiconsIcon icon={Add01Icon} />
        </button>
      }
    >
      <ScalarValue
        type={type}
        draft={draft}
        valueSuggestions={valueSuggestions}
        busy={busy}
        onDraft={setDraft}
        onEnter={submit}
      />
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
          onCommit={(next) => void onSet(key, next)}
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
}: FieldProps & {
  commit: (set: Record<string, PropertyValue>, unset: string[]) => Promise<void>;
}) {
  const baseline = prettyJson(properties);
  // Seeded once on mount; the view remounts whenever the mode switches back to
  // JSON, so it always opens in sync with the latest properties.
  const [text, setText] = useState(baseline);

  const parsed = useMemo(() => parsePropertiesJson(text), [text]);
  const diff = useMemo(
    () => (parsed.ok ? diffProperties(properties, parsed.value) : null),
    [parsed, properties],
  );
  const changeCount = diff ? Object.keys(diff.set).length + diff.unset.length : 0;
  const modified = text !== baseline;

  const save = async () => {
    if (!parsed.ok || !diff || changeCount === 0) return;
    await commit(diff.set, diff.unset);
    // Normalize to the saved item so dirty state clears once the prop catches
    // up — no effect needed.
    setText(prettyJson(parsed.value));
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className={propertyListClass}>{systemRowNodes(systemRows)}</div>
      <Textarea
        spellCheck={false}
        autoComplete="off"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={!parsed.ok}
        className="min-h-56 resize-y font-mono text-xs leading-relaxed"
      />
      <div className="flex items-center justify-between gap-3">
        {!parsed.ok ? (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-destructive">
            <HugeiconsIcon icon={Alert02Icon} className="size-3.5 shrink-0" />
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
            onClick={() => setText(baseline)}
          >
            Discard
          </Button>
          <Button
            size="sm"
            disabled={busy || !parsed.ok || changeCount === 0}
            onClick={() => void save()}
          >
            <HugeiconsIcon icon={FloppyDiskIcon} data-icon="inline-start" />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
