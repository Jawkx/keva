import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useTheme } from "next-themes";
import { useMountEffect } from "../lib/useMountEffect";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose how Keva looks on this device.</CardDescription>
        </div>
        <ToggleGroup
          variant="outline"
          className="w-full sm:w-fit"
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
      </CardContent>
    </Card>
  );
}
