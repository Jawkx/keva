import type { ShareAccessClient, ShareSelf } from "@keva/sdk";
import { createContext, useContext } from "react";

export interface ShareContextValue {
  readonly client: ShareAccessClient;
  readonly self: ShareSelf;
  readonly selfQueryKey: readonly unknown[];
  readonly onGone: () => void;
}

const ShareContext = createContext<ShareContextValue | null>(null);

export const ShareContextProvider = ShareContext.Provider;

export const useShare = (): ShareContextValue => {
  const value = useContext(ShareContext);
  if (!value) throw new Error("useShare must be used within a ShareContextProvider");
  return value;
};
