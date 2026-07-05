import type { CreateShareGrant } from "@keva/schema";
import { keva } from "./keva";

// Owner-side share management goes through the cookie-authed `keva` singleton
// (same as tokens). The public share page uses a separate ShareClient instead.
export const sharesQueryKey = ["shares"] as const;

export const listShares = () => keva.listShares();
export const createShare = (input: CreateShareGrant) => keva.createShare(input);
export const revokeShare = (id: string) => keva.revokeShare(id);
