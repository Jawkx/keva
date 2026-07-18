import { BillingOverview, ChangeBillingPlan } from "@keva/schema";
import { Schema } from "effect";
import { sessionApiRequest } from "./session-api";

export const BILLING_QUERY_KEY = ["billing"] as const;

export const getBillingOverview = () => sessionApiRequest("GET", "/api/billing", BillingOverview);

export const changeBillingPlan = (plan: (typeof ChangeBillingPlan.Type)["plan"]) =>
  sessionApiRequest("POST", "/api/billing/plan", Schema.Struct({ changed: Schema.Boolean }), {
    plan,
  });
