import { CodeXml, Eye } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type PreviewMode = "rendered" | "source";

interface PreviewModeToggleProps {
  format: string;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
}

export function PreviewModeToggle({ format, mode, onModeChange }: PreviewModeToggleProps) {
  return (
    <div className="absolute top-3 right-3 z-10">
      <ToggleGroup
        variant="outline"
        size="sm"
        value={[mode]}
        onValueChange={(value) => {
          const next = value[0];
          if (next === "rendered" || next === "source") onModeChange(next);
        }}
        className="bg-background/90 backdrop-blur-sm"
        aria-label={`${format} view`}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <ToggleGroupItem
                value="rendered"
                className="flex-none"
                aria-label={`Rendered ${format.toLowerCase()}`}
              />
            }
          >
            <Eye />
          </TooltipTrigger>
          <TooltipContent>Rendered</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <ToggleGroupItem
                value="source"
                className="flex-none"
                aria-label={`${format} source`}
              />
            }
          >
            <CodeXml />
          </TooltipTrigger>
          <TooltipContent>Source</TooltipContent>
        </Tooltip>
      </ToggleGroup>
    </div>
  );
}
