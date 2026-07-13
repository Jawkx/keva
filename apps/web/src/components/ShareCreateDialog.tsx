import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import {
  propertiesMatchCondition,
  type CreateShareGrant,
  type PropertyValue,
  type QueryCondition,
  type ShareScope,
} from "@keva/schema";
import { createShare, sharesQueryKey } from "../lib/shares";
import { uploadStampFrom } from "../lib/upload-stamp";
import { viewsQueryKey } from "../lib/views";
import { describeFilter } from "../lib/item-filters";
import { validateKey } from "../lib/properties";
import { useApiError } from "../lib/useApiError";
import { CopyButton } from "./CopyButton";
import { PropertyStampChips, type PropertyStampChip } from "./FilterBar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ShareCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewId: string;
  conditions: QueryCondition[];
}

const EXPIRY_PRESETS = [
  { id: "never", label: "Never", days: null },
  { id: "1d", label: "1 day", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
] as const;

// A grant's write stamp must satisfy its conditions; system-field conditions
// (system.*) and `name` can't be represented by a property stamp, so they block
// enabling write (the server would reject them anyway).
const isStampableKey = (key: string): boolean => !key.startsWith("system.") && key !== "name";

export function ShareCreateDialog({
  open,
  onOpenChange,
  viewId,
  conditions,
}: ShareCreateDialogProps) {
  const handleError = useApiError();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [canRead, setCanRead] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [stamp, setStamp] = useState<PropertyStampChip[]>([]);
  const [maxItems, setMaxItems] = useState("");
  const [maxTotalMb, setMaxTotalMb] = useState("");
  const [expiry, setExpiry] = useState<(typeof EXPIRY_PRESETS)[number]["id"]>("never");
  const [link, setLink] = useState<string | null>(null);

  const blockingKeys = [
    ...new Set(conditions.filter((c) => !isStampableKey(c.key)).map((c) => c.key)),
  ];
  const writeBlocked = blockingKeys.length > 0;
  const summary = describeFilter(conditions);
  const requiredStamp = uploadStampFrom(conditions);
  const requiredStampEntries = Object.entries(requiredStamp);

  const mutation = useMutation({
    mutationFn: async ({
      grant,
      conditions: where,
    }: {
      grant: Omit<CreateShareGrant, "viewId">;
      conditions: readonly QueryCondition[];
    }) => {
      return createShare(
        viewId
          ? { ...grant, viewId }
          : { ...grant, view: { name: grant.name, conditions: [...where] } },
      );
    },
    onSuccess: (result) => {
      setLink(`${window.location.origin}/s/${result.token}`);
      void queryClient.invalidateQueries({ queryKey: sharesQueryKey });
      void queryClient.invalidateQueries({ queryKey: viewsQueryKey });
    },
    onError: (err) => toast.error(handleError(err)),
  });

  const scopes: ShareScope[] = [
    ...(canRead ? (["read"] as const) : []),
    ...(canWrite && !writeBlocked ? (["write"] as const) : []),
  ];

  const buildWriteStamp = (): Record<string, PropertyValue> | { error: string } => {
    const result: Record<string, PropertyValue> = {};
    for (const row of stamp) {
      const keyError = validateKey(row.key);
      if (keyError) return { error: `“${row.key}” — ${keyError}` };
      if (row.key in requiredStamp) {
        return { error: `“${row.key}” is fixed by the current view` };
      }
      result[row.key] = row.value;
    }
    Object.assign(result, requiredStamp);
    if (!conditions.every((condition) => propertiesMatchCondition(result, condition))) {
      return { error: "The upload properties must match every filter in this view" };
    }
    return result;
  };

  const submit = () => {
    if (!name.trim() || scopes.length === 0) return;
    const grant: Omit<CreateShareGrant, "viewId"> = {
      name: name.trim(),
      scopes,
    };
    if (scopes.includes("write")) {
      const built = buildWriteStamp();
      if ("error" in built) {
        toast.error(built.error);
        return;
      }
      Object.assign(grant, { writeStamp: built });
      const items = Number(maxItems);
      if (maxItems.trim() && Number.isFinite(items) && items > 0) {
        Object.assign(grant, { maxItems: Math.floor(items) });
      }
      const mb = Number(maxTotalMb);
      if (maxTotalMb.trim() && Number.isFinite(mb) && mb > 0) {
        Object.assign(grant, { maxTotalBytes: Math.round(mb * 1024 * 1024) });
      }
    }
    const preset = EXPIRY_PRESETS.find((p) => p.id === expiry);
    if (preset?.days) {
      Object.assign(grant, {
        expiresAt: new Date(Date.now() + preset.days * 86_400_000).toISOString(),
      });
    }
    mutation.mutate({ grant, conditions });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {link ? (
          <>
            <DialogHeader>
              <DialogTitle>Share link created</DialogTitle>
              <DialogDescription>
                Anyone with this link can access the shared files. You can copy it again anytime
                from the view's share links.
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
              <HugeiconsIcon icon={Link01Icon} className="size-4 shrink-0 text-muted-foreground" />
              <input
                readOnly
                value={link}
                onFocus={(event) => event.currentTarget.select()}
                aria-label="Share link"
                className="min-w-0 flex-1 bg-transparent font-mono text-xs text-foreground outline-none"
              />
              <CopyButton value={link} label="Copy" size="sm" variant="secondary" />
            </div>
            <DialogFooter>
              <DialogClose render={<Button>Done</Button>} />
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Share these files</DialogTitle>
              <DialogDescription>
                Create a secret link that gives anyone who has it access to the files below.
              </DialogDescription>
            </DialogHeader>
            <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
              <Field>
                <FieldLabel htmlFor="share-name">Name</FieldLabel>
                <Input
                  id="share-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Client drop"
                  required
                />
                {!viewId && (
                  <p className="text-xs text-muted-foreground">
                    A view “{name.trim() || "…"}” will be saved to your sidebar.
                  </p>
                )}
              </Field>

              <Field>
                <FieldLabel>Shared files</FieldLabel>
                {summary.length === 0 ? (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    No filters applied — this link shares all of your files.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                    {summary.map((phrase) => (
                      <li key={phrase} className="flex items-center gap-2">
                        <span className="size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                        {phrase}
                      </li>
                    ))}
                  </ul>
                )}
              </Field>

              <FieldSet>
                <FieldLegend variant="label">Access</FieldLegend>
                <div className="flex flex-col gap-3">
                  <Field orientation="horizontal" className="w-auto">
                    <Checkbox
                      id="share-read"
                      checked={canRead}
                      onCheckedChange={(v) => setCanRead(Boolean(v))}
                    />
                    <FieldLabel htmlFor="share-read" className="font-normal">
                      Can view & download
                    </FieldLabel>
                  </Field>
                  <Field orientation="horizontal" className="w-auto">
                    <Checkbox
                      id="share-write"
                      checked={canWrite}
                      disabled={writeBlocked}
                      onCheckedChange={(v) => setCanWrite(Boolean(v))}
                    />
                    <FieldLabel htmlFor="share-write" className="font-normal">
                      Can upload
                    </FieldLabel>
                  </Field>
                  {writeBlocked ? (
                    <p className="text-xs text-muted-foreground">
                      Uploads are available for views filtered by properties, so incoming files can
                      be tagged automatically. This view also filters by {blockingKeys.join(", ")},
                      which uploads can’t match.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Uploaded files are tagged so they appear in this share.
                    </p>
                  )}
                </div>
              </FieldSet>

              {canWrite && !writeBlocked && (
                <FieldSet>
                  <FieldLegend variant="label">Applied to uploads</FieldLegend>
                  <p className="text-xs text-muted-foreground">
                    These properties are stamped on every uploaded file so it appears in this share.
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1.5">
                    <PropertyStampChips
                      locked={requiredStampEntries.map(([key, value]) => ({ key, value }))}
                      value={stamp}
                      onChange={setStamp}
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap gap-4">
                    <Field className="w-40">
                      <FieldLabel htmlFor="share-max-items">Max uploads</FieldLabel>
                      <Input
                        id="share-max-items"
                        type="number"
                        min={1}
                        placeholder="unlimited"
                        value={maxItems}
                        onChange={(e) => setMaxItems(e.target.value)}
                      />
                    </Field>
                    <Field className="w-40">
                      <FieldLabel htmlFor="share-max-mb">Max total (MB)</FieldLabel>
                      <Input
                        id="share-max-mb"
                        type="number"
                        min={1}
                        placeholder="unlimited"
                        value={maxTotalMb}
                        onChange={(e) => setMaxTotalMb(e.target.value)}
                      />
                    </Field>
                  </div>
                </FieldSet>
              )}

              <Field className="w-48">
                <FieldLabel>Expires</FieldLabel>
                <Select value={expiry} onValueChange={(v) => setExpiry(v as typeof expiry)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {EXPIRY_PRESETS.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <DialogFooter>
              <DialogClose render={<Button variant="outline">Cancel</Button>} />
              <Button
                onClick={submit}
                disabled={mutation.isPending || !name.trim() || scopes.length === 0}
              >
                {mutation.isPending ? "Creating…" : "Create link"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
