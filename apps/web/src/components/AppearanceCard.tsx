import { useState } from "react";
import { useTheme } from "next-themes";
import { ComputerIcon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMountEffect } from "../lib/useMountEffect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun03Icon },
  { value: "system", label: "System", icon: ComputerIcon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
] as const;

export function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  // next-themes has no value until mounted; avoid rendering a stale selection.
  const [mounted, setMounted] = useState(false);
  useMountEffect(() => setMounted(true));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>Choose how Keva looks on this device.</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleGroup
          variant="outline"
          value={mounted && theme ? [theme] : []}
          onValueChange={(value) => {
            const next = value[0];
            if (next) setTheme(next);
          }}
          aria-label="Theme"
        >
          {OPTIONS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="gap-2 px-4">
              <HugeiconsIcon icon={option.icon} />
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardContent>
    </Card>
  );
}
