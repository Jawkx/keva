import { useCallback, useState } from "react";
import { PreviewModeToggle, type PreviewMode } from "./PreviewModeToggle";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface HtmlPreviewViewerProps {
  source: string;
  className?: string;
}

export function HtmlPreviewViewer({ source, className }: HtmlPreviewViewerProps) {
  const [mode, setMode] = useState<PreviewMode>("rendered");
  const [frameHeight, setFrameHeight] = useState(0);

  const frameRef = useCallback((frame: HTMLIFrameElement | null) => {
    if (!frame) return;

    let resizeObserver: ResizeObserver | undefined;
    const measure = () => {
      resizeObserver?.disconnect();
      const document = frame.contentDocument;
      if (!document) return;

      const updateHeight = () => {
        setFrameHeight(
          Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
        );
      };

      resizeObserver = new ResizeObserver(updateHeight);
      resizeObserver.observe(document.documentElement);
      if (document.body) resizeObserver.observe(document.body);
      updateHeight();
    };

    frame.onload = measure;
    return () => {
      frame.onload = null;
      resizeObserver?.disconnect();
    };
  }, []);

  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-background",
        className,
      )}
    >
      <PreviewModeToggle format="HTML" mode={mode} onModeChange={setMode} />

      {mode === "source" ? (
        <ScrollArea className="min-h-0 w-full min-w-0 flex-1">
          <pre className="w-max min-w-full px-4 pt-14 pb-4 font-mono text-xs leading-relaxed">
            {source}
          </pre>
        </ScrollArea>
      ) : (
        <ScrollArea className="min-h-0 w-full min-w-0 flex-1">
          <iframe
            ref={frameRef}
            title="HTML preview"
            srcDoc={source}
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
            scrolling="no"
            className="block min-h-full w-full border-0 bg-white"
            style={{ height: frameHeight || "100%" }}
          />
        </ScrollArea>
      )}
    </div>
  );
}
