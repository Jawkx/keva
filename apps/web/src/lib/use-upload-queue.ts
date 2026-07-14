import { useCallback, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { PropertyValue, QueryCondition } from "@keva/schema";
import {
  isUploadSessionExpired,
  type InitiateUpload,
  type ItemUploadSession,
  type KevaItem,
} from "@keva/sdk";
import { errorMessage } from "./errors";
import { cacheConfirmedItemUpload, itemsQueryKey } from "./items-cache";
import { keva } from "./keva";

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

const optimisticRow = (id: string, file: File, upload: PendingUpload): UploadQueueRow => {
  const now = new Date().toISOString();
  return {
    id,
    name: file.name,
    contentType: file.type || "application/octet-stream",
    declaredSize: file.size,
    size: file.size,
    etag: null,
    checksum: null,
    source: "upload",
    status: "pending",
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
  uploadStamp,
}: {
  readonly queryClient: QueryClient;
  readonly activeSearch: string;
  readonly activeWhere: readonly QueryCondition[];
  readonly uploadStamp: Record<string, PropertyValue>;
}) {
  const [uploads, setUploads] = useState<UploadQueueRow[]>([]);

  const uploadOne = useCallback(
    async (id: string, upload: PendingUpload) => {
      let session = upload.session;
      let phase = upload.phase;
      try {
        if (phase === "put" && session && isUploadSessionExpired(session)) session = undefined;
        if (!session) {
          phase = "put";
          session = await keva.startUpload({
            name: upload.file.name,
            contentType: upload.file.type || "application/octet-stream",
            size: upload.file.size,
            ...upload.input,
          });
          setUploads((prev) =>
            prev.map((row) =>
              row.id === id
                ? { ...row, upload: { ...upload, session, phase, status: "uploading" } }
                : row,
            ),
          );
        }
        if (phase === "put") {
          await keva.putUpload(session, upload.file);
          phase = "confirm";
        }
        const item = await keva.completeUpload(session);
        cacheConfirmedItemUpload(queryClient, item, {
          listQueryKey: itemsQueryKey(activeSearch, activeWhere, "created_at_desc"),
          refetchLists: Boolean(activeSearch.trim() || activeWhere.length > 0),
        });
        setUploads((prev) => prev.filter((row) => row.id !== id));
      } catch (error) {
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
                    error: errorMessage(error),
                  },
                }
              : row,
          ),
        );
      }
    },
    [activeSearch, activeWhere, queryClient],
  );

  const startUploads = useCallback(
    (files: File[]) => {
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
      for (const entry of entries) void uploadOne(entry.id, entry.upload);
    },
    [uploadOne, uploadStamp],
  );

  const retryUpload = useCallback(
    (row: UploadQueueRow) => {
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
      void uploadOne(row.id, retry);
    },
    [uploadOne],
  );

  return { uploads, startUploads, retryUpload };
}
