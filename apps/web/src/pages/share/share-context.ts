import type { ShareClient, ShareSelf } from "@keva/sdk";
import { createContext, useContext } from "react";

export interface ShareContextValue {
  readonly client: ShareClient;
  readonly self: ShareSelf;
  readonly onGone: () => void;
}

const ShareContext = createContext<ShareContextValue | null>(null);

export const ShareContextProvider = ShareContext.Provider;

export const useShare = (): ShareContextValue => {
  const value = useContext(ShareContext);
  if (!value) throw new Error("useShare must be used within a ShareContextProvider");
  return value;
};
