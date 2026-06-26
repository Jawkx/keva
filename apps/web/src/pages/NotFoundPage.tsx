import { Link } from "react-router-dom";
import { IconError404 } from "@tabler/icons-react";
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
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconError404 />
        </EmptyMedia>
        <EmptyTitle>Page not found</EmptyTitle>
        <EmptyDescription>
          That page doesn't exist, or the object may have been deleted.
        </EmptyDescription>
      </EmptyHeader>
      <Button render={<Link to="/" />}>Back to Files</Button>
    </Empty>
  );
}
