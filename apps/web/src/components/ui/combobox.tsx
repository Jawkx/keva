import * as React from "react";
import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const inputClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30";

function Combobox({
  value,
  onValueChange,
  options,
  placeholder,
  emptyText = "No matches",
  className,
  type,
  inputMode,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  emptyText?: string;
  className?: string;
  type?: React.HTMLInputTypeAttribute;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  "aria-label"?: string;
}) {
  if (options.length === 0) {
    return (
      <Input
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={className}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
    );
  }

  return (
    <AutocompletePrimitive.Root
      items={options}
      value={value}
      onValueChange={(next) => onValueChange(next)}
      openOnInputClick
    >
      <AutocompletePrimitive.Input
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-slot="combobox-input"
        className={cn(inputClassName, className)}
      />
      <AutocompletePrimitive.Portal>
        <AutocompletePrimitive.Positioner sideOffset={4} className="isolate z-50">
          <AutocompletePrimitive.Popup
            data-slot="combobox-content"
            className="max-h-[min(var(--available-height),18rem)] w-(--anchor-width) origin-(--transform-origin) overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <AutocompletePrimitive.Empty className="px-2 py-1.5 text-muted-foreground">
              {emptyText}
            </AutocompletePrimitive.Empty>
            <AutocompletePrimitive.List>
              {(item: string) => (
                <AutocompletePrimitive.Item
                  key={item}
                  value={item}
                  className="relative flex w-full cursor-default items-center rounded-md px-2 py-1.5 outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  {item}
                </AutocompletePrimitive.Item>
              )}
            </AutocompletePrimitive.List>
          </AutocompletePrimitive.Popup>
        </AutocompletePrimitive.Positioner>
      </AutocompletePrimitive.Portal>
    </AutocompletePrimitive.Root>
  );
}

export { Combobox };
