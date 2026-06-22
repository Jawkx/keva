import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { KevaObject } from "@keva/sdk";
import { UploadModal } from "../components/UploadModal";
import { formatAttributeValue, formatBytes, formatDate } from "../lib/format";
import { keva } from "../lib/keva";
import { useApiError } from "../lib/useApiError";

export function FilesPage() {
  const handleError = useApiError();
  const [objects, setObjects] = useState<readonly KevaObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await keva.query({ where: [], limit: 100 });
      setObjects(result.objects);
    } catch (err) {
      setError(handleError(err));
    } finally {
      setLoading(false);
    }
  }, [handleError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="page-header">
        <h1>Files</h1>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setUploadOpen(true)}
        >
          Upload
        </button>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : objects.length === 0 ? (
        <p className="muted">No objects yet. Upload one to get started.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Size</th>
              <th>Created</th>
              <th>Attributes</th>
            </tr>
          </thead>
          <tbody>
            {objects.map((object) => {
              const attrKeys = Object.keys(object.attributes).slice(0, 2);
              return (
                <tr key={object.id}>
                  <td>
                    <Link to={`/objects/${object.id}`}>{object.name}</Link>
                  </td>
                  <td>{object.contentType}</td>
                  <td>{formatBytes(object.size)}</td>
                  <td>{formatDate(object.createdAt)}</td>
                  <td className="muted">
                    {attrKeys.length === 0
                      ? "—"
                      : attrKeys
                          .map(
                            (key) =>
                              `${key}=${formatAttributeValue(
                                object.attributes[key]!,
                              )}`,
                          )
                          .join("  ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onUploaded={() => void load()}
        />
      )}
    </div>
  );
}
