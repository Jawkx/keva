import type { CreateShareGrantResult, Principal, ShareGrantRecord } from "@keva/schema";
import { Effect } from "effect";
import type { ShareGrantStoreService } from "../shares.js";

// A minimal in-memory ShareGrantStore for server tests: mints
// `keva_sh_<id>_<secret>` tokens and resolves them back to a share principal
// carrying the grant's conditions, write stamp, and quota limits. Non-share
// suites use it as an empty store (resolve → null); the shares suite drives the
// full create → redeem → list → revoke flow without Postgres.
export const makeInMemoryShareGrantStore = (): ShareGrantStoreService => {
  const records = new Map<string, { record: ShareGrantRecord; secret: string }>();

  return {
    resolve: (token) =>
      Effect.sync(() => {
        const match = /^keva_sh_([^_]+)_(.+)$/.exec(token);
        if (!match) return null;
        const [, id, secret] = match;
        const entry = records.get(id!);
        if (!entry || entry.secret !== secret) return null;
        const r = entry.record;
        if (r.expiresAt && new Date(r.expiresAt) <= new Date()) return null;
        return {
          tenantId: r.tenantId,
          scopes: [...r.scopes],
          via: "share",
          share: {
            grantId: r.id,
            conditions: [...r.conditions],
            ...(r.writeStamp ? { writeStamp: r.writeStamp } : {}),
            limits: {
              maxItemBytes: r.maxItemBytes,
              maxTotalBytes: r.maxTotalBytes,
              maxItems: r.maxItems,
            },
          },
        } satisfies Principal;
      }),
    create: (tenantId, input) =>
      Effect.sync<CreateShareGrantResult>(() => {
        const id = crypto.randomUUID().replaceAll("-", "");
        const secret = crypto.randomUUID().replaceAll("-", "");
        const record: ShareGrantRecord = {
          id,
          tenantId,
          name: input.name,
          scopes: [...input.scopes],
          conditions: [...input.conditions],
          writeStamp: input.writeStamp ?? null,
          maxItemBytes: input.maxItemBytes ?? null,
          maxTotalBytes: input.maxTotalBytes ?? null,
          maxItems: input.maxItems ?? null,
          createdAt: new Date().toISOString(),
          expiresAt: input.expiresAt ?? null,
          lastUsedAt: null,
        };
        records.set(id, { record, secret });
        return { token: `keva_sh_${id}_${secret}`, record };
      }),
    list: (tenantId) =>
      Effect.sync(() =>
        [...records.values()]
          .map((entry) => entry.record)
          .filter((record) => record.tenantId === tenantId),
      ),
    get: (tenantId, id) =>
      Effect.sync(() => {
        const entry = records.get(id);
        return entry && entry.record.tenantId === tenantId ? entry.record : null;
      }),
    revoke: (tenantId, id) =>
      Effect.sync(() => {
        const entry = records.get(id);
        if (!entry || entry.record.tenantId !== tenantId) return false;
        return records.delete(id);
      }),
  };
};
