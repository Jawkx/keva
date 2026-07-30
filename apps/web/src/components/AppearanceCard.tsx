import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useTheme } from "next-themes";
import { useMountEffect } from "../lib/useMountEffect";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

export function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useMountEffect(() => setMounted(true));

  return (
    <div>
      <header className="pb-5">
        <h2 className="font-heading text-xl font-semibold tracking-tight">Appearance</h2>
      </header>
      <Separator />
      <section className="grid gap-5 py-6 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:items-center">
        <div>
          <h3 className="font-medium">Theme</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose light, dark, or follow your system setting.
          </p>
        </div>
        <ToggleGroup
          variant="outline"
          className="w-full sm:w-fit sm:justify-self-end"
          value={mounted && theme ? [theme] : []}
          onValueChange={(value) => {
            const next = value[0];
            if (next) setTheme(next);
          }}
          aria-label="Theme"
        >
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <ToggleGroupItem key={option.value} value={option.value} className="gap-2 px-4">
                <Icon />
                {option.label}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </section>
    </div>
  );
}
