import type { AvatarRecipe } from "@keva/schema";
import { avatarDataUri } from "../lib/avatar";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  readonly avatar: AvatarRecipe;
  readonly name: string;
  readonly className?: string;
  readonly labelled?: boolean;
}

export function UserAvatar({ avatar, name, className, labelled = false }: UserAvatarProps) {
  return (
    <span
      className={cn(
        "relative inline-flex size-8 shrink-0 overflow-hidden rounded-full bg-muted ring-1 ring-foreground/10",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center text-sm font-semibold uppercase"
      >
        {(name || "?").charAt(0)}
      </span>
      <img
        src={avatarDataUri(avatar)}
        alt={labelled ? `${name}'s avatar` : ""}
        className="relative size-full object-cover"
      />
    </span>
  );
}
