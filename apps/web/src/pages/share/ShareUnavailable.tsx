import { IconLinkOff } from "@tabler/icons-react";
import { Wordmark } from "../../components/Wordmark";
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
      <Wordmark size="lg" />
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
