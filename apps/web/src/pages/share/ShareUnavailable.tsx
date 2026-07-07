import { IconLinkOff } from "@tabler/icons-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function ShareUnavailable() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-8 p-6">
      <span className="font-heading text-[42px] leading-none font-semibold text-primary">Keva</span>
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconLinkOff />
          </EmptyMedia>
          <EmptyTitle>This link is no longer available</EmptyTitle>
          <EmptyDescription>
            It may have expired or been revoked. Ask the person who shared it for a new link.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
