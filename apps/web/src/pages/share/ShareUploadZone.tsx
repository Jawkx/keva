import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { IconAlertTriangle, IconCheck, IconCloudUpload, IconLoader2 } from "@tabler/icons-react";
import { errorMessage, isShareGone, type TaggedError } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import { useShare } from "./share-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface UploadState {
  readonly id: string;
  readonly file: File;
  readonly status: "uploading" | "done" | "error";
  readonly error?: string;
}

const isQuotaError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  (error as TaggedError)._tag === "QuotaExceeded";

// Write view of a share. "hero" is the standalone drop-box for write-only
// grants; "compact" sits above the list for read+write grants. Uploads run
// through the ShareClient (initiate → PUT → confirm); the server force-applies
// the grant's property stamp, so there is no properties editor here.
export function ShareUploadZone({ variant }: { variant: "hero" | "compact" }) {
  const { client, self, onGone } = useShare();
  const queryClient = useQueryClient();
  const canRead = self.scopes.includes("read");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);

  const runUpload = async (entry: UploadState) => {
    try {
      await client.uploadFile(entry.file);
      setUploads((prev) => prev.map((u) => (u.id === entry.id ? { ...u, status: "done" } : u)));
      // Refresh the list so the new file appears (read+write grants only).
      if (canRead) void queryClient.invalidateQueries({ queryKey: ["share-items"] });
    } catch (err) {
      // A revoked/expired link mid-upload takes down the whole page.
      if (isShareGone(err)) {
        onGone();
        return;
      }
      const message = isQuotaError(err)
        ? "This share's upload limit has been reached."
        : errorMessage(err);
      setUploads((prev) =>
        prev.map((u) => (u.id === entry.id ? { ...u, status: "error", error: message } : u)),
      );
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const entries: UploadState[] = Array.from(list).map((file) => ({
      id: `up:${crypto.randomUUID()}`,
      file,
      status: "uploading",
    }));
    setUploads((prev) => [...entries, ...prev]);
    for (const entry of entries) void runUpload(entry);
  };

  const retry = (entry: UploadState) => {
    const reset: UploadState = { id: entry.id, file: entry.file, status: "uploading" };
    setUploads((prev) => prev.map((u) => (u.id === entry.id ? reset : u)));
    void runUpload(reset);
  };

  const limits = self.upload;
  const quotaHint =
    limits &&
    [
      limits.maxItems !== null ? `${limits.usedItems}/${limits.maxItems} files` : null,
      limits.maxTotalBytes !== null
        ? `${formatBytes(limits.usedBytes)} / ${formatBytes(limits.maxTotalBytes)}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

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
          "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input text-center transition-colors hover:bg-muted/50",
          variant === "hero" ? "p-12" : "p-6",
          dragging && "border-primary bg-primary/5",
        )}
      >
        <IconCloudUpload
          className={cn("text-muted-foreground", variant === "hero" ? "size-8" : "size-6")}
        />
        <span className="text-sm text-muted-foreground">
          Drag files here, or click to choose
        </span>
        {quotaHint && <span className="text-xs text-muted-foreground">{quotaHint}</span>}
        <input ref={inputRef} type="file" hidden multiple onChange={(e) => addFiles(e.target.files)} />
      </button>

      {uploads.length > 0 && (
        <ul className="flex flex-col gap-1">
          {uploads.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm"
            >
              {entry.status === "uploading" && (
                <IconLoader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              )}
              {entry.status === "done" && <IconCheck className="size-4 shrink-0 text-primary" />}
              {entry.status === "error" && (
                <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
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
      )}
      {uploads.some((u) => u.status === "error") && (
        <p className="text-xs text-destructive">
          {uploads.find((u) => u.status === "error")?.error}
        </p>
      )}
    </div>
  );
}
