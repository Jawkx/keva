import {
  IconFile,
  IconFileMusic,
  IconFileText,
  IconFileTypeCsv,
  IconFileTypePdf,
  IconFileZip,
  IconJson,
  IconMovie,
  IconPhoto,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

type IconSpec = {
  Icon: React.ComponentType<{ className?: string }>;
  color: string;
};

// Map a MIME type to a recognisable icon + hue so the list is scannable at a
// glance instead of a wall of grey text. Colours are kept distinct and used
// sparingly (one per row), so they read as categories rather than noise.
function specFor(contentType: string): IconSpec {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("image/")) return { Icon: IconPhoto, color: "text-violet-400" };
  if (ct.startsWith("audio/")) return { Icon: IconFileMusic, color: "text-pink-400" };
  if (ct.startsWith("video/")) return { Icon: IconMovie, color: "text-rose-400" };
  if (ct === "application/pdf") return { Icon: IconFileTypePdf, color: "text-red-400" };
  if (ct === "text/csv" || ct.includes("spreadsheet") || ct.includes("excel"))
    return { Icon: IconFileTypeCsv, color: "text-emerald-400" };
  if (ct === "application/json") return { Icon: IconJson, color: "text-amber-400" };
  if (ct.includes("zip") || ct.includes("compress") || ct.includes("tar"))
    return { Icon: IconFileZip, color: "text-orange-400" };
  if (ct.startsWith("text/") || ct === "application/xml")
    return { Icon: IconFileText, color: "text-sky-400" };
  return { Icon: IconFile, color: "text-muted-foreground" };
}

export function FileTypeIcon({
  contentType,
  className,
}: {
  contentType: string;
  className?: string;
}) {
  const { Icon, color } = specFor(contentType);
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/40",
        className,
      )}
    >
      <Icon className={cn("size-[18px]", color)} />
    </span>
  );
}
