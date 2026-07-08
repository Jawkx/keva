import { useState } from "react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface ConfirmRevokeProps {
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly onConfirm: () => void | Promise<void>;
}

export function ConfirmRevoke({ title, description, label, onConfirm }: ConfirmRevokeProps) {
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button size="icon-sm" variant="ghost" className="text-destructive" aria-label={label} />
        }
      >
        <HugeiconsIcon icon={Delete02Icon} />
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              setOpen(false);
              void onConfirm();
            }}
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
