import { Link } from "react-router-dom";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function NotFoundPage() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={AlertCircleIcon} />
        </EmptyMedia>
        <EmptyTitle>Page not found</EmptyTitle>
        <EmptyDescription>
          That page doesn't exist, or the item may have been deleted.
        </EmptyDescription>
      </EmptyHeader>
      <Button render={<Link to="/" />}>Back to Files</Button>
    </Empty>
  );
}
