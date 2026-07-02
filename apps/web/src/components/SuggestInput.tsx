import { useMemo, useRef, useState } from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface SuggestInputProps {
  value: string;
  onValueChange: (value: string) => void;
  // Existing keys/values to offer as completions. Free text is always allowed:
  // the input value is the source of truth, suggestions only assist.
  suggestions: readonly string[];
  placeholder?: string | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
  autoFocus?: boolean | undefined;
  invalid?: boolean | undefined;
  inputMode?: React.ComponentProps<"input">["inputMode"];
  type?: React.ComponentProps<"input">["type"];
  // Fired when Enter is pressed without accepting a highlighted suggestion, so
  // the surrounding form can submit.
  onEnter?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
}

const MAX_SUGGESTIONS = 50;

const popupClass =
  "max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95";

const listClass = "max-h-56 scroll-py-1 overflow-y-auto overscroll-contain p-1";

const itemClass =
  "relative flex w-full cursor-default items-center truncate rounded-md px-2 py-1 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";

// A text input backed by an autocomplete popup. Suggestions are filtered here
// (not by the primitive) so the popup only opens when there is something to
// pick — a free-text field never flashes a "no matches" box while the user is
// typing a brand-new value.
export function SuggestInput({
  value,
  onValueChange,
  suggestions,
  placeholder,
  className,
  disabled,
  autoFocus,
  invalid,
  inputMode,
  type,
  onEnter,
  onBlur,
}: SuggestInputProps) {
  const [open, setOpen] = useState(false);
  // Tracks the currently highlighted suggestion so Enter only submits the form
  // when the user isn't accepting a completion (the primitive handles that).
  const highlighted = useRef<string | null>(null);

  const matches = useMemo(() => {
    const query = value.trim().toLowerCase();
    return suggestions
      .filter((suggestion) => {
        const candidate = suggestion.toLowerCase();
        // Drop the exact match: offering back what's already typed is noise.
        return candidate.includes(query) && candidate !== query;
      })
      .slice(0, MAX_SUGGESTIONS);
  }, [suggestions, value]);

  const inputProps = {
    disabled,
    placeholder,
    autoFocus,
    inputMode,
    type,
    "aria-invalid": invalid || undefined,
    className,
    onBlur,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Only intercept Enter when a handler wants it AND the user isn't
      // accepting a highlighted suggestion — otherwise let it bubble (e.g. to
      // submit the surrounding form natively).
      if (event.key === "Enter" && onEnter && highlighted.current === null) {
        event.preventDefault();
        onEnter();
      }
    },
  } satisfies React.ComponentProps<typeof Input>;

  if (suggestions.length === 0) {
    return <Input {...inputProps} value={value} onChange={(e) => onValueChange(e.target.value)} />;
  }

  return (
    <Autocomplete.Root
      mode="none"
      items={matches}
      value={value}
      onValueChange={onValueChange}
      open={open && matches.length > 0}
      onOpenChange={setOpen}
      onItemHighlighted={(item) => {
        highlighted.current = item ?? null;
      }}
      openOnInputClick
    >
      <Autocomplete.Input render={<Input {...inputProps} />} />
      <Autocomplete.Portal>
        <Autocomplete.Positioner sideOffset={4} align="start" className="isolate z-50">
          <Autocomplete.Popup className={cn(popupClass)}>
            <Autocomplete.List className={listClass}>
              {(item: string) => (
                <Autocomplete.Item key={item} value={item} className={itemClass}>
                  {item}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
