import { useState } from "react";
import { IconCheck, IconPencil, IconPlus, IconX } from "@tabler/icons-react";
import type { AttributeValue, Attributes } from "@keva/schema";
import { formatAttributeValue } from "../lib/format";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AttrType = "string" | "number" | "boolean";
const TYPES: AttrType[] = ["string", "number", "boolean"];

interface AttributesEditorProps {
  attributes: Attributes;
  onPatch: (
    set: Record<string, AttributeValue>,
    unset: string[],
  ) => Promise<void>;
}

const coerce = (type: AttrType, raw: string): AttributeValue => {
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === "boolean") return raw === "true";
  return raw;
};

function ValueInput({
  type,
  value,
  onChange,
}: {
  type: AttrType;
  value: string;
  onChange: (next: string) => void;
}) {
  if (type === "boolean") {
    return (
      <Select
        value={value === "false" ? "false" : "true"}
        onValueChange={(next) => onChange(String(next))}
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
    );
  }
  return (
    <Input
      placeholder="value"
      type={type === "number" ? "number" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function TypeSelect({
  value,
  onChange,
}: {
  value: AttrType;
  onChange: (next: AttrType) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as AttrType)}
    >
      <SelectTrigger className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function AttributesEditor({
  attributes,
  onPatch,
}: AttributesEditorProps) {
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<AttrType>("string");
  const [newValue, setNewValue] = useState("");
  const [busy, setBusy] = useState(false);

  const entries = Object.entries(attributes);

  const run = async (
    set: Record<string, AttributeValue>,
    unset: string[],
  ) => {
    setBusy(true);
    try {
      await onPatch(set, unset);
    } finally {
      setBusy(false);
    }
  };

  const onAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newKey.trim()) return;
    await run({ [newKey.trim()]: coerce(newType, newValue) }, []);
    setNewKey("");
    setNewValue("");
    setNewType("string");
  };

  return (
    <div className="flex flex-col gap-4">
      {entries.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map(([key, value]) => (
              <AttributeRow
                key={key}
                attrKey={key}
                value={value}
                busy={busy}
                onSave={(next) => run({ [key]: next }, [])}
                onUnset={() => run({}, [key])}
              />
            ))}
          </TableBody>
        </Table>
      )}

      <form
        className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3"
        onSubmit={onAdd}
      >
        <Input
          placeholder="key"
          className="w-40"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <TypeSelect value={newType} onChange={setNewType} />
        <ValueInput type={newType} value={newValue} onChange={setNewValue} />
        <Button type="submit" disabled={busy || !newKey.trim()}>
          <IconPlus data-icon="inline-start" />
          Add / Set
        </Button>
      </form>
    </div>
  );
}

interface AttributeRowProps {
  attrKey: string;
  value: AttributeValue;
  busy: boolean;
  onSave: (next: AttributeValue) => Promise<void>;
  onUnset: () => Promise<void>;
}

function AttributeRow({
  attrKey,
  value,
  busy,
  onSave,
  onUnset,
}: AttributeRowProps) {
  const [editing, setEditing] = useState(false);
  // Arrays are shown read-only; the simple editor handles scalars only.
  const isArray = Array.isArray(value);
  const type: AttrType =
    typeof value === "number"
      ? "number"
      : typeof value === "boolean"
        ? "boolean"
        : "string";
  const [draftType, setDraftType] = useState<AttrType>(type);
  const [draft, setDraft] = useState(formatAttributeValue(value));

  if (editing && !isArray) {
    return (
      <TableRow>
        <TableCell className="font-mono align-top">{attrKey}</TableCell>
        <TableCell>
          <div className="flex flex-wrap items-center gap-2">
            <TypeSelect value={draftType} onChange={setDraftType} />
            <ValueInput type={draftType} value={draft} onChange={setDraft} />
          </div>
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                await onSave(coerce(draftType, draft));
                setEditing(false);
              }}
            >
              <IconCheck data-icon="inline-start" />
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="font-mono align-top">{attrKey}</TableCell>
      <TableCell className="break-all">
        {isArray ? (
          <Badge variant="outline">{formatAttributeValue(value)}</Badge>
        ) : (
          formatAttributeValue(value)
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {!isArray && (
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={busy}
              aria-label="Edit"
              onClick={() => {
                setDraft(formatAttributeValue(value));
                setDraftType(type);
                setEditing(true);
              }}
            >
              <IconPencil />
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            aria-label="Unset"
            onClick={onUnset}
          >
            <IconX />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
