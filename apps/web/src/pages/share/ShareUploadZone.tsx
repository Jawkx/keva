import { Check, CloudUpload, LoaderCircle, TriangleAlert, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { formatBytes } from "../../lib/format";
import { useShareUpload, type UploadState } from "./use-share-upload";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ShareUploadButton({
  onFiles,
  quotaHint,
}: {
  onFiles: (list: FileList | null) => void;
  quotaHint: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      {quotaHint && (
        <span className="hidden text-xs text-muted-foreground sm:inline">{quotaHint}</span>
      )}
      <Button onClick={() => inputRef.current?.click()}>
        <Upload data-icon="inline-start" />
        Upload
      </Button>
      <input ref={inputRef} type="file" hidden multiple onChange={(e) => onFiles(e.target.files)} />
    </div>
  );
}

export function ShareUploadProgress({
  uploads,
  retry,
}: {
  uploads: readonly UploadState[];
  retry: (entry: UploadState) => void;
}) {
  if (uploads.length === 0) return null;
  const firstError = uploads.find((u) => u.status === "error")?.error;
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1">
        {uploads.map((entry) => (
          <li
            key={entry.id}
            className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm"
          >
            {entry.status === "uploading" && (
              <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />
            )}
            {entry.status === "done" && <Check className="size-4 shrink-0 text-primary" />}
            {entry.status === "error" && (
              <TriangleAlert className="size-4 shrink-0 text-destructive" />
            )}
            <span className="min-w-0 flex-1 truncate">{entry.file.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatBytes(entry.file.size)}
            </span>
            {entry.status === "error" && (
              <Button size="sm" variant="ghost" onClick={() => retry(entry)}>
                Retry
              </Button>
            )}
          </li>
        ))}
      </ul>
      {firstError && <p className="text-xs text-destructive">{firstError}</p>}
    </div>
  );
}

export function ShareUploadZone() {
  const { uploads, addFiles, retry, quotaHint } = useShareUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-12 text-center transition-colors hover:bg-muted/50",
          dragging && "border-primary bg-primary/5",
        )}
      >
        <CloudUpload className="size-8 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Drag files here, or click to choose</span>
        {quotaHint && <span className="text-xs text-muted-foreground">{quotaHint}</span>}
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          onChange={(e) => addFiles(e.target.files)}
        />
      </button>

      <ShareUploadProgress uploads={uploads} retry={retry} />
    </div>
  );
}
