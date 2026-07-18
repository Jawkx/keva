import { useRef, useState } from "react";
import { Effect } from "effect";
import { useQueryClient } from "@tanstack/react-query";
import { isUploadSessionExpired, type ShareUploadSession } from "@keva/sdk";
import { errorMessage, isShareGone, type TaggedError } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import { cacheConfirmedShareUpload } from "../../lib/items-cache";
import { useMountEffect } from "../../lib/useMountEffect";
import { uploadFileEffect } from "../../lib/upload-workflow";
import { useShare } from "./share-context";

export interface UploadState {
  readonly id: string;
  readonly file: File;
  readonly status: "uploading" | "done" | "error";
  readonly session?: ShareUploadSession | undefined;
  readonly phase: "put" | "confirm";
  readonly error?: string;
}

const isQuotaError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  (error as TaggedError)._tag === "QuotaExceeded";

export interface ShareUpload {
  uploads: readonly UploadState[];
  addFiles: (list: FileList | null) => void;
  retry: (entry: UploadState) => void;
  quotaHint: string | null;
}

export function useShareUpload(): ShareUpload {
  const { client, self, selfQueryKey, onGone } = useShare();
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const controllers = useRef(new Set<AbortController>());

  useMountEffect(() => () => {
    for (const controller of controllers.current) controller.abort();
  });

  const uploadOne = (entry: UploadState) =>
    uploadFileEffect(
      {
        start: client.startUploadEffect(entry.file),
        put: (session) => client.putUploadEffect(session, entry.file),
        confirm: (session) => client.completeUploadEffect(session),
      },
      entry,
      (session, phase) => {
        setUploads((prev) =>
          prev.map((upload) =>
            upload.id === entry.id ? { ...upload, session, phase, status: "uploading" } : upload,
          ),
        );
      },
    ).pipe(
      Effect.match({
        onFailure: ({ cause, session, phase }) => {
          if (isShareGone(cause)) {
            onGone();
            return;
          }
          const message = isQuotaError(cause)
            ? "This share's upload limit has been reached."
            : errorMessage(cause);
          setUploads((prev) =>
            prev.map((upload) =>
              upload.id === entry.id
                ? { ...upload, session, phase, status: "error", error: message }
                : upload,
            ),
          );
        },
        onSuccess: () => {
          setUploads((prev) =>
            prev.map((upload) => (upload.id === entry.id ? { ...upload, status: "done" } : upload)),
          );
          cacheConfirmedShareUpload(queryClient, selfQueryKey);
        },
      }),
    );

  const runUploads = (entries: readonly UploadState[]) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    void Effect.runPromise(Effect.forEach(entries, uploadOne, { concurrency: 3, discard: true }), {
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => controllers.current.delete(controller));
  };

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const entries: UploadState[] = Array.from(list).map((file) => ({
      id: `up:${crypto.randomUUID()}`,
      file,
      status: "uploading",
      phase: "put",
    }));
    setUploads((prev) => [...entries, ...prev]);
    runUploads(entries);
  };

  const retry = (entry: UploadState) => {
    const session =
      entry.phase === "put" && entry.session && isUploadSessionExpired(entry.session)
        ? undefined
        : entry.session;
    const { error: _error, ...resetBase } = entry;
    const reset: UploadState = {
      ...resetBase,
      session,
      phase: session ? entry.phase : "put",
      status: "uploading",
    };
    setUploads((prev) => prev.map((upload) => (upload.id === entry.id ? reset : upload)));
    runUploads([reset]);
  };

  const limits = self.upload;
  const quotaHint =
    (limits &&
      [
        limits.maxItems !== null ? `${limits.usedItems}/${limits.maxItems} files` : null,
        limits.maxTotalBytes !== null
          ? `${formatBytes(limits.usedBytes)} / ${formatBytes(limits.maxTotalBytes)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")) ||
    null;

  return { uploads, addFiles, retry, quotaHint };
}
