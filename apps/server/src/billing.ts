import {
  BILLING_PLANS,
  TRIAL_LIMITS,
  RateLimitExceeded,
  type BillingOverview,
  type BillingPlanDefinition,
  type BillingPlanSlug,
  type BillingStatus,
  type Principal,
} from "@keva/schema";
import type { Subscription } from "@polar-sh/sdk/models/components/subscription";
import { Context, Effect, Layer } from "effect";
import type { Sql } from "postgres";

const PAST_DUE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PolarProductIds {
  readonly "100gb": string;
  readonly "500gb": string;
  readonly "1tb": string;
  readonly "2tb": string;
}

export interface BillingConfig {
  readonly products: PolarProductIds;
}

interface BillingRow {
  readonly status: BillingStatus["status"];
  readonly plan_slug: BillingPlanSlug | null;
  readonly polar_product_id: string | null;
  readonly polar_subscription_id: string | null;
  readonly current_period_start: Date | string | null;
  readonly current_period_end: Date | string | null;
  readonly trial_ends_at: Date | string | null;
  readonly cancel_at_period_end: boolean;
  readonly grace_ends_at: Date | string | null;
}

const iso = (value: Date | string | null): string | null =>
  value === null
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();

const statusFromRow = (row?: BillingRow): BillingStatus => ({
  status: row?.status ?? "unsubscribed",
  plan: row?.plan_slug ?? null,
  productId: row?.polar_product_id ?? null,
  subscriptionId: row?.polar_subscription_id ?? null,
  currentPeriodStart: iso(row?.current_period_start ?? null),
  currentPeriodEnd: iso(row?.current_period_end ?? null),
  trialEndsAt: iso(row?.trial_ends_at ?? null),
  cancelAtPeriodEnd: row?.cancel_at_period_end ?? false,
  graceEndsAt: iso(row?.grace_ends_at ?? null),
});

const planForProduct = (config: BillingConfig, productId: string): BillingPlanDefinition | null => {
  const entry = Object.entries(config.products).find(([, id]) => id === productId);
  return entry ? (BILLING_PLANS.find((plan) => plan.slug === entry[0]) ?? null) : null;
};

const metadataMatches = (subscription: Subscription, plan: BillingPlanDefinition): boolean => {
  const metadata = subscription.product.metadata;
  return (
    metadata.keva_plan === plan.slug &&
    metadata.storage_bytes === plan.storageBytes &&
    metadata.stored_items === plan.storedItems &&
    metadata.monthly_uploads === plan.monthlyUploads &&
    metadata.monthly_api_requests === plan.monthlyApiRequests
  );
};

export interface BillingStore {
  readonly ensureUnsubscribed: (userId: string, tenantId: string) => Promise<void>;
  readonly getOverview: (tenantId: string) => Promise<BillingOverview>;
  readonly syncSubscription: (
    userId: string,
    tenantId: string,
    subscription: Subscription,
    eventAt: Date,
  ) => Promise<void>;
  readonly consumeApiRequest: (tenantId: string) => Effect.Effect<void, RateLimitExceeded>;
  readonly currentSubscription: (
    tenantId: string,
  ) => Promise<{ readonly id: string; readonly plan: BillingPlanSlug } | null>;
  readonly canDowngrade: (tenantId: string, plan: BillingPlanSlug) => Promise<boolean>;
}

export interface BillingMeterService {
  readonly consumeApiRequest: (tenantId: string) => Effect.Effect<void, RateLimitExceeded>;
}

export class BillingMeter extends Context.Tag("@keva/server/BillingMeter")<
  BillingMeter,
  BillingMeterService
>() {}

export const BillingMeterLive = (store?: BillingStore): Layer.Layer<BillingMeter> =>
  Layer.succeed(BillingMeter, {
    consumeApiRequest: store ? store.consumeApiRequest : () => Effect.void,
  });

