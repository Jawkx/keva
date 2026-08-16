import {
  type AccountShareRecord,
  Conflict,
  Forbidden,
  NotFound,
  type ReceivedShare,
  ValidationError,
  isPropertyKey,
  propertiesMatchCondition,
  type Principal,
  type ShareGrantRecord,
  type Scope,
  type ViewRecord,
} from "@keva/schema";
import { Effect } from "effect";
import type { ShareGrantStoreService } from "../shares.js";

interface StoredGrant {
  id: string;
  tenantId: string;
  viewId: string;
  name: string;
  scopes: ShareGrantRecord["scopes"];
  writeStamp: ShareGrantRecord["writeStamp"];
  allowOwnDelete: boolean;
  maxItemBytes: number | null;
  maxTotalBytes: number | null;
  maxItems: number | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
}

interface TestUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

const sharePerson = (user: TestUser) => ({
  ...user,
  avatar: { version: 1 as const, seed: user.id },
});

type SharePrincipal = Extract<Principal, { readonly via: "share" }>;
type ShareContext = NonNullable<SharePrincipal["share"]>;

interface ShareContextBuilder {
  grantId: ShareContext["grantId"];
  identityId?: ShareContext["identityId"];
  conditions: ShareContext["conditions"];
  writeStamp?: ShareContext["writeStamp"];
  allowOwnDelete: ShareContext["allowOwnDelete"];
  limits: ShareContext["limits"];
}

interface ViewRecordBuilder {
  id: string;
  tenantId: string;
  name: string;
  icon: string | null;
  conditions: ViewRecord["conditions"];
  createdAt: string;
  updatedAt: string;
}

interface StoredAccountGrant {
  readonly owner: TestUser;
  readonly recipient: TestUser;
  status: "pending" | "accepted";
  readonly createdAt: string;
  acceptedAt: string | null;
}

