import { useRef, useState } from "react";
import { errorMessage } from "../lib/errors";
import { keva } from "../lib/keva";

interface UploadModalProps {
  onClose: () => void;
  onUploaded: () => void;
}

export function UploadModal({ onClose, onUploaded }: UploadModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (target: File) => {
    setBusy(true);
    setError(null);
    try {
      const bytes = new Uint8Array(await target.arrayBuffer());
      await keva.upload(
        {
          name: target.name,
          contentType: target.type || "application/octet-stream",
          size: target.size,
          source: "upload",
          attributes: {},
        },
        bytes,
      );
      onUploaded();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Upload object</h2>
        <div
          className={dragging ? "dropzone dropzone-active" : "dropzone"}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const dropped = e.dataTransfer.files[0];
            if (dropped) setFile(dropped);
          }}
        >
          {file ? (
            <span>{file.name}</span>
          ) : (
            <span className="muted">
              Drag a file here, or click to choose
            </span>
          )}
          <input
            ref={inputRef}
            type="file"
            hidden
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) setFile(chosen);
            }}
          />
        </div>
        {error && <div className="alert-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!file || busy}
            onClick={() => file && upload(file)}
          >
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>
    </div>
  );
}
