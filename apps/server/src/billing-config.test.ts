import { describe, expect, it } from "vitest";
import { billingConfigFor } from "./billing-config.js";

const complete = {
  POLAR_SERVER: "sandbox",
  POLAR_ACCESS_TOKEN: "polar_oat_test",
  POLAR_WEBHOOK_SECRET: "polar_whs_test",
  POLAR_PRODUCT_100GB_ID: "product-100",
  POLAR_PRODUCT_500GB_ID: "product-500",
  POLAR_PRODUCT_1TB_ID: "product-1tb",
  POLAR_PRODUCT_2TB_ID: "product-2tb",
} as const;

describe("billingConfigFor", () => {
  it("keeps billing disabled when no Polar values are present", () => {
    expect(billingConfigFor({})).toBeUndefined();
  });

  it("builds an explicit sandbox product mapping", () => {
    expect(billingConfigFor(complete)).toEqual({
      accessToken: "polar_oat_test",
      webhookSecret: "polar_whs_test",
      server: "sandbox",
      products: {
        "100gb": "product-100",
        "500gb": "product-500",
        "1tb": "product-1tb",
        "2tb": "product-2tb",
      },
    });
  });

  it("rejects partial or invalid configuration", () => {
    expect(() => billingConfigFor({ POLAR_ACCESS_TOKEN: "token" })).toThrow(
      "Polar billing configuration is incomplete",
    );
    expect(() => billingConfigFor({ ...complete, POLAR_SERVER: "other" })).toThrow("POLAR_SERVER");
  });
});
