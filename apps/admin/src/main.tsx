import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { listUsers, updateQuota, type AdminUserUsage } from "./api";
import "./styles.css";

const GB = 1024 ** 3;
const TB = 1024 ** 4;

const formatBytes = (bytes: number) => {
  if (bytes >= TB) return `${(bytes / TB).toFixed(2)} TB`;
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${bytes.toLocaleString()} B`;
};

function App() {
  const [token, setToken] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [users, setUsers] = useState<ReadonlyArray<AdminUserUsage>>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (nextSearch = search) => {
    setLoading(true);
    setError("");
    try {
      const result = await listUsers(token, nextSearch);
      setUsers(result.users);
      setAuthenticated(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load accounts");
    }
    setLoading(false);
  };

  const replaceUser = (user: AdminUserUsage) =>
    setUsers((current) => current.map((entry) => (entry.id === user.id ? user : entry)));

  const signOut = () => {
    setToken("");
    setUsers([]);
    setAuthenticated(false);
    setError("");
  };

  if (!authenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-panel" aria-labelledby="admin-title">
          <div className="brand-mark" aria-hidden="true">
            K
          </div>
          <p className="eyebrow">Keva operations</p>
          <h1 id="admin-title">Storage admin</h1>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void load("");
            }}
          >
            <label htmlFor="admin-token">Admin token</label>
            <input
              id="admin-token"
              type="password"
              value={token}
              autoComplete="current-password"
              autoFocus
              required
              onChange={(event) => setToken(event.target.value)}
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary" type="submit" disabled={loading || !token}>
              {loading ? "Checking…" : "Open console"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            K
          </div>
          <div>
            <strong>Keva</strong>
            <span>Storage operations</span>
          </div>
        </div>
        <button className="quiet" type="button" onClick={signOut}>
          Lock console
        </button>
      </header>

      <main className="workspace">
        <div className="title-row">
          <div>
            <p className="eyebrow">Accounts</p>
            <h1>Usage limits</h1>
          </div>
          <form
            className="search"
            onSubmit={(event) => {
              event.preventDefault();
              void load();
            }}
          >
            <label className="sr-only" htmlFor="user-search">
              Search users
            </label>
            <input
              id="user-search"
              type="search"
              placeholder="Name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button type="submit" disabled={loading}>
              Search
            </button>
          </form>
        </div>

        {error && (
          <p className="error banner" role="alert">
            {error}
          </p>
        )}
        <div className="table-frame" aria-busy={loading}>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Storage used</th>
                <th>Limit</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserRow
                  key={`${user.id}-${user.quotaBytes}-${user.quotaSource}`}
                  token={token}
                  user={user}
                  onChange={replaceUser}
                  onError={setError}
                />
              ))}
            </tbody>
          </table>
          {!loading && users.length === 0 && <p className="empty">No accounts found.</p>}
          {loading && <div className="loading-line" />}
        </div>
      </main>
    </div>
  );
}

function UserRow({
  token,
  user,
  onChange,
  onError,
}: {
  readonly token: string;
  readonly user: AdminUserUsage;
  readonly onChange: (user: AdminUserUsage) => void;
  readonly onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    user.quotaBytes === null ? "10" : String(user.quotaBytes / GB),
  );
  const [unit, setUnit] = useState<"GB" | "TB">("GB");
  const [saving, setSaving] = useState(false);
  const percent =
    user.quotaBytes === null ? 0 : Math.min(100, (user.usedBytes / user.quotaBytes) * 100);

  const save = async (input: { quotaBytes: number | null } | { useDefault: true }) => {
    setSaving(true);
    onError("");
    try {
      const result = await updateQuota(token, user.id, input);
      onChange(result.user);
      setEditing(false);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Could not update quota");
    }
    setSaving(false);
  };

  return (
    <tr>
      <td>
        <strong>{user.name}</strong>
        <span>{user.email}</span>
      </td>
      <td className="number">{formatBytes(user.usedBytes)}</td>
      <td className="number">
        {user.quotaBytes === null ? "Unlimited" : formatBytes(user.quotaBytes)}
      </td>
      <td>
        <div className="status-line">
          <span className={`status ${user.quotaSource}`}>{user.quotaSource}</span>
          {user.quotaBytes !== null && <span>{percent.toFixed(0)}%</span>}
        </div>
        {user.quotaBytes !== null && (
          <div className="meter">
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
      </td>
      <td className="actions">
        {!user.tenantId ? (
          <span className="muted">No storage space</span>
        ) : editing ? (
          <div className="editor">
            <label className="sr-only" htmlFor={`quota-${user.id}`}>
              Quota
            </label>
            <input
              id={`quota-${user.id}`}
              type="number"
              min="0.01"
              step="0.01"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            <select
              value={unit}
              aria-label="Quota unit"
              onChange={(event) => setUnit(event.target.value as "GB" | "TB")}
            >
              <option>GB</option>
              <option>TB</option>
            </select>
            <button
              type="button"
              disabled={saving || !Number(value)}
              onClick={() =>
                void save({ quotaBytes: Math.round(Number(value) * (unit === "TB" ? TB : GB)) })
              }
            >
              Save
            </button>
            <button
              className="icon"
              type="button"
              aria-label="Cancel"
              onClick={() => setEditing(false)}
            >
              ×
            </button>
          </div>
        ) : (
          <div className="menu">
            <button type="button" onClick={() => setEditing(true)}>
              Set limit
            </button>
            <button
              type="button"
              disabled={saving || user.quotaSource === "unlimited"}
              onClick={() => void save({ quotaBytes: null })}
            >
              Make unlimited
            </button>
            <button
              type="button"
              disabled={saving || user.quotaSource === "default"}
              onClick={() => void save({ useDefault: true })}
            >
              Use default
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Root element #root not found");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
