import { useSyncExternalStore } from "react";

export type FileLayout = "list" | "grid";

export const FILE_LAYOUT_STORAGE_KEY = "keva:file-layout:v1";

const listeners = new Set<() => void>();
let memoryLayout: FileLayout = "list";

const isFileLayout = (value: string | null): value is FileLayout =>
  value === "list" || value === "grid";

export const readFileLayout = (storage?: Pick<Storage, "getItem">): FileLayout => {
  const value = storage?.getItem(FILE_LAYOUT_STORAGE_KEY) ?? null;
  return isFileLayout(value) ? value : "list";
};

const snapshot = () => {
  if (typeof window === "undefined") return memoryLayout;
  return readFileLayout(window.localStorage);
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === FILE_LAYOUT_STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

export const setFileLayout = (layout: FileLayout) => {
  memoryLayout = layout;
  if (typeof window !== "undefined") window.localStorage.setItem(FILE_LAYOUT_STORAGE_KEY, layout);
  listeners.forEach((listener) => listener());
};

export const useFileLayout = () =>
  useSyncExternalStore(subscribe, snapshot, () => "list" as FileLayout);
