import { useRef, useState } from "react";
import { Effect } from "effect";
import type { QueryClient } from "@tanstack/react-query";
import {
  Internal,
  StorageUnavailable,
  type PropertyValue,
  type QueryCondition,
  type QueryOrder,
} from "@keva/schema";
import {
  isUploadSessionExpired,
  KevaTransportError,
  type InitiateUpload,
  type ItemUploadSession,
  type KevaItem,
} from "@keva/sdk";
import { errorMessage } from "./errors";
import { cacheConfirmedItemUpload, itemsQueryKey } from "./items-cache";
import { keva } from "./keva";
import { useMountEffect } from "./useMountEffect";
import { uploadFileEffect } from "./upload-workflow";
import { generateVideoThumbnailEffect, type VideoThumbnail } from "./video-thumbnail";

export type PendingUpload = {
  readonly status: "uploading" | "error";
  readonly file: File;
  readonly input: Pick<InitiateUpload, "properties" | "source">;
  readonly session?: ItemUploadSession | undefined;
  readonly phase: "put" | "confirm";
  readonly error?: string;
};

export type UploadQueueRow = KevaItem & {
  upload?: PendingUpload;
};

const thumbnailJobs = new WeakMap<File, Promise<VideoThumbnail | null>>();

const optimisticRow = (id: string, file: File, upload: PendingUpload): UploadQueueRow => {
  const now = new Date().toISOString();
  return {
    id,
    name: file.name,
    contentType: file.type || "application/octet-stream",
    declaredSize: file.size,
    size: file.size,
    etag: null,
    source: "upload",
    status: "pending",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    properties: upload.input.properties ?? {},
    upload,
  };
};

export function useUploadQueue({
  queryClient,
  activeSearch,
  activeWhere,
  order,
  uploadStamp,
}: {
  readonly queryClient: QueryClient;
  readonly activeSearch: string;
  readonly activeWhere: readonly QueryCondition[];
  readonly order: QueryOrder;
  readonly uploadStamp: Record<string, PropertyValue>;
}) {
  const [uploads, setUploads] = useState<UploadQueueRow[]>([]);
  const controllers = useRef(new Set<AbortController>());

  useMountEffect(() => () => {
    for (const controller of controllers.current) controller.abort();
  });

  const uploadOne = (id: string, upload: PendingUpload) => {
    let thumbnailJob = thumbnailJobs.get(upload.file);
    if (!thumbnailJob) {
      thumbnailJob = Effect.runPromise(
        generateVideoThumbnailEffect(upload.file).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              console.warn("Could not generate video thumbnail", error);
              return null;
            }),
          ),
        ),
      );
      thumbnailJobs.set(upload.file, thumbnailJob);
    }

    return uploadFileEffect(
      {
        start: keva.startUploadEffect({
          name: upload.file.name,
          contentType: upload.file.type || "application/octet-stream",
          size: upload.file.size,
          ...upload.input,
        }),
        put: (session) => keva.putUploadEffect(session, upload.file),
        confirm: (session) => keva.completeUploadEffect(session),
      },
      upload,
      (session, phase) => {
        setUploads((prev) =>
          prev.map((row) =>
            row.id === id
              ? { ...row, upload: { ...upload, session, phase, status: "uploading" } }
              : row,
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
          const phase = stage === "confirm" ? "confirm" : "put";
          setUploads((prev) =>
            prev.map((row) =>
              row.id === id
                ? {
                    ...row,
                    upload: {
                      ...upload,
                      session,
                      phase,
                      status: "error",
                      error: errorMessage(cause),
                    },
                  }
                : row,
            ),
          );
        },
        onSuccess: (item) => {
          cacheConfirmedItemUpload(queryClient, item, {
            listQueryKey: itemsQueryKey(activeSearch, activeWhere, order),
            refetchLists: true,
          });
          setUploads((prev) => prev.filter((row) => row.id !== id));
          const thumbnailUpload = Effect.promise(() => thumbnailJob).pipe(
            Effect.flatMap((thumbnail) =>
              thumbnail
                ? keva.setThumbnailEffect(
                    item.id,
                    { contentType: thumbnail.contentType, size: thumbnail.blob.size },
                    thumbnail.blob,
                  )
                : Effect.void,
            ),
            Effect.catch((error) =>
              Effect.sync(() => console.warn("Could not upload video thumbnail", error)),
            ),
          );
          void Effect.runPromiseExit(thumbnailUpload);
        },
      }),
    );
  };

  const runUploads = (
    entries: ReadonlyArray<{ readonly id: string; readonly upload: PendingUpload }>,
  ) => {
    const controller = new AbortController();
    controllers.current.add(controller);
    const workflow = Effect.forEach(entries, (entry) => uploadOne(entry.id, entry.upload), {
      concurrency: 3,
      discard: true,
    }).pipe(Effect.ensuring(Effect.sync(() => controllers.current.delete(controller))));
    void Effect.runPromiseExit(workflow, { signal: controller.signal });
  };

  const startUploads = (files: File[]) => {
    const entries = files.map((file) => {
      const upload: PendingUpload = {
        status: "uploading",
        file,
        input: { properties: uploadStamp, source: "upload" },
        phase: "put",
      };
      return { id: `upload:${crypto.randomUUID()}`, upload };
    });
    setUploads((prev) => [
      ...entries.map((entry) => optimisticRow(entry.id, entry.upload.file, entry.upload)),
      ...prev,
    ]);
    runUploads(entries);
  };

  const retryUpload = (row: UploadQueueRow) => {
    const upload = row.upload;
    if (!upload) return;
    const session =
      upload.phase === "put" && upload.session && isUploadSessionExpired(upload.session)
        ? undefined
        : upload.session;
    const { error: _error, ...retryBase } = upload;
    const retry: PendingUpload = {
      ...retryBase,
      session,
      phase: session ? upload.phase : "put",
      status: "uploading",
    };
    setUploads((prev) =>
      prev.map((current) => (current.id === row.id ? { ...current, upload: retry } : current)),
    );
    runUploads([{ id: row.id, upload: retry }]);
  };

  return { uploads, startUploads, retryUpload };
}
