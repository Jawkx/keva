import { useState } from "react";
import type { AttributeValue, Attributes } from "@keva/schema";
import { formatAttributeValue } from "../lib/format";

type AttrType = "string" | "number" | "boolean";

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

export function AttributesEditor({
  attributes,
  onPatch,
}: AttributesEditorProps) {
  const [newKey, setNewKey] = useState("");
  const [newType, setNewType] = useState<AttrType>("string");
  const [newValue, setNewValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = Object.entries(attributes);

  const run = async (
    set: Record<string, AttributeValue>,
    unset: string[],
  ) => {
    setBusy(true);
    setError(null);
    try {
      await onPatch(set, unset);
    } catch {
      // The parent surfaces the message; we just stop the spinner.
      setError("Update failed.");
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
    <div className="attrs">
      {error && <div className="alert-error">{error}</div>}
      {entries.length === 0 ? (
        <p className="muted">No attributes.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
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
          </tbody>
        </table>
      )}

      <form className="attr-add" onSubmit={onAdd}>
        <input
          placeholder="key"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <select
          value={newType}
          onChange={(e) => setNewType(e.target.value as AttrType)}
        >
          <option value="string">string</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
        </select>
        {newType === "boolean" ? (
          <select
            value={newValue || "true"}
            onChange={(e) => setNewValue(e.target.value)}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        ) : (
          <input
            placeholder="value"
            type={newType === "number" ? "number" : "text"}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
        )}
        <button type="submit" className="btn-primary" disabled={busy}>
          Add / Set
        </button>
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
      <tr>
        <td className="mono">{attrKey}</td>
        <td>
          <div className="attr-edit">
            <select
              value={draftType}
              onChange={(e) => setDraftType(e.target.value as AttrType)}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
            </select>
            {draftType === "boolean" ? (
              <select
                value={draft === "false" ? "false" : "true"}
                onChange={(e) => setDraft(e.target.value)}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                type={draftType === "number" ? "number" : "text"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            )}
          </div>
        </td>
        <td className="button-row">
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={async () => {
              await onSave(coerce(draftType, draft));
              setEditing(false);
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="mono">{attrKey}</td>
      <td>{formatAttributeValue(value)}</td>
      <td className="button-row">
        {!isArray && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setDraft(formatAttributeValue(value));
              setDraftType(type);
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          className="btn-danger"
          disabled={busy}
          onClick={onUnset}
        >
          Unset
        </button>
      </td>
    </tr>
  );
}
