import { useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconBraces,
  IconCheck,
  IconCircleOff,
  IconDeviceFloppy,
  IconLetterCase,
  IconListDetails,
  IconNumber123,
  IconPlus,
  IconToggleLeft,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import type { PropertyValue, Properties } from "@keva/schema";
import { formatPropertyValue } from "../lib/format";
import {
  coerceScalar,
  diffProperties,
  inferScalarType,
  parsePropertiesJson,
  prettyJson,
  scalarToInput,
  SCALAR_TYPES,
  TYPE_LABEL,
  validateKey,
  valueType,
  type ScalarType,
  type ValueType,
} from "../lib/properties";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

type Mode = "form" | "json";

interface PropertiesEditorProps {
  properties: Properties;
  onPatch: (
    set: Record<string, PropertyValue>,
    unset: string[],
  ) => Promise<void>;
}

// Two views over the same properties: a Form view that commits each change
// immediately, and a JSON view that batches a hand-edited item into one
// patch. They share nothing but the `properties` prop, so flipping between
// them is always lossless.
export function PropertiesEditor({
  properties,
  onPatch,
}: PropertiesEditorProps) {
  const [mode, setMode] = useState<Mode>("form");
  const [busy, setBusy] = useState(false);

  const entries = Object.entries(properties);

  const commit = async (
    set: Record<string, PropertyValue>,
    unset: string[],
  ) => {
    setBusy(true);
    try {
      await onPatch(set, unset);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs tabular-nums text-muted-foreground">
          {entries.length} {entries.length === 1 ? "property" : "properties"}
        </span>
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
          <ToggleGroupItem value="form">
            <IconListDetails data-icon="inline-start" />
            Form
          </ToggleGroupItem>
          <ToggleGroupItem value="json">
            <IconBraces data-icon="inline-start" />
            JSON
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {mode === "form" ? (
        <FormView
          properties={properties}
          busy={busy}
          onSet={(key, value) => commit({ [key]: value }, [])}
          onUnset={(key) => commit({}, [key])}
        />
      ) : (
        <JsonView properties={properties} busy={busy} commit={commit} />
      )}
    </div>
  );
}

/* ------------------------------- Form view ------------------------------- */

function FormView({
  properties,
  busy,
  onSet,
  onUnset,
}: {
  properties: Properties;
  busy: boolean;
  onSet: (key: string, value: PropertyValue) => Promise<void>;
  onUnset: (key: string) => Promise<void>;
}) {
  const entries = Object.entries(properties);

  return (
    <div className="flex flex-col gap-1">
      {entries.length === 0 ? (
        <p className="px-1 py-1 text-sm text-muted-foreground">
          No properties yet — add one below.
        </p>
      ) : (
        <ul className="flex flex-col">
          {entries.map(([key, value]) => (
            <PropertyRow
              key={key}
              attrKey={key}
              value={value}
              busy={busy}
              onSave={(next) => onSet(key, next)}
              onUnset={() => onUnset(key)}
            />
          ))}
        </ul>
      )}
      <AddRow
        busy={busy}
        existingKeys={entries.map(([k]) => k)}
        onAdd={onSet}
      />
    </div>
  );
}

function PropertyRow({
  attrKey,
  value,
  busy,
  onSave,
  onUnset,
}: {
  attrKey: string;
  value: PropertyValue;
  busy: boolean;
  onSave: (next: PropertyValue) => Promise<void>;
  onUnset: () => Promise<void>;
}) {
  const type = valueType(value);
  const editable = type !== "array";
  const [editing, setEditing] = useState(false);
  const [draftType, setDraftType] = useState<ScalarType>(
    editable ? (type as ScalarType) : "string",
  );
  const [draft, setDraft] = useState(scalarToInput(value));

  const beginEdit = () => {
    setDraftType(type as ScalarType);
    setDraft(scalarToInput(value));
    setEditing(true);
  };

  const save = async () => {
    await onSave(coerceScalar(draftType, draft));
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2 py-2">
        <span
          className="max-w-[45%] flex-shrink-0 truncate font-mono text-sm font-medium"
          title={attrKey}
        >
          {attrKey}
        </span>
        <TypeSelect value={draftType} onChange={setDraftType} />
        <div className="min-w-0 flex-1">
          <ValueControl
            type={draftType}
            value={draft}
            onChange={setDraft}
            onEnter={() => void save()}
            autoFocus
          />
        </div>
        <Button
          size="icon-sm"
          aria-label="Save"
          disabled={busy}
          onClick={() => void save()}
        >
          <IconCheck />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Cancel"
          onClick={() => setEditing(false)}
        >
          <IconX />
        </Button>
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-muted/40">
      <span
        className="max-w-[45%] flex-shrink-0 truncate font-mono text-sm font-medium"
        title={attrKey}
      >
        {attrKey}
      </span>
      <TypePill type={type} />
      {editable ? (
        <button
          type="button"
          onClick={beginEdit}
          disabled={busy}
          title={formatPropertyValue(value)}
          className="-mx-1 min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {value === null ? (
            <span className="text-muted-foreground italic">null</span>
          ) : (
            formatPropertyValue(value)
          )}
        </button>
      ) : (
        <span
          className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
          title={formatPropertyValue(value)}
        >
          {formatPropertyValue(value)}
        </span>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
        aria-label={`Remove ${attrKey}`}
        disabled={busy}
        onClick={() => void onUnset()}
      >
        <IconTrash />
      </Button>
    </li>
  );
}

function AddRow({
  busy,
  existingKeys,
  onAdd,
}: {
  busy: boolean;
  existingKeys: string[];
  onAdd: (key: string, value: PropertyValue) => Promise<void>;
}) {
  const [key, setKey] = useState("");
  const [type, setType] = useState<ScalarType>("string");
  const [typeLocked, setTypeLocked] = useState(false);
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  const trimmedKey = key.trim();
  const keyError = useMemo(() => {
    if (!trimmedKey) return null;
    const formatError = validateKey(trimmedKey);
    if (formatError) return formatError;
    if (existingKeys.includes(trimmedKey))
      return "An property with this key already exists";
    return null;
  }, [trimmedKey, existingKeys]);

  const canAdd = Boolean(trimmedKey) && !keyError && !busy;

  const onValueChange = (next: string) => {
    setValue(next);
    // Value-first: keep inferring the type until the user picks one by hand.
    if (!typeLocked && type !== "null") setType(inferScalarType(next));
  };

  const reset = () => {
    setKey("");
    setValue("");
    setType("string");
    setTypeLocked(false);
    setTouched(false);
  };

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setTouched(true);
    if (!canAdd) return;
    await onAdd(trimmedKey, coerceScalar(type, value));
    reset();
  };

  return (
    <form
      onSubmit={submit}
      className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-muted/30 px-3 py-2.5"
    >
      <div className="min-w-0 flex-1 basis-32">
        <Input
          placeholder="new key"
          aria-invalid={touched && Boolean(keyError)}
          className="h-8 font-mono"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onBlur={() => setTouched(true)}
        />
      </div>
      <TypeSelect
        value={type}
        onChange={(next) => {
          setType(next);
          setTypeLocked(true);
        }}
      />
      <div className="min-w-0 flex-1 basis-32">
        <ValueControl
          type={type}
          value={value}
          onChange={onValueChange}
          onEnter={() => void submit()}
        />
      </div>
      <Button type="submit" size="sm" disabled={!canAdd}>
        <IconPlus data-icon="inline-start" />
        Add
      </Button>
      {touched && keyError && (
        <p className="w-full text-xs text-destructive">{keyError}</p>
      )}
    </form>
  );
}

/* ------------------------------- JSON view ------------------------------- */

function JsonView({
  properties,
  busy,
  commit,
}: {
  properties: Properties;
  busy: boolean;
  commit: (
    set: Record<string, PropertyValue>,
    unset: string[],
  ) => Promise<void>;
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
  const changeCount = diff
    ? Object.keys(diff.set).length + diff.unset.length
    : 0;
  const modified = text !== baseline;

  const save = async () => {
    if (!parsed.ok || !diff || changeCount === 0) return;
    await commit(diff.set, diff.unset);
    // Normalize to the saved item so dirty state clears once the prop catches
    // up — no effect needed.
    setText(prettyJson(parsed.value));
  };

  return (
    <div className="flex flex-col gap-2">
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
            <IconAlertTriangle className="size-3.5 shrink-0" />
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
            <IconDeviceFloppy data-icon="inline-start" />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- Controls -------------------------------- */

function TypePill({ type }: { type: ValueType }) {
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground">
      {TYPE_LABEL[type]}
    </span>
  );
}

// Icon per scalar type. The trigger shows only the icon to stay compact (the
// full words overflowed a fixed-width text trigger); the dropdown spells the
// type out in full next to the same icon.
const TYPE_ICON: Record<ScalarType, React.ComponentType<{ className?: string }>> =
  {
    string: IconLetterCase,
    number: IconNumber123,
    boolean: IconToggleLeft,
    null: IconCircleOff,
  };

function TypeSelect({
  value,
  onChange,
}: {
  value: ScalarType;
  onChange: (next: ScalarType) => void;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as ScalarType)}>
      <SelectTrigger className="w-auto" aria-label="Value type" title={value}>
        <SelectValue>
          {(selected: ScalarType | null) => {
            const Icon = TYPE_ICON[selected ?? "string"];
            return <Icon className="size-4 text-muted-foreground" />;
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {SCALAR_TYPES.map((t) => {
            const Icon = TYPE_ICON[t];
            return (
              <SelectItem key={t} value={t} className="font-mono text-xs">
                <Icon className="size-4 text-muted-foreground" />
                {t}
              </SelectItem>
            );
          })}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function ValueControl({
  type,
  value,
  onChange,
  onEnter,
  autoFocus,
}: {
  type: ScalarType;
  value: string;
  onChange: (next: string) => void;
  onEnter?: () => void;
  autoFocus?: boolean;
}) {
  if (type === "null") {
    return (
      <span className="block px-1 text-sm text-muted-foreground italic">
        null
      </span>
    );
  }
  if (type === "boolean") {
    return (
      <Select
        value={value.trim() === "false" ? "false" : "true"}
        onValueChange={(next) => onChange(next ?? "true")}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="true">true</SelectItem>
            <SelectItem value="false">false</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={autoFocus}
      placeholder="value"
      type={type === "number" ? "number" : "text"}
      className="h-8"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter?.();
        }
      }}
    />
  );
}
