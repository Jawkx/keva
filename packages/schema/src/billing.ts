import { Schema } from "effect";

export const BillingPlanSlug = Schema.Literals(["100gb", "500gb", "1tb", "2tb"]);
export type BillingPlanSlug = typeof BillingPlanSlug.Type;

export interface BillingPlanDefinition {
  readonly slug: BillingPlanSlug;
  readonly name: string;
  readonly storageBytes: number;
  readonly storedItems: number;
  readonly monthlyUploads: number;
  readonly monthlyApiRequests: number;
  readonly priceCents: number;
}

export const BILLING_PLANS: ReadonlyArray<BillingPlanDefinition> = [
  {
    slug: "100gb",
    name: "100 GB",
    storageBytes: 100_000_000_000,
    storedItems: 100_000,
    monthlyUploads: 100_000,
    monthlyApiRequests: 1_000_000,
    priceCents: 1_200,
  },
  {
    slug: "500gb",
    name: "500 GB",
    storageBytes: 500_000_000_000,
    storedItems: 500_000,
    monthlyUploads: 500_000,
    monthlyApiRequests: 5_000_000,
    priceCents: 2_900,
  },
  {
    slug: "1tb",
    name: "1 TB",
    storageBytes: 1_000_000_000_000,
    storedItems: 1_000_000,
    monthlyUploads: 1_000_000,
    monthlyApiRequests: 10_000_000,
    priceCents: 5_500,
  },
  {
    slug: "2tb",
    name: "2 TB",
    storageBytes: 2_000_000_000_000,
    storedItems: 2_000_000,
    monthlyUploads: 2_000_000,
    monthlyApiRequests: 20_000_000,
    priceCents: 9_900,
  },
];

export const TRIAL_LIMITS = {
  storageBytes: 1_000_000_000,
  storedItems: 1_000,
  monthlyUploads: 1_000,
  monthlyApiRequests: 10_000,
} as const;

export const BillingSubscriptionStatus = Schema.Literals([
  "unsubscribed",
  "trialing",
  "active",
  "past_due",
  "canceled",
]);
export type BillingSubscriptionStatus = typeof BillingSubscriptionStatus.Type;

export const BillingPlan = Schema.Struct({
  slug: BillingPlanSlug,
  name: Schema.String,
  storageBytes: Schema.Number,
  storedItems: Schema.Number,
  monthlyUploads: Schema.Number,
  monthlyApiRequests: Schema.Number,
  priceCents: Schema.Number,
  productId: Schema.String,
});
export type BillingPlan = typeof BillingPlan.Type;

export const BillingStatus = Schema.Struct({
  status: BillingSubscriptionStatus,
  plan: Schema.NullOr(BillingPlanSlug),
  productId: Schema.NullOr(Schema.String),
  subscriptionId: Schema.NullOr(Schema.String),
  currentPeriodStart: Schema.NullOr(Schema.String),
  currentPeriodEnd: Schema.NullOr(Schema.String),
  trialEndsAt: Schema.NullOr(Schema.String),
  pendingPlan: Schema.NullOr(BillingPlanSlug),
  pendingPlanAppliesAt: Schema.NullOr(Schema.String),
  cancelAtPeriodEnd: Schema.Boolean,
  graceEndsAt: Schema.NullOr(Schema.String),
});
export type BillingStatus = typeof BillingStatus.Type;

export const BillingOverview = Schema.Struct({
  status: BillingStatus,
  plans: Schema.Array(BillingPlan),
});
export type BillingOverview = typeof BillingOverview.Type;

export const ChangeBillingPlan = Schema.Struct({ plan: BillingPlanSlug });
export type ChangeBillingPlan = typeof ChangeBillingPlan.Type;

export const ChangeBillingPlanResult = Schema.Struct({
  changed: Schema.Boolean,
  effectiveAt: Schema.NullOr(Schema.String),
});
export type ChangeBillingPlanResult = typeof ChangeBillingPlanResult.Type;

export const CancelBillingPlanChangeResult = Schema.Struct({ canceled: Schema.Boolean });
export type CancelBillingPlanChangeResult = typeof CancelBillingPlanChangeResult.Type;
