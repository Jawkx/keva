import { SubscriptionCard } from "./SubscriptionCard";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function BillingRequiredDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-hidden sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-xl">Choose a plan to upload</DialogTitle>
          <DialogDescription>
            Activate storage with a 14-day trial. Your upload will not start until you choose a
            plan.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-0.5 pb-0.5">
          <SubscriptionCard showHeader={false} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
