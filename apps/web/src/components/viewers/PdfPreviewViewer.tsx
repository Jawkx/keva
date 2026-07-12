import { lazy } from "react";
import { ZoomMode } from "@embedpdf/plugin-zoom";

const VendoredPdfViewer = lazy(() =>
  import("../ui/pdf-viewer").then(({ PDFViewer }) => ({ default: PDFViewer })),
);

interface PdfPreviewViewerProps {
  readonly src: string;
  readonly fileName: string;
  readonly className?: string;
}

export function PdfPreviewViewer({ src, fileName, className }: PdfPreviewViewerProps) {
  return (
    <VendoredPdfViewer
      src={src}
      fileName={fileName}
      defaultZoom={ZoomMode.FitWidth}
      showUpload={false}
      showDownload={false}
      {...(className ? { className } : {})}
    />
  );
}
