import { useRef, useState } from "react";
import { Effect } from "effect";
import { useQueryClient } from "@tanstack/react-query";
import {
  Forbidden,
  Internal,
  NotFound,
  QuotaExceeded,
  StorageUnavailable,
  Unauthorized,
} from "@keva/schema";
import {
  isUploadSessionExpired,
  KevaTransportError,
  type SharedItem,
  type ShareUploadSession,
} from "@keva/sdk";
import { authClient } from "../../lib/auth";
import { authOperationEffect } from "../../lib/auth-effect";
import { errorMessage } from "../../lib/errors";
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
  readonly item?: SharedItem;
}

const isShareGoneError = (error: unknown): boolean =>
  error instanceof Unauthorized || error instanceof NotFound || error instanceof Forbidden;

const ensureShareIdentityEffect = authOperationEffect(() => authClient.getSession()).pipe(
  Effect.flatMap((session) =>
    session
      ? Effect.void
      : authOperationEffect(() => authClient.signIn.anonymous()).pipe(Effect.asVoid),
  ),
);

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
      (error) =>
        error instanceof KevaTransportError ||
        error instanceof StorageUnavailable ||
        error instanceof Internal,
    ).pipe(
      Effect.match({
        onFailure: ({ cause, session, stage }) => {
          if (isShareGoneError(cause)) {
            onGone();
            return;
          }
          const phase = stage === "confirm" ? "confirm" : "put";
          const message =
            cause instanceof QuotaExceeded
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
        onSuccess: (item) => {
          setUploads((prev) =>
            prev.map((upload) =>
              upload.id === entry.id ? { ...upload, status: "done", item } : upload,
            ),
          );
          void cacheConfirmedShareUpload(queryClient, selfQueryKey).then(() => {
            if (self.scopes.includes("read")) {
              setUploads((prev) => prev.filter((upload) => upload.id !== entry.id));
            }
          });
        },
      }),
    );

  const failUploads = (entries: readonly UploadState[], error: unknown) => {
    const ids = new Set(entries.map((entry) => entry.id));
    const message = errorMessage(error);
    setUploads((prev) =>
      prev.map((upload) =>
        ids.has(upload.id) ? { ...upload, status: "error", error: message } : upload,
      ),
    );
  };

  const runUploads = (entries: readonly UploadState[]) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    const identity = self.allowOwnDelete ? ensureShareIdentityEffect : Effect.void;
    const workflow = identity.pipe(
      Effect.andThen(Effect.forEach(entries, uploadOne, { concurrency: 3, discard: true })),
      Effect.catch((error) => Effect.sync(() => failUploads(entries, error))),
      Effect.ensuring(Effect.sync(() => controllers.current.delete(controller))),
    );
    void Effect.runPromise(workflow, { signal: controller.signal });
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
