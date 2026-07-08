import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  Alert02Icon,
  AlertDiamondIcon,
  CheckmarkCircle01Icon,
  InformationCircleIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={(theme ?? "system") as NonNullable<ToasterProps["theme"]>}
      className="toaster group"
      icons={{
        success: <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-4" />,
        info: <HugeiconsIcon icon={InformationCircleIcon} className="size-4" />,
        warning: <HugeiconsIcon icon={Alert02Icon} className="size-4" />,
        error: <HugeiconsIcon icon={AlertDiamondIcon} className="size-4" />,
        loading: <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
