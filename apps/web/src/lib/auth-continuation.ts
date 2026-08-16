import { BILLING_PLANS } from "@keva/schema";
import { oauthContinuation } from "./oauth";

export const authContinuationSearch = (search: string): string => {
  const params = new URLSearchParams(search);
  params.delete("error");
  params.delete("error_description");
  const value = params.toString();
  return value ? `?${value}` : "";
};

export const planContinuation = (search: string): string | null => {
  const requestedPlan = new URLSearchParams(search).get("plan");
  const plan = BILLING_PLANS.find((candidate) => candidate.slug === requestedPlan);
  return plan ? `/settings?plan=${encodeURIComponent(plan.slug)}` : null;
};

export const loginContinuation = (search: string, from: string | null | undefined): string => {
  const continuationSearch = authContinuationSearch(search);
  const returnPath = from?.startsWith("/") && !from.startsWith("//") ? from : "/";
  return (
    oauthContinuation(continuationSearch) ?? planContinuation(continuationSearch) ?? returnPath
  );
};

export const signupContinuation = (search: string): string => {
  const continuationSearch = authContinuationSearch(search);
  return oauthContinuation(continuationSearch) ?? planContinuation(continuationSearch) ?? "/";
};

export const authErrorMessage = (search: string): string | null => {
  const params = new URLSearchParams(search);
  const description = params.get("error_description");
  if (description) return description;
  const error = params.get("error");
  if (!error) return null;
  if (error === "access_denied") return "Google sign-in was canceled.";
  if (error === "account_not_linked") {
    return "This Google account could not be linked to your existing account.";
  }
  return "Google sign-in failed. Please try again.";
};
