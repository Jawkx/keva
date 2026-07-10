import { useState } from "react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface CopyButtonProps {
  value: string;
  label?: string;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
}

export function CopyButton({
  value,
  label = "Copy",
  size = "icon-sm",
  variant = "ghost",
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const iconOnly = size === "icon" || size === "icon-sm" || size === "icon-xs";

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <Button size={size} variant={variant} onClick={onCopy} aria-label={label}>
      {copied ? (
        <HugeiconsIcon icon={Tick02Icon} data-icon={iconOnly ? undefined : "inline-start"} />
      ) : (
        <HugeiconsIcon icon={Copy01Icon} data-icon={iconOnly ? undefined : "inline-start"} />
      )}
      {!iconOnly && (copied ? "Copied" : label)}
    </Button>
  );
}
