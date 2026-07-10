import type { CreateShareGrant } from "@keva/schema";
import { keva } from "./keva";

export const sharesQueryKey = ["shares"] as const;

export const listShares = () => keva.listShares();
export const createShare = (input: CreateShareGrant) => keva.createShare(input);
export const revokeShare = (id: string) => keva.revokeShare(id);