export const makeInMemoryShareGrantStore = (
  views: Map<string, ViewRecord> = new Map(),
  users: ReadonlyArray<TestUser> = [],
): ShareGrantStoreService => {
  const grants = new Map<string, { grant: StoredGrant; secret: string }>();
  const accounts = new Map<string, StoredAccountGrant>();
  const conditionsFor = (viewId: string) => [...(views.get(viewId)?.conditions ?? [])];

  const toRecord = (grant: StoredGrant): ShareGrantRecord => ({
    id: grant.id,
    tenantId: grant.tenantId,
    viewId: grant.viewId,
    name: grant.name,
    scopes: [...grant.scopes],
    conditions: conditionsFor(grant.viewId),
    writeStamp: grant.writeStamp,
    allowOwnDelete: grant.allowOwnDelete,
    maxItemBytes: grant.maxItemBytes,
    maxTotalBytes: grant.maxTotalBytes,
    maxItems: grant.maxItems,
    createdAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    lastUsedAt: grant.lastUsedAt,
  });

  const toAccountRecord = (
    grant: StoredGrant,
    account: StoredAccountGrant,
  ): AccountShareRecord => ({
    id: grant.id,
    tenantId: grant.tenantId,
    viewId: grant.viewId,
    name: grant.name,
    scopes: [...grant.scopes],
    conditions: conditionsFor(grant.viewId),
    writeStamp: grant.writeStamp,
    allowOwnDelete: grant.allowOwnDelete,
    maxItemBytes: grant.maxItemBytes,
    maxTotalBytes: grant.maxTotalBytes,
    maxItems: grant.maxItems,
    status: account.status,
    recipient: sharePerson(account.recipient),
    createdAt: account.createdAt,
    acceptedAt: account.acceptedAt,
    expiresAt: grant.expiresAt,
  });

  const toReceived = (grant: StoredGrant, account: StoredAccountGrant): ReceivedShare => ({
    id: grant.id,
    name: views.get(grant.viewId)?.name ?? grant.name,
    icon: views.get(grant.viewId)?.icon ?? null,
    scopes: [...grant.scopes],
    allowOwnDelete: grant.allowOwnDelete,
    status: account.status,
    owner: sharePerson(account.owner),
    createdAt: account.createdAt,
    acceptedAt: account.acceptedAt,
    expiresAt: grant.expiresAt,
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
        const share: ShareContextBuilder = {
          grantId: g.id,
          conditions: conditionsFor(g.viewId),
          allowOwnDelete: g.allowOwnDelete,
          limits: {
            maxItemBytes: g.maxItemBytes,
            maxTotalBytes: g.maxTotalBytes,
            maxItems: g.maxItems,
          },
        };
        if (g.writeStamp) share.writeStamp = g.writeStamp;
        return {
          tenantId: g.tenantId,
          scopes: [...g.scopes],
          via: "share",
          share,
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
            scopes: [...input.scopes],
            writeStamp: input.writeStamp ?? null,
            allowOwnDelete: input.allowOwnDelete ?? false,
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
          .filter((grant) => grant.tenantId === tenantId && !accounts.has(grant.id))
          .map(toRecord),
      ),
    get: (tenantId, id) =>
      Effect.sync(() => {
        const entry = grants.get(id);
        return entry && entry.grant.tenantId === tenantId && !accounts.has(id)
          ? toRecord(entry.grant)
          : null;
      }),
    revoke: (tenantId, id) =>
      Effect.sync(() => {
        const entry = grants.get(id);
        if (!entry || entry.grant.tenantId !== tenantId || accounts.has(id)) return false;
        return grants.delete(id);
      }),
    createAccount: (tenantId, ownerUserId, input) =>
      Effect.gen(function* () {
        const result = yield* Effect.sync(() => {
          const owner = users.find((user) => user.id === ownerUserId);
          if (!owner) return { status: "owner_missing" as const };
          const recipient = users.find(
            (user) => user.email.toLowerCase() === input.recipientEmail.trim().toLowerCase(),
          );
          if (!recipient) return { status: "recipient_missing" as const };
          if (recipient.id === owner.id) return { status: "self" as const };
          const view = views.get(input.viewId);
          if (!view || view.tenantId !== tenantId) return { status: "view_missing" as const };
          if (
            [...accounts.entries()].some(([grantId, account]) => {
              const grant = grants.get(grantId)?.grant;
              return (
                account.recipient.id === recipient.id &&
                grant?.tenantId === tenantId &&
                grant.viewId === view.id &&
                (!grant.expiresAt || new Date(grant.expiresAt) > new Date())
              );
            })
          ) {
            return { status: "duplicate" as const };
          }
          if (input.scopes.includes("write")) {
            if (!view.conditions.every((condition) => isPropertyKey(condition.key))) {
              return {
                status: "invalid" as const,
                message: "Write grants may only condition on plain property keys",
              };
            }
            if (
              !view.conditions.every((condition) =>
                propertiesMatchCondition(input.writeStamp!, condition),
              )
            ) {
              return {
                status: "invalid" as const,
                message: "writeStamp must satisfy every view condition",
              };
            }
          }
          const id = crypto.randomUUID().replaceAll("-", "");
          const grant: StoredGrant = {
            id,
            tenantId,
            viewId: view.id,
            name: view.name,
            scopes: [...input.scopes],
            writeStamp: input.writeStamp ?? null,
            allowOwnDelete: input.allowOwnDelete ?? false,
            maxItemBytes: input.maxItemBytes ?? null,
            maxTotalBytes: input.maxTotalBytes ?? null,
            maxItems: input.maxItems ?? null,
            createdAt: new Date().toISOString(),
            expiresAt: input.expiresAt ?? null,
            lastUsedAt: null,
          };
          const account: StoredAccountGrant = {
            owner,
            recipient,
            status: "pending",
            createdAt: grant.createdAt,
            acceptedAt: null,
          };
          grants.set(id, { grant, secret: crypto.randomUUID() });
          accounts.set(id, account);
          return { status: "created" as const, record: toAccountRecord(grant, account) };
        });
        if (result.status === "recipient_missing") {
          return yield* new NotFound({ message: "No Keva account exists for that email" });
        }
        if (result.status === "owner_missing") {
          return yield* new NotFound({ message: "Owner account not found" });
        }
        if (result.status === "view_missing") {
          return yield* new NotFound({ message: "View not found" });
        }
        if (result.status === "self") {
          return yield* new ValidationError({ message: "You already own this view" });
        }
        if (result.status === "invalid") {
          return yield* new ValidationError({ message: result.message });
        }
        if (result.status === "duplicate") {
          return yield* new Conflict({ message: "This view is already shared with that account" });
        }
        return result.record;
      }),
    listAccountOwned: (tenantId) =>
      Effect.sync(() =>
        [...accounts.entries()]
          .map(([id, account]) => ({ grant: grants.get(id)?.grant, account }))
          .filter(
            (entry): entry is { grant: StoredGrant; account: StoredAccountGrant } =>
              entry.grant?.tenantId === tenantId,
          )
          .map(({ grant, account }) => toAccountRecord(grant, account)),
      ),
    listReceived: (recipientUserId) =>
      Effect.sync(() =>
        [...accounts.entries()]
          .map(([id, account]) => ({ grant: grants.get(id)?.grant, account }))
          .filter(
            (entry): entry is { grant: StoredGrant; account: StoredAccountGrant } =>
              entry.account.recipient.id === recipientUserId &&
              entry.grant !== undefined &&
              (!entry.grant.expiresAt || new Date(entry.grant.expiresAt) > new Date()),
          )
          .map(({ grant, account }) => toReceived(grant, account)),
      ),
    acceptAccount: (recipientUserId, id) =>
      Effect.sync(() => {
        const grant = grants.get(id)?.grant;
        const account = accounts.get(id);
        if (
          !grant ||
          !account ||
          account.recipient.id !== recipientUserId ||
          (grant.expiresAt && new Date(grant.expiresAt) <= new Date())
        ) {
          return null;
        }
        if (account.status === "pending") {
          account.status = "accepted";
          account.acceptedAt = new Date().toISOString();
        }
        return toReceived(grant, account);
      }),
    declineAccount: (recipientUserId, id) =>
      Effect.sync(() => {
        const account = accounts.get(id);
        if (!account || account.recipient.id !== recipientUserId || account.status !== "pending") {
          return false;
        }
        accounts.delete(id);
        return grants.delete(id);
      }),
    leaveAccount: (recipientUserId, id) =>
      Effect.sync(() => {
        const account = accounts.get(id);
        if (!account || account.recipient.id !== recipientUserId) return false;
        accounts.delete(id);
        return grants.delete(id);
      }),
    revokeAccount: (tenantId, id) =>
      Effect.sync(() => {
        const grant = grants.get(id)?.grant;
        if (!grant || grant.tenantId !== tenantId || !accounts.has(id)) return false;
        accounts.delete(id);
        return grants.delete(id);
      }),
    accessAccount: (recipient, id) =>
      Effect.sync(() => {
        const grant = grants.get(id)?.grant;
        const account = accounts.get(id);
        if (
          !grant ||
          !account ||
          account.recipient.id !== recipient.id ||
          account.status !== "accepted" ||
          (grant.expiresAt && new Date(grant.expiresAt) <= new Date())
        ) {
          return null;
        }
        const share: ShareContextBuilder = {
          grantId: grant.id,
          identityId: recipient.id,
          conditions: conditionsFor(grant.viewId),
          allowOwnDelete: grant.allowOwnDelete,
          limits: {
            maxItemBytes: grant.maxItemBytes,
            maxTotalBytes: grant.maxTotalBytes,
            maxItems: grant.maxItems,
          },
        };
        if (grant.writeStamp) share.writeStamp = grant.writeStamp;
        return {
          principal: {
            tenantId: grant.tenantId,
            scopes: [...grant.scopes],
            via: "share",
            actor: {
              user: recipient,
              share: { grantId: grant.id, name: grant.name },
            },
            share,
          },
          received: toReceived(grant, account),
          grant: toAccountRecord(grant, account),
        };
      }),
    updateView: (principal, id, input) =>
      Effect.gen(function* () {
        const result = yield* Effect.sync(() => {
          const view = views.get(id);
          if (!view || view.tenantId !== principal.tenantId) return { status: "missing" as const };
          const conditions = input.conditions ?? view.conditions;
          const activeGrants = [...grants.values()]
            .map((entry) => entry.grant)
            .filter(
              (grant) =>
                grant.tenantId === principal.tenantId &&
                grant.viewId === id &&
                (!grant.expiresAt || new Date(grant.expiresAt) > new Date()),
            );
          const requiredScopes: Scope[] = ["views"];
          if (activeGrants.length > 0) requiredScopes.push("shares");
          requiredScopes.push(...new Set(activeGrants.flatMap((grant) => grant.scopes)));
          if (
            !(
              (principal.via === "session" && principal.scopes.includes("admin")) ||
              requiredScopes.every((scope) => principal.scopes.includes(scope))
            )
          ) {
            return { status: "forbidden" as const, requiredScopes };
          }
          const grantIds = activeGrants
            .filter(
              (grant) =>
                grant.scopes.includes("write") &&
                (!conditions.every((condition) => isPropertyKey(condition.key)) ||
                  !conditions.every((condition) =>
                    propertiesMatchCondition(grant.writeStamp ?? {}, condition),
                  )),
            )
            .map((grant) => grant.id);
          if (grantIds.length > 0) return { status: "incompatible" as const, grantIds };
          const next: ViewRecordBuilder = {
            ...view,
            updatedAt: new Date().toISOString(),
          };
          if (input.name !== undefined) next.name = input.name;
          if (input.icon !== undefined) next.icon = input.icon;
          if (input.conditions !== undefined) next.conditions = [...input.conditions];
          views.set(id, next);
          return { status: "updated" as const, view: next };
        });
        if (result.status === "incompatible") {
          return yield* new Conflict({
            message: "Revoke the affected upload links before changing this view's conditions",
            grantIds: result.grantIds,
          });
        }
        if (result.status === "forbidden") {
          return yield* new Forbidden({
            message: `Missing required scopes: ${result.requiredScopes.join(", ")}`,
          });
        }
        return result.status === "updated" ? result.view : null;
      }),
  };
};
