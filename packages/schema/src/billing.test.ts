import { describe, expect, it } from "vitest";
import { BILLING_PLANS, TRIAL_LIMITS } from "./billing.js";

describe("billing plans", () => {
  it("keeps prices and limits monotonic", () => {
    expect(BILLING_PLANS.map((plan) => plan.priceCents)).toEqual([1_200, 2_900, 5_500, 9_900]);
    expect(BILLING_PLANS.map((plan) => plan.storageBytes)).toEqual([
      100_000_000_000, 500_000_000_000, 1_000_000_000_000, 2_000_000_000_000,
    ]);
    for (let index = 1; index < BILLING_PLANS.length; index++) {
      expect(BILLING_PLANS[index]!.storedItems).toBeGreaterThan(
        BILLING_PLANS[index - 1]!.storedItems,
      );
      expect(BILLING_PLANS[index]!.monthlyUploads).toBeGreaterThan(
        BILLING_PLANS[index - 1]!.monthlyUploads,
      );
      expect(BILLING_PLANS[index]!.monthlyApiRequests).toBeGreaterThan(
        BILLING_PLANS[index - 1]!.monthlyApiRequests,
      );
    }
  });

  it("uses the locked trial allowance", () => {
    expect(TRIAL_LIMITS).toEqual({
      storageBytes: 1_000_000_000,
      storedItems: 1_000,
      monthlyUploads: 1_000,
      monthlyApiRequests: 10_000,
    });
  });
});