export const makeBillingStore = (sql: Sql, config: BillingConfig): BillingStore => ({
  ensureUnsubscribed: (userId, tenantId) =>
    sql.begin(async (transaction) => {
      await transaction`
        insert into tenant_usage (tenant_id, used_bytes, used_items, quota_bytes, quota_items)
        values (
          ${tenantId},
          (select coalesce(sum(coalesce(size, declared_size)), 0)::bigint from items where tenant_id = ${tenantId}),
          (select count(*)::bigint from items where tenant_id = ${tenantId}),
          0,
          0
        )
        on conflict (tenant_id) do nothing
      `;
      await transaction`
        insert into tenant_billing (
          tenant_id, user_id, status, monthly_uploads_limit,
          monthly_api_requests_limit, cancel_at_period_end, updated_at
        ) values (${tenantId}, ${userId}, 'unsubscribed', 0, 0, false, now())
        on conflict (tenant_id) do nothing
      `;
    }),
  getOverview: async (tenantId) => {
    const rows = await sql<BillingRow[]>`
      select status, plan_slug, polar_product_id, polar_subscription_id,
             current_period_start, current_period_end, trial_ends_at,
             cancel_at_period_end, grace_ends_at
      from tenant_billing where tenant_id = ${tenantId}
    `;
    return {
      status: statusFromRow(rows[0]),
      plans: BILLING_PLANS.map((plan) => ({
        ...plan,
        productId: config.products[plan.slug],
      })),
    };
  },
  syncSubscription: async (userId, tenantId, subscription, eventAt) => {
    const plan = planForProduct(config, subscription.productId);
    if (!plan || !metadataMatches(subscription, plan)) {
      throw new Error(`Unknown or invalid Polar product ${subscription.productId}`);
    }
    const status = ["active", "trialing", "past_due"].includes(subscription.status)
      ? subscription.status
      : "canceled";
    const limits =
      status === "trialing"
        ? TRIAL_LIMITS
        : status === "active" || status === "past_due"
          ? plan
          : { storageBytes: 0, storedItems: 0, monthlyUploads: 0, monthlyApiRequests: 0 };
    const graceEndsAt =
      status === "past_due" ? new Date(eventAt.getTime() + PAST_DUE_GRACE_MS).toISOString() : null;

    await sql.begin(async (transaction) => {
      const current = await transaction<{ last_polar_event_at: Date | string | null }[]>`
        select last_polar_event_at from tenant_billing where tenant_id = ${tenantId} for update
      `;
      const previousEvent = current[0]?.last_polar_event_at;
      if (previousEvent && new Date(previousEvent) > eventAt) return;
      await transaction`
        insert into tenant_billing (
          tenant_id, user_id, polar_customer_id, polar_subscription_id,
          polar_product_id, plan_slug, status, monthly_uploads_limit,
          monthly_api_requests_limit, current_period_start, current_period_end,
          trial_ends_at, grace_ends_at, cancel_at_period_end,
          last_polar_event_at, updated_at
        ) values (
          ${tenantId}, ${userId}, ${subscription.customerId}, ${subscription.id},
          ${subscription.productId}, ${plan.slug}, ${status}, ${limits.monthlyUploads},
          ${limits.monthlyApiRequests}, ${subscription.currentPeriodStart.toISOString()},
          ${subscription.currentPeriodEnd.toISOString()}, ${iso(subscription.trialEnd)},
          ${graceEndsAt}, ${subscription.cancelAtPeriodEnd}, ${eventAt.toISOString()}, now()
        )
        on conflict (tenant_id) do update set
          user_id = excluded.user_id,
          polar_customer_id = excluded.polar_customer_id,
          polar_subscription_id = excluded.polar_subscription_id,
          polar_product_id = excluded.polar_product_id,
          plan_slug = excluded.plan_slug,
          status = excluded.status,
          monthly_uploads_limit = excluded.monthly_uploads_limit,
          monthly_api_requests_limit = excluded.monthly_api_requests_limit,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          trial_ends_at = excluded.trial_ends_at,
          grace_ends_at = excluded.grace_ends_at,
          cancel_at_period_end = excluded.cancel_at_period_end,
          last_polar_event_at = excluded.last_polar_event_at,
          updated_at = now()
      `;
      await transaction`
        insert into tenant_usage (tenant_id, used_bytes, used_items, quota_bytes, quota_items)
        values (
          ${tenantId},
          (select coalesce(sum(coalesce(size, declared_size)), 0)::bigint from items where tenant_id = ${tenantId}),
          (select count(*)::bigint from items where tenant_id = ${tenantId}),
          ${limits.storageBytes},
          ${limits.storedItems}
        )
        on conflict (tenant_id) do update set
          quota_bytes = excluded.quota_bytes,
          quota_items = excluded.quota_items
      `;
      if (status === "active" || status === "trialing" || status === "past_due") {
        await transaction`
          insert into tenant_period_usage (
            tenant_id, period_start, period_end, uploads_used, uploads_reserved, api_requests_used
          ) values (
            ${tenantId}, ${subscription.currentPeriodStart.toISOString()},
            ${subscription.currentPeriodEnd.toISOString()}, 0, 0, 0
          )
          on conflict (tenant_id, period_start) do update set period_end = excluded.period_end
        `;
      }
    });
  },
  consumeApiRequest: (tenantId) =>
    Effect.tryPromise({
      try: async () => {
        const result = await sql.begin(async (transaction) => {
          const billing = await transaction<
            {
              status: string;
              grace_ends_at: Date | string | null;
              trial_ends_at: Date | string | null;
              current_period_start: Date | string | null;
              current_period_end: Date | string | null;
              monthly_api_requests_limit: string;
            }[]
          >`
            select status, grace_ends_at, trial_ends_at, current_period_start, current_period_end,
                   monthly_api_requests_limit
            from tenant_billing where tenant_id = ${tenantId} for update
          `;
          const row = billing[0];
          if (!row) return { allowed: true as const };
          const graceActive = row.grace_ends_at && new Date(row.grace_ends_at) > new Date();
          const trialActive =
            row.status === "trialing" &&
            row.trial_ends_at !== null &&
            new Date(row.trial_ends_at) > new Date();
          if (
            row.status !== "active" &&
            !trialActive &&
            !(row.status === "past_due" && graceActive)
          ) {
            return {
              allowed: false as const,
              resetsAt: iso(row.current_period_end) ?? new Date().toISOString(),
            };
          }
          if (!row.current_period_start || !row.current_period_end) {
            return { allowed: false as const, resetsAt: new Date().toISOString() };
          }
          const startsAt = iso(row.current_period_start)!;
          const endsAt = iso(row.current_period_end)!;
          await transaction`
            insert into tenant_period_usage (
              tenant_id, period_start, period_end, uploads_used, uploads_reserved, api_requests_used
            ) values (${tenantId}, ${startsAt}, ${endsAt}, 0, 0, 0)
            on conflict (tenant_id, period_start) do nothing
          `;
          const updated = await transaction`
            update tenant_period_usage
            set api_requests_used = api_requests_used + 1
            where tenant_id = ${tenantId} and period_start = ${startsAt}
              and api_requests_used < ${Number(row.monthly_api_requests_limit)}
            returning api_requests_used
          `;
          return updated.length === 1
            ? { allowed: true as const }
            : { allowed: false as const, resetsAt: endsAt };
        });
        if (!result.allowed) throw result;
      },
      catch: (error) => {
        const resetsAt =
          typeof error === "object" && error !== null && "resetsAt" in error
            ? String(error.resetsAt)
            : new Date().toISOString();
        return new RateLimitExceeded({ message: "Monthly API request limit reached", resetsAt });
      },
    }),
  currentSubscription: async (tenantId) => {
    const rows = await sql<
      { polar_subscription_id: string | null; plan_slug: BillingPlanSlug | null }[]
    >`
      select polar_subscription_id, plan_slug from tenant_billing where tenant_id = ${tenantId}
    `;
    const row = rows[0];
    return row?.polar_subscription_id && row.plan_slug
      ? { id: row.polar_subscription_id, plan: row.plan_slug }
      : null;
  },
  canDowngrade: async (tenantId, planSlug) => {
    const plan = BILLING_PLANS.find((candidate) => candidate.slug === planSlug)!;
    const rows = await sql<{ used_bytes: string; used_items: string }[]>`
      select used_bytes, used_items from tenant_usage where tenant_id = ${tenantId}
    `;
    const row = rows[0];
    return (
      !row ||
      (Number(row.used_bytes) <= plan.storageBytes && Number(row.used_items) <= plan.storedItems)
    );
  },
});

export const isProgrammaticPrincipal = (principal: Principal): boolean =>
  principal.via === "token" &&
  (principal.actor?.agent !== undefined ||
    (principal.actor?.token !== undefined && principal.actor.token.id !== "static"));
