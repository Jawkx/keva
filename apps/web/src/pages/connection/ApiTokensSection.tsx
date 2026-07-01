import { useCallback, useState, type FormEvent } from "react";
import { IconAlertTriangle, IconCopy, IconKey } from "@tabler/icons-react";
import { toast } from "sonner";
import type { Scope, TokenRecord } from "@keva/schema";
import { formatDate } from "../../lib/format";
import { listTokens, mintToken, revokeToken } from "../../lib/tokens";
import { useApiError } from "../../lib/useApiError";
import { useMountEffect } from "../../lib/useMountEffect";
import { ConfirmRevoke } from "./ConfirmRevoke";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ALL_SCOPES: Scope[] = ["read", "write", "delete", "admin"];

export function ApiTokensSection() {
  const handleError = useApiError();
  const [tokens, setTokens] = useState<readonly TokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read"]);
  const [minting, setMinting] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTokens(await listTokens());
    } catch (err) {
      setError(handleError(err));
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useMountEffect(() => {
    void load();
  });

  const toggleScope = (scope: Scope) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((value) => value !== scope) : [...prev, scope],
    );
  };

  const onMint = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    setMinting(true);
    setError(null);
    setPlaintext(null);
    try {
      const result = await mintToken({ name: name.trim(), scopes });
      setPlaintext(result.token);
      setName("");
      setScopes(["read"]);
      await load();
    } catch (err) {
      setError(handleError(err));
    } finally {
      setMinting(false);
    }
  };

  const onRevoke = async (id: string) => {
    try {
      await revokeToken(id);
      toast.success("Token revoked");
      await load();
    } catch (err) {
      toast.error(handleError(err));
    }
  };

  const onCopy = async () => {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      toast.success("Token copied to clipboard");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <div>
      <h2 className="mb-1 font-heading text-lg font-medium">API tokens</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Bearer tokens for scripts, the SDK, and direct API access.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <IconAlertTriangle />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}

      {plaintext && (
        <Alert className="mb-6 border-primary/40">
          <IconKey />
          <AlertTitle>Copy your token now — it won't be shown again.</AlertTitle>
          <AlertDescription>
            <div className="mt-2 flex w-full items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs text-foreground">
                {plaintext}
              </code>
              <Button size="sm" variant="outline" onClick={onCopy}>
                <IconCopy data-icon="inline-start" />
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPlaintext(null)}>
                Dismiss
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Mint a token</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onMint}>
            <FieldGroup>
              <Field className="max-w-xs">
                <FieldLabel htmlFor="token-name">Name</FieldLabel>
                <Input
                  id="token-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="ci-pipeline"
                  required
                />
              </Field>
              <FieldSet>
                <FieldLegend variant="label">Scopes</FieldLegend>
                <div className="flex flex-wrap gap-4">
                  {ALL_SCOPES.map((scope) => (
                    <Field key={scope} orientation="horizontal" className="w-auto">
                      <Checkbox
                        id={`scope-${scope}`}
                        checked={scopes.includes(scope)}
                        onCheckedChange={() => toggleScope(scope)}
                      />
                      <FieldLabel htmlFor={`scope-${scope}`} className="font-normal">
                        {scope}
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
              </FieldSet>
              <Button type="submit" className="w-fit" disabled={minting || scopes.length === 0}>
                {minting ? "Minting…" : "Mint token"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : tokens.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconKey />
            </EmptyMedia>
            <EmptyTitle>No tokens yet</EmptyTitle>
            <EmptyDescription>Mint a token above to access keva from code.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {token.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(token.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {token.expiresAt ? formatDate(token.expiresAt) : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {token.lastUsedAt ? formatDate(token.lastUsedAt) : "never"}
                  </TableCell>
                  <TableCell>
                    <ConfirmRevoke
                      title="Revoke this token?"
                      description="Clients using it will immediately stop working. This cannot be undone."
                      label="Revoke token"
                      onConfirm={() => onRevoke(token.id)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
