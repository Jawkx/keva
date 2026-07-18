import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CreditCard, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "../lib/auth";
import { BILLING_QUERY_KEY, changeBillingPlan, getBillingOverview } from "../lib/billing";
import { useApiError } from "../lib/useApiError";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const statusLabel = {
  unsubscribed: "Plan required",
  trialing: "Trial",
  active: "Active",
  past_due: "Payment due",
  canceled: "Canceled",
} as const;

const dateLabel = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value))
    : null;

export function SubscriptionCard() {
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
    onSuccess: () => {
      toast.success("Plan change submitted");
      void queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ["usage"] });
    },
    onError: (error) => toast.error(handleError(error)),
  });

  const startCheckout = async (slug: string) => {
    const result = await authClient.checkout({ slug });
    if (result.error) toast.error(result.error.message ?? "Could not start checkout.");
  };

  const openPortal = async () => {
    const result = await authClient.customer.portal();
    if (result.error) toast.error(result.error.message ?? "Could not open billing.");
  };

  if (billingQuery.isPending) return <Skeleton className="h-80 w-full" />;
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

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--chart-2),var(--chart-4),var(--chart-1))]" />
      <CardHeader>
        <CardTitle>Subscription</CardTitle>
        <CardDescription>
          Four fixed plans. Egress is free, and there are no usage overages.
        </CardDescription>
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
      <CardContent className="flex flex-col gap-4">
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
        {status.plan && renewal && (
          <p className="text-sm text-muted-foreground">
            {status.status === "trialing" ? "Trial ends" : "Current period ends"}{" "}
            {dateLabel(renewal)}
            {status.cancelAtPeriodEnd ? "; cancellation scheduled" : ""}.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => {
            const selected = status.plan === plan.slug;
            const currentPrice = plans.find(
              (candidate) => candidate.slug === status.plan,
            )?.priceCents;
            const downgrade = currentPrice !== undefined && plan.priceCents < currentPrice;
            return (
              <div
                key={plan.slug}
                className={cn(
                  "flex min-h-52 flex-col rounded-lg border p-4 transition-colors",
                  selected ? "border-foreground bg-muted/45" : "border-border hover:bg-muted/25",
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
                </div>
                <div className="mt-5 space-y-1 text-xs text-muted-foreground">
                  <p>{plan.storedItems.toLocaleString()} stored items</p>
                  <p>{plan.monthlyUploads.toLocaleString()} uploads / month</p>
                  <p>Free egress</p>
                </div>
                <Button
                  className="mt-auto"
                  size="sm"
                  variant={selected ? "outline" : "default"}
                  disabled={selected || changeMutation.isPending}
                  onClick={() =>
                    status.subscriptionId
                      ? changeMutation.mutate(plan.slug)
                      : void startCheckout(plan.slug)
                  }
                >
                  {selected ? "Current plan" : downgrade ? "Downgrade" : "Choose plan"}
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
