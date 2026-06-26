import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  IconAlertTriangle,
  IconCode,
  IconPlus,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import type { Operator } from "@keva/schema";
import type { KevaObject, Query } from "@keva/sdk";
import { CodeBlock } from "../components/CodeBlock";
import { PageHeader } from "../components/PageHeader";
import { formatBytes, formatDate } from "../lib/format";
import { keva } from "../lib/keva";
import { useApiError } from "../lib/useApiError";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
const VALUE_TYPES: ValueType[] = ["string", "number", "boolean"];

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
  const [showApi, setShowApi] = useState(false);

  const update = (index: number, patch: Partial<Row>) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const where = useMemo<Query["where"]>(
    () =>
      rows
        .filter((row) => row.key.trim().length > 0)
        .map((row) =>
          row.op === "exists"
            ? { key: row.key.trim(), op: row.op }
            : {
                key: row.key.trim(),
                op: row.op,
                value: coerceValue(row.valueType, row.value),
              },
        ),
    [rows],
  );

  const snippets = useMemo(() => {
    const base = window.location.origin;
    const body = JSON.stringify({ where: where ?? [], limit }, null, 2);
    const curl = `curl -X POST ${base}/query \\
  -H "Authorization: Bearer $KEVA_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ where: where ?? [], limit })}'`;
    const sdk = `import { KevaClient } from "@keva/sdk";

const keva = new KevaClient({
  baseUrl: "${base}",
  token: process.env.KEVA_TOKEN,
});

const { objects } = await keva.query(${body});`;
    return { curl, sdk };
  }, [where, limit]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
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
      <PageHeader
        title="Query"
        description="Filter objects by their attributes and system fields."
      />

      <p className="mb-4 text-sm text-muted-foreground">
        Keys can be a bare attribute name, <code className="font-mono">name</code>,{" "}
        <code className="font-mono">id</code>, or{" "}
        <code className="font-mono">system.&lt;field&gt;</code> (e.g.{" "}
        <code className="font-mono">system.content_type</code>,{" "}
        <code className="font-mono">system.size</code>,{" "}
        <code className="font-mono">system.status</code>).
      </p>

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div className="flex flex-wrap items-center gap-2" key={index}>
              <Input
                placeholder="key"
                className="w-44"
                value={row.key}
                onChange={(e) => update(index, { key: e.target.value })}
              />
              <Select
                value={row.op}
                onValueChange={(next) => update(index, { op: next as Operator })}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {OPERATORS.map((op) => (
                      <SelectItem key={op} value={op}>
                        {op}
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
                    onValueChange={(next) =>
                      update(index, { valueType: next as ValueType })
                    }
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {VALUE_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {row.valueType === "boolean" ? (
                    <Select
                      value={row.value || "true"}
                      onValueChange={(next) =>
                        update(index, { value: String(next) })
                      }
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
                    <Input
                      placeholder="value"
                      className="w-44"
                      type={row.valueType === "number" ? "number" : "text"}
                      value={row.value}
                      onChange={(e) => update(index, { value: e.target.value })}
                    />
                  )}
                </>
              )}

              <Button
                size="icon"
                variant="ghost"
                aria-label="Remove condition"
                onClick={() =>
                  setRows((prev) =>
                    prev.length === 1
                      ? [emptyRow()]
                      : prev.filter((_, i) => i !== index),
                  )
                }
              >
                <IconX />
              </Button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button
              variant="outline"
              onClick={() => setRows((prev) => [...prev, emptyRow()])}
            >
              <IconPlus data-icon="inline-start" />
              Add condition
            </Button>
            <div className="flex items-center gap-2">
              <Label htmlFor="limit" className="text-muted-foreground">
                Limit
              </Label>
              <Input
                id="limit"
                type="number"
                min={1}
                max={1000}
                className="w-24"
                value={limit}
                onChange={(e) =>
                  setLimit(
                    Math.min(1000, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
              />
            </div>
            <Button
              variant="ghost"
              className="ml-auto"
              onClick={() => setShowApi((v) => !v)}
            >
              <IconCode data-icon="inline-start" />
              {showApi ? "Hide API" : "Show API"}
            </Button>
            <Button onClick={run} disabled={busy}>
              {busy ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <IconSearch data-icon="inline-start" />
              )}
              {busy ? "Running…" : "Run query"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {showApi && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Run this query from the API</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <CodeBlock label="curl" code={snippets.curl} />
            <CodeBlock label="TypeScript SDK" code={snippets.sdk} />
            <p className="text-sm text-muted-foreground">
              Generate a token on the{" "}
              <Link to="/tokens" className="text-primary hover:underline">
                Tokens
              </Link>{" "}
              page and export it as <code className="font-mono">KEVA_TOKEN</code>.
            </p>
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="destructive" className="mb-4">
          <IconAlertTriangle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      {results !== null && (
        <>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            {results.length} result{results.length === 1 ? "" : "s"}
          </h2>
          {results.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <IconSearch />
                </EmptyMedia>
                <EmptyTitle>No matches</EmptyTitle>
                <EmptyDescription>
                  No objects matched these conditions.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Card className="overflow-hidden p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((object) => (
                    <TableRow key={object.id}>
                      <TableCell className="font-medium">
                        <Link
                          to={`/objects/${object.id}`}
                          className="hover:underline"
                        >
                          {object.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {object.contentType}
                      </TableCell>
                      <TableCell className="text-muted-foreground tabular-nums">
                        {formatBytes(object.size)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(object.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
