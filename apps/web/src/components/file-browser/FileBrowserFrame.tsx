import type { ReactNode } from "react";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

export function FileBrowserFrame({
  list,
  detail,
  detailOpen,
  onDetailOpenChange,
  detailTitle,
}: {
  list: ReactNode;
  detail: ReactNode;
  detailOpen: boolean;
  onDetailOpenChange: (open: boolean) => void;
  detailTitle: string;
}) {
  const isWide = useMediaQuery("(min-width: 1024px)");

  return (
    <div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      {detailOpen && isWide ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 w-full min-w-0 flex-1 gap-3"
        >
          <ResizablePanel defaultSize={64} minSize={38} className="min-w-0">
            {list}
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-transparent" />
          <ResizablePanel
            defaultSize={36}
            minSize={28}
            className="min-w-0 overflow-hidden rounded-xl border"
          >
            {detail}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-hidden">{list}</div>
      )}

      <Sheet open={detailOpen && !isWide} onOpenChange={onDetailOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="h-[min(88dvh,56rem)] rounded-t-2xl p-0"
        >
          <SheetTitle className="sr-only">{detailTitle}</SheetTitle>
          {detailOpen && detail}
        </SheetContent>
      </Sheet>
    </div>
  );
}
