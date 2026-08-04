import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ProductBetaBadgeProps = {
  tone?: "default" | "inverse";
};

export function ProductBetaBadge({ tone = "default" }: ProductBetaBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-4 px-1.5 py-0 text-[10px] leading-none text-muted-foreground",
        tone === "inverse" && "border-white/20 text-white/60",
      )}
    >
      Beta
    </Badge>
  );
}
