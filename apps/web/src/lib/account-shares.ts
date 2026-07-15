import type { CreateAccountShare } from "@keva/schema";
import { keva } from "./keva";

export const accountSharesQueryKey = ["account-shares"] as const;
export const receivedSharesQueryKey = ["received-shares"] as const;

export const listAccountShares = () => keva.listAccountShares();
export const createAccountShare = (input: CreateAccountShare) => keva.createAccountShare(input);
export const revokeAccountShare = (id: string) => keva.revokeAccountShare(id);
export const listReceivedShares = () => keva.listReceivedShares();
export const acceptReceivedShare = (id: string) => keva.acceptReceivedShare(id);
export const declineReceivedShare = (id: string) => keva.declineReceivedShare(id);
export const leaveReceivedShare = (id: string) => keva.leaveReceivedShare(id);
