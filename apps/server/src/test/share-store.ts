import {
  Conflict,
  NotFound,
  ValidationError,
  isPropertyKey,
  propertiesMatchCondition,
  type Principal,
  type ShareGrantRecord,
  type ViewRecord,
} from "@keva/schema";
import { Effect } from "effect";
import type { ShareGrantStoreService } from "../shares.js";

interface StoredGrant {
  id: string;
  tenantId: string;
  viewId: string;
  name: string;
  token: string;
  scopes: ShareGrantRecord["scopes"];
  writeStamp: ShareGrantRecord["writeStamp"];
  maxItemBytes: number | null;
  maxTotalBytes: number | null;
  maxItems: number | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

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
    token: grant.token,
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
      Effect.gen(function* () {
        const result = yield* Effect.sync(() => {
          const viewId = input.viewId ?? crypto.randomUUID().replaceAll("-", "");
          const conditions = input.view?.conditions ?? views.get(viewId)?.conditions;
          if (!conditions) return { status: "missing" as const };
          if (input.scopes.includes("write")) {
            if (!conditions.every((condition) => isPropertyKey(condition.key))) {
              return {
                status: "invalid" as const,
                message: "Write grants may only condition on plain property keys",
              };
            }
            if (
              !conditions.every((condition) =>
                propertiesMatchCondition(input.writeStamp!, condition),
              )
            ) {
              return {
                status: "invalid" as const,
                message: "writeStamp must satisfy every view condition",
              };
            }
          }
          if (input.view) {
            const now = new Date().toISOString();
            views.set(viewId, {
              id: viewId,
              tenantId,
              name: input.view.name,
              icon: input.view.icon ?? null,
              conditions: [...input.view.conditions],
              createdAt: now,
              updatedAt: now,
            });
          }
          const view = views.get(viewId);
          if (!view || view.tenantId !== tenantId) return { status: "missing" as const };
          const id = crypto.randomUUID().replaceAll("-", "");
          const secret = crypto.randomUUID().replaceAll("-", "");
          const grant: StoredGrant = {
            id,
            tenantId,
            viewId,
            name: input.name,
            token: `keva_sh_${id}_${secret}`,
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
          return {
            status: "created" as const,
            result: {
              token: `keva_sh_${id}_${secret}`,
              record: toRecord(grant),
              view,
            },
          };
        });
        if (result.status === "missing") return yield* new NotFound({ message: "View not found" });
        if (result.status === "invalid")
          return yield* new ValidationError({ message: result.message });
        return result.result;
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
    updateView: (tenantId, id, input) =>
      Effect.gen(function* () {
        const result = yield* Effect.sync(() => {
          const view = views.get(id);
          if (!view || view.tenantId !== tenantId) return { status: "missing" as const };
          const conditions = input.conditions ?? view.conditions;
          const grantIds = [...grants.values()]
            .map((entry) => entry.grant)
            .filter(
              (grant) =>
                grant.tenantId === tenantId &&
                grant.viewId === id &&
                grant.scopes.includes("write") &&
                (!grant.expiresAt || new Date(grant.expiresAt) > new Date()) &&
                (!conditions.every((condition) => isPropertyKey(condition.key)) ||
                  !conditions.every((condition) =>
                    propertiesMatchCondition(grant.writeStamp ?? {}, condition),
                  )),
            )
            .map((grant) => grant.id);
          if (grantIds.length > 0) return { status: "incompatible" as const, grantIds };
          const next: ViewRecord = {
            ...view,
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.icon === undefined ? {} : { icon: input.icon }),
            ...(input.conditions === undefined ? {} : { conditions: [...input.conditions] }),
            updatedAt: new Date().toISOString(),
          };
          views.set(id, next);
          return { status: "updated" as const, view: next };
        });
        if (result.status === "incompatible") {
          return yield* new Conflict({
            message: "Revoke the affected upload links before changing this view's conditions",
            grantIds: result.grantIds,
          });
        }
        return result.status === "updated" ? result.view : null;
      }),
  };
};
