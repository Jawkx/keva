import { Maximize2, Minimize2 } from "lucide-react";
import { lazy, useState } from "react";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const VendoredPdfViewer = lazy(() =>
  import("../ui/pdf-viewer").then(({ PDFViewer }) => ({ default: PDFViewer })),
);

interface PdfPreviewViewerProps {
  readonly src: string;
  readonly fileName: string;
  readonly className?: string;
}

export function PdfPreviewViewer({ src, fileName, className }: PdfPreviewViewerProps) {
  const [fullScreen, setFullScreen] = useState(false);

  return (
    <VendoredPdfViewer
      src={src}
      fileName={fileName}
      defaultZoom={ZoomMode.FitWidth}
      showUpload={false}
      showDownload={false}
      className={cn(className, fullScreen && "fixed inset-0 z-50 rounded-none")}
      toolbarActions={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={fullScreen ? "Exit PDF full screen" : "Open PDF full screen"}
                onClick={() => setFullScreen((current) => !current)}
              />
            }
          >
            {fullScreen ? <Minimize2 /> : <Maximize2 />}
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {fullScreen ? "Exit full screen" : "Full screen"}
          </TooltipContent>
        </Tooltip>
      }
    />
  );
}
