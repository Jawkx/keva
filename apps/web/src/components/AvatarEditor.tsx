import { useState } from "react";
import { ChevronLeft, ChevronRight, Dices, RotateCcw } from "lucide-react";
import { AVATAR_VARIANTS, AvatarRecipe } from "@keva/schema";
import { Schema } from "effect";
import { avatarRecipeForUser, parseAvatarRecipe, resolveAvatarRecipe } from "../lib/avatar";
import { UserAvatar } from "./UserAvatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type VariantField = "hair" | "head" | "eyebrows" | "eyes" | "nose" | "mouth";
type OptionalVariantField = "glasses" | "beard" | "earrings";

const variantNumber = (value: string): string => {
  const match = /^(?:variant|happy|sad)(\d+)$/.exec(value);
  if (!match) return value === "flowers" ? "Flowers" : value;
  if (value.startsWith("happy")) return `Happy ${Number(match[1])}`;
  if (value.startsWith("sad")) return `Sad ${Number(match[1])}`;
  return String(Number(match[1]));
};

const nextValue = <Value,>(values: readonly Value[], current: Value, direction: -1 | 1): Value => {
  const index = values.indexOf(current);
  return values[(index + direction + values.length) % values.length] ?? current;
};

interface PartStepperProps {
  readonly label: string;
  readonly value: string;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

function PartStepper({ label, value, onPrevious, onNext }: PartStepperProps) {
  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 rounded-xl border bg-background px-1 py-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Previous ${label.toLowerCase()}`}
        onClick={onPrevious}
      >
        <ChevronLeft />
      </Button>
      <div className="min-w-0 text-center">
        <span className="text-xs text-muted-foreground">{label}</span>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Next ${label.toLowerCase()}`}
        onClick={onNext}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}

interface AvatarEditorProps {
  readonly userId: string;
  readonly name: string;
  readonly avatar: string | null | undefined;
  readonly onSave: (recipe: AvatarRecipe | null) => Promise<boolean>;
}

