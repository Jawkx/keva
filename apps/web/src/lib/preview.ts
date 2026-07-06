// Preview eligibility for item content, shared by the owner's FileDetail and the
// public share detail. Keyed only on content type and size, so it works for both
// the full KevaItem and the redacted SharedItem shape.
export interface Previewable {
  contentType: string;
  size: number | null;
}

const IMAGE_MAX = 5 * 1024 * 1024;
const PDF_MAX = 25 * 1024 * 1024;
const TEXT_MAX = 256 * 1024;

export const isImage = (o: Previewable) => o.contentType.startsWith("image/");
export const isPdf = (o: Previewable) => o.contentType === "application/pdf";
export const isCsv = (o: Previewable) =>
  o.contentType === "text/csv" ||
  o.contentType === "text/tab-separated-values" ||
  o.contentType === "application/csv";
export const isText = (o: Previewable) =>
  o.contentType.startsWith("text/") ||
  o.contentType === "application/json" ||
  o.contentType === "application/xml";
export const isPreviewable = (o: Previewable) =>
  (isImage(o) && (o.size ?? Infinity) <= IMAGE_MAX) ||
  (isPdf(o) && (o.size ?? Infinity) <= PDF_MAX) ||
  (isText(o) && (o.size ?? Infinity) <= TEXT_MAX);
