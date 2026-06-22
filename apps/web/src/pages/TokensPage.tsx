import { useCallback, useEffect, useState } from "react";
import type { Scope, TokenRecord } from "@keva/schema";
import { formatDate } from "../lib/format";
import { listTokens, mintToken, revokeToken } from "../lib/tokens";
import { useApiError } from "../lib/useApiError";

const ALL_SCOPES: Scope[] = ["read", "write", "delete", "admin"];

export function TokensPage() {
  const handleError = useApiError();
  const [tokens, setTokens] = useState<readonly TokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(["read"]);
  const [minting, setMinting] = useState(false);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  useEffect(() => {
    void load();
  }, [load]);

  const toggleScope = (scope: Scope) => {
    setScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((s) => s !== scope)
        : [...prev, scope],
    );
  };

  const onMint = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    setMinting(true);
    setError(null);
    setPlaintext(null);
    setCopied(false);
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
    if (!window.confirm("Revoke this token? Clients using it will stop working."))
      return;
    setError(null);
    try {
      await revokeToken(id);
      await load();
    } catch (err) {
      setError(handleError(err));
    }
  };

  const onCopy = async () => {
    if (!plaintext) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div>
      <h1>API tokens</h1>
      {error && <div className="alert-error">{error}</div>}

      {plaintext && (
        <div className="token-reveal">
          <p>
            <strong>Copy your token now — it will not be shown again.</strong>
          </p>
          <div className="token-box">
            <code>{plaintext}</code>
            <button type="button" className="btn-secondary" onClick={onCopy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPlaintext(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <form className="token-form" onSubmit={onMint}>
        <h2>Mint a token</h2>
        <label>
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ci-pipeline"
            required
          />
        </label>
        <fieldset className="scopes">
          <legend>Scopes</legend>
          {ALL_SCOPES.map((scope) => (
            <label key={scope} className="checkbox">
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={() => toggleScope(scope)}
              />
              {scope}
            </label>
          ))}
        </fieldset>
        <button
          type="submit"
          className="btn-primary"
          disabled={minting || scopes.length === 0}
        >
          {minting ? "Minting…" : "Mint token"}
        </button>
      </form>

      <h2>Existing tokens</h2>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : tokens.length === 0 ? (
        <p className="muted">No tokens yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scopes</th>
              <th>Created</th>
              <th>Expires</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tokens.map((token) => (
              <tr key={token.id}>
                <td>{token.name}</td>
                <td>{token.scopes.join(", ")}</td>
                <td>{formatDate(token.createdAt)}</td>
                <td>{token.expiresAt ? formatDate(token.expiresAt) : "—"}</td>
                <td>
                  {token.lastUsedAt ? formatDate(token.lastUsedAt) : "never"}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => onRevoke(token.id)}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
