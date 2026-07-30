import { File, FileAudio, FileText, FileVideo, Image, type LucideIcon } from "lucide-react";

export const fileKindIcon = (contentType: string): LucideIcon => {
  if (contentType.startsWith("image/")) return Image;
  if (contentType.startsWith("video/")) return FileVideo;
  if (contentType.startsWith("audio/")) return FileAudio;
  if (
    contentType.startsWith("text/") ||
    contentType === "application/pdf" ||
    contentType === "application/json" ||
    contentType.includes("word") ||
    contentType.includes("document") ||
    contentType.includes("rtf")
  ) {
    return FileText;
  }
  return File;
};
