import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { AttributeValue } from "@keva/schema";
import type { KevaObject } from "@keva/sdk";
import { AttributesEditor } from "../components/AttributesEditor";
import { formatBytes, formatDate } from "../lib/format";
import { keva } from "../lib/keva";
import { useApiError } from "../lib/useApiError";

export function FileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const handleError = useApiError();
  const [object, setObject] = useState<KevaObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      setObject(await keva.get(id));
    } catch (err) {
      setError(handleError(err));
    } finally {
      setLoading(false);
    }
  }, [id, handleError]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDownload = async () => {
    if (!object) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = await keva.download(object.id);
      const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: object.contentType,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = object.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(handleError(err));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!object) return;
    if (!window.confirm(`Delete "${object.name}"? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await keva.delete(object.id);
      navigate("/", { replace: true });
    } catch (err) {
      setError(handleError(err));
      setBusy(false);
    }
  };

  const onPatch = async (
    set: Record<string, AttributeValue>,
    unset: string[],
  ) => {
    if (!object) return;
    setError(null);
    try {
      setObject(await keva.patchAttributes(object.id, { set, unset }));
    } catch (err) {
      setError(handleError(err));
      throw err;
    }
  };

  if (loading) return <p className="muted">Loading…</p>;
  if (error && !object) return <div className="alert-error">{error}</div>;
  if (!object) return <p className="muted">Not found.</p>;

  return (
    <div>
      <div className="page-header">
        <h1>{object.name}</h1>
        <div className="button-row">
          <button
            type="button"
            className="btn-secondary"
            onClick={onDownload}
            disabled={busy}
          >
            Download
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={onDelete}
            disabled={busy}
          >
            Delete
          </button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <dl className="meta-grid">
        <dt>ID</dt>
        <dd className="mono">{object.id}</dd>
        <dt>Content type</dt>
        <dd>{object.contentType}</dd>
        <dt>Size</dt>
        <dd>{formatBytes(object.size)}</dd>
        <dt>Status</dt>
        <dd>{object.status}</dd>
        <dt>Source</dt>
        <dd>{object.source}</dd>
        <dt>Created</dt>
        <dd>{formatDate(object.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{formatDate(object.updatedAt)}</dd>
      </dl>

      <h2>Attributes</h2>
      <AttributesEditor attributes={object.attributes} onPatch={onPatch} />
    </div>
  );
}
