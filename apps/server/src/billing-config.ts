import type { ServerOptionsConfig } from "./server-options.js";

interface BillingEnv {
  readonly POLAR_ACCESS_TOKEN?: string | undefined;
  readonly POLAR_WEBHOOK_SECRET?: string | undefined;
  readonly POLAR_SERVER?: string | undefined;
  readonly POLAR_PRODUCT_100GB_ID?: string | undefined;
  readonly POLAR_PRODUCT_500GB_ID?: string | undefined;
  readonly POLAR_PRODUCT_1TB_ID?: string | undefined;
  readonly POLAR_PRODUCT_2TB_ID?: string | undefined;
}

export const billingConfigFor = (env: BillingEnv): ServerOptionsConfig["polar"] => {
  const values = [
    env.POLAR_SERVER,
    env.POLAR_ACCESS_TOKEN,
    env.POLAR_WEBHOOK_SECRET,
    env.POLAR_PRODUCT_100GB_ID,
    env.POLAR_PRODUCT_500GB_ID,
    env.POLAR_PRODUCT_1TB_ID,
    env.POLAR_PRODUCT_2TB_ID,
  ];
  if (values.every((value) => !value)) return undefined;
  if (values.some((value) => !value)) throw new Error("Polar billing configuration is incomplete");
  const server = env.POLAR_SERVER;
  if (server !== "sandbox" && server !== "production") {
    throw new Error("POLAR_SERVER must be 'sandbox' or 'production'");
  }
  return {
    accessToken: env.POLAR_ACCESS_TOKEN!,
    webhookSecret: env.POLAR_WEBHOOK_SECRET!,
    server,
    products: {
      "100gb": env.POLAR_PRODUCT_100GB_ID!,
      "500gb": env.POLAR_PRODUCT_500GB_ID!,
      "1tb": env.POLAR_PRODUCT_1TB_ID!,
      "2tb": env.POLAR_PRODUCT_2TB_ID!,
    },
  };
};
