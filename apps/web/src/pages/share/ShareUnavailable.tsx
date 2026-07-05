import { IconLinkOff } from "@tabler/icons-react";
import { Wordmark } from "../../components/Wordmark";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

// Shown for an invalid token, a failed self-load, or a link that expired or was
// revoked mid-session. No login link or retry — the visitor is anonymous and a
// revoked link won't come back.
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
