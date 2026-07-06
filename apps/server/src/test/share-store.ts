import type { CreateShareGrantResult, Principal, ShareGrantRecord, ViewRecord } from "@keva/schema";
import { Effect } from "effect";
import type { ShareGrantStoreService } from "../shares.js";

interface StoredGrant {
  id: string;
  tenantId: string;
  viewId: string;
  name: string;
  scopes: ShareGrantRecord["scopes"];
  writeStamp: ShareGrantRecord["writeStamp"];
  maxItemBytes: number | null;
  maxTotalBytes: number | null;
  maxItems: number | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

// A minimal in-memory ShareGrantStore for server tests: mints
// `keva_sh_<id>_<secret>` tokens and resolves them back to a share principal.
// Conditions are read live from the referenced view (pass the same `views` Map
// used by the in-memory ViewStore), mirroring the Postgres store's JOIN. Non-
// share suites use it as an empty store (resolve → null); the shares suite
// drives the full create → redeem → list → revoke flow without Postgres.
export const makeInMemoryShareGrantStore = (
  views: Map<string, ViewRecord> = new Map(),
): ShareGrantStoreService => {
  const grants = new Map<string, { grant: StoredGrant; secret: string }>();
  const conditionsFor = (viewId: string) => [...(views.get(viewId)?.conditions ?? [])];

  const toRecord = (grant: StoredGrant): ShareGrantRecord => ({
    id: grant.id,
    tenantId: grant.tenantId,
    viewId: grant.viewId,
    name: grant.name,
    scopes: [...grant.scopes],
    conditions: conditionsFor(grant.viewId),
    writeStamp: grant.writeStamp,
    maxItemBytes: grant.maxItemBytes,
    maxTotalBytes: grant.maxTotalBytes,
    maxItems: grant.maxItems,
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    lastUsedAt: grant.lastUsedAt,
  });

  return {
    resolve: (token) =>
      Effect.sync(() => {
        const match = /^keva_sh_([^_]+)_(.+)$/.exec(token);
        if (!match) return null;
        const [, id, secret] = match;
        const entry = grants.get(id!);
        if (!entry || entry.secret !== secret) return null;
        const g = entry.grant;
        if (g.expiresAt && new Date(g.expiresAt) <= new Date()) return null;
        return {
          tenantId: g.tenantId,
          scopes: [...g.scopes],
          via: "share",
          share: {
            grantId: g.id,
            conditions: conditionsFor(g.viewId),
            ...(g.writeStamp ? { writeStamp: g.writeStamp } : {}),
            limits: {
              maxItemBytes: g.maxItemBytes,
              maxTotalBytes: g.maxTotalBytes,
              maxItems: g.maxItems,
            },
          },
        } satisfies Principal;
      }),
    create: (tenantId, input) =>
      Effect.sync<CreateShareGrantResult>(() => {
        const id = crypto.randomUUID().replaceAll("-", "");
        const secret = crypto.randomUUID().replaceAll("-", "");
        const grant: StoredGrant = {
          id,
          tenantId,
          viewId: input.viewId,
          name: input.name,
          scopes: [...input.scopes],
          writeStamp: input.writeStamp ?? null,
          maxItemBytes: input.maxItemBytes ?? null,
          maxTotalBytes: input.maxTotalBytes ?? null,
          maxItems: input.maxItems ?? null,
          createdAt: new Date().toISOString(),
          expiresAt: input.expiresAt ?? null,
          lastUsedAt: null,
        };
        grants.set(id, { grant, secret });
        return { token: `keva_sh_${id}_${secret}`, record: toRecord(grant) };
      }),
    list: (tenantId) =>
      Effect.sync(() =>
        [...grants.values()]
          .map((entry) => entry.grant)
          .filter((grant) => grant.tenantId === tenantId)
          .map(toRecord),
      ),
    get: (tenantId, id) =>
      Effect.sync(() => {
        const entry = grants.get(id);
        return entry && entry.grant.tenantId === tenantId ? toRecord(entry.grant) : null;
      }),
    revoke: (tenantId, id) =>
      Effect.sync(() => {
        const entry = grants.get(id);
        if (!entry || entry.grant.tenantId !== tenantId) return false;
        return grants.delete(id);
      }),
  };
};