export function AvatarEditor({ userId, name, avatar, onSave }: AvatarEditorProps) {
  const storedRecipe = parseAvatarRecipe(avatar);
  const initialRecipe = resolveAvatarRecipe(avatarRecipeForUser(userId, avatar));
  const [open, setOpen] = useState(false);
  const [recipe, setRecipe] = useState<AvatarRecipe>(initialRecipe);
  const [isDefault, setIsDefault] = useState(!storedRecipe);
  const [saving, setSaving] = useState(false);

  const updateRecipe = (next: AvatarRecipe) => {
    setRecipe(next);
    setIsDefault(false);
  };

  const cycleVariant = (field: VariantField, values: readonly string[], direction: -1 | 1) => {
    const current = recipe[field] ?? values[0];
    if (current === undefined) return;
    updateRecipe(
      Schema.decodeUnknownSync(AvatarRecipe)({
        ...recipe,
        [field]: nextValue(values, current, direction),
      }),
    );
  };

  const cycleOptionalVariant = (
    field: OptionalVariantField,
    values: readonly string[],
    direction: -1 | 1,
  ) => {
    const choices: readonly (string | null)[] = [null, ...values];
    updateRecipe(
      Schema.decodeUnknownSync(AvatarRecipe)({
        ...recipe,
        [field]: nextValue(choices, recipe[field] ?? null, direction),
      }),
    );
  };

  const onOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setRecipe(initialRecipe);
      setIsDefault(!storedRecipe);
    }
    setOpen(nextOpen);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (await onSave(isDefault ? null : recipe)) setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const randomize = () =>
    updateRecipe(resolveAvatarRecipe({ version: 1, seed: crypto.randomUUID() }));

  const reset = () => {
    setRecipe(resolveAvatarRecipe({ version: 1, seed: userId }));
    setIsDefault(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        Customize avatar
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100svh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>Make it yours</DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[17rem_minmax(0,1fr)] md:overflow-hidden">
          <aside className="flex flex-col items-center justify-center gap-4 border-b bg-muted/25 p-6 md:border-r md:border-b-0">
            <UserAvatar avatar={recipe} name={name} className="size-48 shadow-sm ring-1" labelled />
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={randomize}>
                <Dices />
                Randomize
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={reset}>
                <RotateCcw />
                Reset
              </Button>
            </div>
          </aside>

          <div className="flex min-h-0 flex-col overflow-y-auto p-4">
            <div className="flex flex-col gap-3">
              <p className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Hair and face
              </p>
              <PartStepper
                label="Hair"
                value={variantNumber(recipe.hair!)}
                onPrevious={() => cycleVariant("hair", AVATAR_VARIANTS.hair, -1)}
                onNext={() => cycleVariant("hair", AVATAR_VARIANTS.hair, 1)}
              />
              <PartStepper
                label="Head"
                value={variantNumber(recipe.head!)}
                onPrevious={() => cycleVariant("head", AVATAR_VARIANTS.head, -1)}
                onNext={() => cycleVariant("head", AVATAR_VARIANTS.head, 1)}
              />
              <PartStepper
                label="Eyes"
                value={variantNumber(recipe.eyes!)}
                onPrevious={() => cycleVariant("eyes", AVATAR_VARIANTS.eyes, -1)}
                onNext={() => cycleVariant("eyes", AVATAR_VARIANTS.eyes, 1)}
              />
              <PartStepper
                label="Eyebrows"
                value={variantNumber(recipe.eyebrows!)}
                onPrevious={() => cycleVariant("eyebrows", AVATAR_VARIANTS.eyebrows, -1)}
                onNext={() => cycleVariant("eyebrows", AVATAR_VARIANTS.eyebrows, 1)}
              />
              <PartStepper
                label="Nose"
                value={variantNumber(recipe.nose!)}
                onPrevious={() => cycleVariant("nose", AVATAR_VARIANTS.nose, -1)}
                onNext={() => cycleVariant("nose", AVATAR_VARIANTS.nose, 1)}
              />
              <PartStepper
                label="Mouth"
                value={variantNumber(recipe.mouth!)}
                onPrevious={() => cycleVariant("mouth", AVATAR_VARIANTS.mouth, -1)}
                onNext={() => cycleVariant("mouth", AVATAR_VARIANTS.mouth, 1)}
              />

              <p className="mt-2 px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Details
              </p>
              <PartStepper
                label="Glasses"
                value={recipe.glasses ? variantNumber(recipe.glasses) : "None"}
                onPrevious={() => cycleOptionalVariant("glasses", AVATAR_VARIANTS.glasses, -1)}
                onNext={() => cycleOptionalVariant("glasses", AVATAR_VARIANTS.glasses, 1)}
              />
              <PartStepper
                label="Beard"
                value={recipe.beard ? variantNumber(recipe.beard) : "None"}
                onPrevious={() => cycleOptionalVariant("beard", AVATAR_VARIANTS.beard, -1)}
                onNext={() => cycleOptionalVariant("beard", AVATAR_VARIANTS.beard, 1)}
              />
              <PartStepper
                label="Earrings"
                value={recipe.earrings ? variantNumber(recipe.earrings) : "None"}
                onPrevious={() => cycleOptionalVariant("earrings", AVATAR_VARIANTS.earrings, -1)}
                onNext={() => cycleOptionalVariant("earrings", AVATAR_VARIANTS.earrings, 1)}
              />
              <PartStepper
                label="Freckles"
                value={recipe.freckles ? "On" : "Off"}
                onPrevious={() => updateRecipe({ ...recipe, freckles: !recipe.freckles })}
                onNext={() => updateRecipe({ ...recipe, freckles: !recipe.freckles })}
              />
              <PartStepper
                label="Hair accessory"
                value={recipe.hairAccessory ? "Flowers" : "None"}
                onPrevious={() =>
                  updateRecipe({
                    ...recipe,
                    hairAccessory: recipe.hairAccessory ? null : "flowers",
                  })
                }
                onNext={() =>
                  updateRecipe({
                    ...recipe,
                    hairAccessory: recipe.hairAccessory ? null : "flowers",
                  })
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter className="m-0 rounded-none px-5 py-4">
          <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save avatar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
