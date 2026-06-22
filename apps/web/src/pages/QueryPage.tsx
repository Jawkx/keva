import { useState } from "react";
import { Link } from "react-router-dom";
import type { Operator } from "@keva/schema";
import type { KevaObject, Query } from "@keva/sdk";
import { formatBytes, formatDate } from "../lib/format";
import { keva } from "../lib/keva";
import { useApiError } from "../lib/useApiError";

const OPERATORS: Operator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "exists",
];

type ValueType = "string" | "number" | "boolean";

interface Row {
  key: string;
  op: Operator;
  valueType: ValueType;
  value: string;
}

const emptyRow = (): Row => ({
  key: "",
  op: "eq",
  valueType: "string",
  value: "",
});

const coerceValue = (type: ValueType, raw: string): string | number | boolean => {
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === "boolean") return raw === "true";
  return raw;
};

export function QueryPage() {
  const handleError = useApiError();
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [limit, setLimit] = useState(100);
  const [results, setResults] = useState<readonly KevaObject[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (index: number, patch: Partial<Row>) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const where: Query["where"] = rows
        .filter((row) => row.key.trim().length > 0)
        .map((row) =>
          row.op === "exists"
            ? { key: row.key.trim(), op: row.op }
            : {
                key: row.key.trim(),
                op: row.op,
                value: coerceValue(row.valueType, row.value),
              },
        );
      const result = await keva.query({ where, limit });
      setResults(result.objects);
    } catch (err) {
      setError(handleError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Query</h1>
      <p className="muted">
        Keys can be a bare attribute name, <code>name</code>, <code>id</code>,
        or <code>system.&lt;field&gt;</code> (e.g. <code>system.content_type</code>,
        <code> system.size</code>, <code>system.status</code>).
      </p>

      <div className="query-builder">
        {rows.map((row, index) => (
          <div className="query-row" key={index}>
            <input
              placeholder="key"
              value={row.key}
              onChange={(e) => update(index, { key: e.target.value })}
            />
            <select
              value={row.op}
              onChange={(e) =>
                update(index, { op: e.target.value as Operator })
              }
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            {row.op === "exists" ? (
              <span className="muted query-novalue">(no value)</span>
            ) : (
              <>
                <select
                  value={row.valueType}
                  onChange={(e) =>
                    update(index, { valueType: e.target.value as ValueType })
                  }
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                </select>
                {row.valueType === "boolean" ? (
                  <select
                    value={row.value || "true"}
                    onChange={(e) => update(index, { value: e.target.value })}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    placeholder="value"
                    type={row.valueType === "number" ? "number" : "text"}
                    value={row.value}
                    onChange={(e) => update(index, { value: e.target.value })}
                  />
                )}
              </>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                setRows((prev) =>
                  prev.length === 1
                    ? [emptyRow()]
                    : prev.filter((_, i) => i !== index),
                )
              }
            >
              Remove
            </button>
          </div>
        ))}
        <div className="button-row">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setRows((prev) => [...prev, emptyRow()])}
          >
            Add condition
          </button>
          <label className="inline-label">
            Limit
            <input
              type="number"
              min={1}
              max={1000}
              value={limit}
              onChange={(e) =>
                setLimit(Math.min(1000, Math.max(1, Number(e.target.value) || 1)))
              }
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            onClick={run}
            disabled={busy}
          >
            {busy ? "Running…" : "Run query"}
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {results !== null && (
        <>
          <h2>{results.length} result(s)</h2>
          {results.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {results.map((object) => (
                  <tr key={object.id}>
                    <td>
                      <Link to={`/objects/${object.id}`}>{object.name}</Link>
                    </td>
                    <td>{object.contentType}</td>
                    <td>{formatBytes(object.size)}</td>
                    <td>{formatDate(object.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
