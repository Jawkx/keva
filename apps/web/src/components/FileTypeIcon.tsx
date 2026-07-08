import {
  Csv01Icon,
  DocumentCodeIcon,
  File01Icon,
  File02Icon,
  FileMusicIcon,
  Pdf01Icon,
  Video01Icon,
  Image01Icon,
  Zip01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@/lib/utils";

type IconSpec = {
  icon: IconSvgElement;
  color: string;
};

// Map a MIME type to a recognisable icon + hue so the list is scannable at a
// glance instead of a wall of grey text. Colours are kept distinct and used
// sparingly (one per row), so they read as categories rather than noise.
function specFor(contentType: string): IconSpec {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("image/")) return { icon: Image01Icon, color: "text-violet-400" };
  if (ct.startsWith("audio/")) return { icon: FileMusicIcon, color: "text-pink-400" };
  if (ct.startsWith("video/")) return { icon: Video01Icon, color: "text-rose-400" };
  if (ct === "application/pdf") return { icon: Pdf01Icon, color: "text-red-400" };
  if (ct === "text/csv" || ct.includes("spreadsheet") || ct.includes("excel"))
    return { icon: Csv01Icon, color: "text-emerald-400" };
  if (ct === "application/json") return { icon: DocumentCodeIcon, color: "text-amber-400" };
  if (ct.includes("zip") || ct.includes("compress") || ct.includes("tar"))
    return { icon: Zip01Icon, color: "text-orange-400" };
  if (ct.startsWith("text/") || ct === "application/xml")
    return { icon: File02Icon, color: "text-sky-400" };
  return { icon: File01Icon, color: "text-muted-foreground" };
}

export function FileTypeIcon({
  contentType,
  className,
}: {
  contentType: string;
  className?: string;
}) {
  const { icon, color } = specFor(contentType);
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/40",
        className,
      )}
    >
      <HugeiconsIcon icon={icon} className={cn("size-[18px]", color)} />
    </span>
  );
}
