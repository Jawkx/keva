import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CreditCard, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "../lib/auth";
import {
  BILLING_QUERY_KEY,
  cancelBillingPlanChange,
  changeBillingPlan,
  getBillingOverview,
} from "../lib/billing";
import { useApiError } from "../lib/useApiError";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const statusLabel = {
  unsubscribed: "Plan required",
  trialing: "Trial",
  active: "Active",
  past_due: "Payment due",
  canceled: "Canceled",
} as const;

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const dateLabel = (value: string | null) => (value ? dateFormatter.format(new Date(value)) : null);

async function startCheckout(slug: string) {
  const result = await authClient.checkout({ slug });
  if (result.error) toast.error(result.error.message ?? "Could not start checkout.");
}

async function openPortal() {
  const result = await authClient.customer.portal();
  if (result.error) toast.error(result.error.message ?? "Could not open billing.");
}

export function SubscriptionCard({ showHeader = true }: { readonly showHeader?: boolean }) {
  const handleError = useApiError();
  const queryClient = useQueryClient();
  const checkoutReturn = new URLSearchParams(window.location.search).get("checkout") === "complete";
  const billingQuery = useQuery({
    queryKey: BILLING_QUERY_KEY,
    queryFn: getBillingOverview,
    refetchInterval: (query) =>
      checkoutReturn && query.state.data?.status.status === "unsubscribed" ? 2_000 : false,
  });
  const changeMutation = useMutation({
    mutationFn: changeBillingPlan,
    onSuccess: (result) => {
      if (!result.changed) toast.info("Already on this plan");
      else if (result.effectiveAt)
        toast.success(`Plan change scheduled for ${dateLabel(result.effectiveAt)}`);
      else toast.success("Plan changed");
      void queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["usage"] });
    },
    onError: (error) => toast.error(handleError(error)),
  });
  const cancelChangeMutation = useMutation({
    mutationFn: cancelBillingPlanChange,
    onSuccess: () => {
      toast.success("Scheduled plan change canceled");
      void queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEY });
    },
    onError: (error) => toast.error(handleError(error)),
  });

  if (billingQuery.isPending) {
    return (
      <Card className="relative gap-0 overflow-visible bg-transparent py-0 ring-0">
        {showHeader && (
          <>
            <CardHeader className="px-0 pb-5">
              <Skeleton className="h-6 w-28" />
              <CardAction>
                <Skeleton className="h-5 w-16 rounded-full" />
              </CardAction>
            </CardHeader>
            <Separator />
          </>
        )}
        <CardContent className={cn("px-0", showHeader && "pt-6")}>
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="flex min-h-52 flex-col rounded-lg border p-4">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="mt-2 h-7 w-28" />
                <div className="mt-5 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="mt-auto h-8 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }
  if (billingQuery.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Could not load subscription</AlertTitle>
        <AlertDescription>{handleError(billingQuery.error)}</AlertDescription>
      </Alert>
    );
  }

  const { status, plans } = billingQuery.data;
  const renewal = status.trialEndsAt ?? status.currentPeriodEnd;
  const pendingPlan = plans.find((plan) => plan.slug === status.pendingPlan);

  return (
    <Card className="relative gap-0 overflow-visible bg-transparent py-0 ring-0">
      {showHeader && (
        <>
          <CardHeader className="px-0 pb-5">
            <CardTitle className="text-xl font-semibold tracking-tight">Billing</CardTitle>
            <CardAction className="flex items-center gap-2">
              <Badge variant={status.status === "past_due" ? "destructive" : "secondary"}>
                {statusLabel[status.status]}
              </Badge>
              {status.subscriptionId && (
                <Button size="sm" variant="outline" onClick={() => void openPortal()}>
                  <CreditCard data-icon="inline-start" />
                  Manage
                </Button>
              )}
            </CardAction>
          </CardHeader>
          <Separator />
        </>
      )}
      <CardContent className={cn("flex flex-col gap-4 px-0", showHeader && "pt-6")}>
        {status.status === "unsubscribed" && (
          <Alert>
            <AlertTitle>Choose a plan to start your 14-day trial</AlertTitle>
            <AlertDescription>
              Every trial includes 1 GB, 1,000 stored items, and 1,000 uploads. A payment method is
              required, but you are not charged until the trial ends.
            </AlertDescription>
          </Alert>
        )}
        {status.status === "past_due" && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Update your payment method</AlertTitle>
            <AlertDescription>
              Plan access continues until {dateLabel(status.graceEndsAt) ?? "the grace period ends"}
              .
            </AlertDescription>
          </Alert>
        )}
        {pendingPlan && status.pendingPlanAppliesAt && (
          <Alert className="pr-32">
            <AlertTitle>Plan change scheduled</AlertTitle>
            <AlertDescription>
              Your plan changes to {pendingPlan.name} on {dateLabel(status.pendingPlanAppliesAt)}.
              Your current limits remain active until then.
            </AlertDescription>
            <AlertAction>
              <Button
                size="xs"
                variant="outline"
                disabled={cancelChangeMutation.isPending || changeMutation.isPending}
                onClick={() => cancelChangeMutation.mutate()}
              >
                {cancelChangeMutation.isPending ? "Canceling…" : "Cancel change"}
              </Button>
            </AlertAction>
          </Alert>
        )}
        {status.plan && renewal && (
          <p className="text-sm text-muted-foreground">
            {status.status === "trialing" ? "Trial ends" : "Current period ends"}{" "}
            {dateLabel(renewal)}
            {status.cancelAtPeriodEnd ? "; cancellation scheduled" : ""}.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {plans.map((plan) => {
            const selected = status.plan === plan.slug;
            const currentPrice = plans.find(
              (candidate) => candidate.slug === status.plan,
            )?.priceCents;
            const downgrade = currentPrice !== undefined && plan.priceCents < currentPrice;
            const scheduled = status.pendingPlan === plan.slug;
            return (
              <div
                key={plan.slug}
                className={cn(
                  "flex min-h-52 flex-col rounded-lg border p-4 transition-colors",
                  selected || scheduled
                    ? "border-foreground bg-muted/45"
                    : "border-border hover:bg-muted/25",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-heading text-lg font-semibold">{plan.name}</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums">
                      ${(plan.priceCents / 100).toFixed(0)}
                      <span className="text-sm font-normal text-muted-foreground"> / month</span>
                    </p>
                  </div>
                  {selected && <Check className="size-4" aria-label="Current plan" />}
                  {scheduled && <Badge variant="outline">Scheduled</Badge>}
                </div>
                <div className="mt-5 space-y-1 text-xs text-muted-foreground">
                  <p>{plan.storedItems.toLocaleString()} stored items</p>
                  <p>{plan.monthlyUploads.toLocaleString()} uploads / month</p>
                  <p>Free egress</p>
                </div>
                <Button
                  className="mt-auto"
                  size="sm"
                  variant={selected || downgrade ? "outline" : "default"}
                  disabled={selected || changeMutation.isPending || cancelChangeMutation.isPending}
                  onClick={() => {
                    if (scheduled) cancelChangeMutation.mutate();
                    else if (status.subscriptionId) changeMutation.mutate(plan.slug);
                    else void startCheckout(plan.slug);
                  }}
                >
                  {selected
                    ? "Current plan"
                    : scheduled
                      ? cancelChangeMutation.isPending
                        ? "Canceling…"
                        : "Cancel change"
                      : downgrade
                        ? "Downgrade"
                        : "Choose plan"}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
