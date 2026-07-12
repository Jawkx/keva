import { lazy } from "react";

const VendoredCsvViewer = lazy(() =>
  import("../ui/csv-viewer").then(({ CsvViewer }) => ({ default: CsvViewer })),
);

interface CsvPreviewViewerProps {
  readonly data: string;
  readonly className?: string;
}

export function CsvPreviewViewer({ data, className }: CsvPreviewViewerProps) {
  return <VendoredCsvViewer data={data} search {...(className ? { className } : {})} />;
}
