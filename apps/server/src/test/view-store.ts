import type { ViewRecord } from "@keva/schema";
import { Effect } from "effect";
import type { ViewStoreService } from "../views.js";

export const makeInMemoryViewStore = (
  views: Map<string, ViewRecord> = new Map(),
): ViewStoreService => ({
  create: (tenantId, input) =>
    Effect.sync(() => {
      const id = crypto.randomUUID().replaceAll("-", "");
      const now = new Date().toISOString();
      const record: ViewRecord = {
        id,
        tenantId,
        name: input.name,
        icon: input.icon ?? null,
        conditions: [...input.conditions],
        createdAt: now,
        updatedAt: now,
      };
      views.set(id, record);
      return record;
    }),
  list: (tenantId) => Effect.sync(() => [...views.values()].filter((v) => v.tenantId === tenantId)),
  get: (tenantId, id) =>
    Effect.sync(() => {
      const view = views.get(id);
      return view && view.tenantId === tenantId ? view : null;
    }),
  update: (tenantId, id, input) =>
    Effect.sync(() => {
      const view = views.get(id);
      if (!view || view.tenantId !== tenantId) return null;
      const next: ViewRecord = {
        id: view.id,
        tenantId: view.tenantId,
        name: input.name ?? view.name,
        icon: input.icon === undefined ? view.icon : input.icon,
        conditions: input.conditions === undefined ? view.conditions : [...input.conditions],
        createdAt: view.createdAt,
        updatedAt: new Date().toISOString(),
      };
      views.set(id, next);
      return next;
    }),
  delete: (tenantId, id) =>
    Effect.sync(() => {
      const view = views.get(id);
      if (!view || view.tenantId !== tenantId) return false;
      return views.delete(id);
    }),
});
