import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import type { CreateShareGrant, PropertyValue, QueryCondition, ShareScope } from "@keva/schema";
import { createShare, sharesQueryKey } from "../lib/shares";
import { createView, viewsQueryKey } from "../lib/views";
import { describeFilter } from "../lib/item-filters";
import { useApiError } from "../lib/useApiError";
import {
  coerceScalar,
  scalarToInput,
  validateKey,
  valueType,
  type ScalarType,
} from "../lib/properties";
import { CopyButton } from "./CopyButton";
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

interface StampRow {
  id: string;
  key: string;
  type: Exclude<ScalarType, "null">;
  value: string;
}

interface ShareCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // The view this link is built on. Conditions live on the view; the grant
  // references it by id (read live server-side). Empty when sharing from an
  // unsaved filtered state — the dialog then saves a view first (KEV-7), so the
  // link always rests on a real view.
  viewId: string;
  conditions: QueryCondition[];
}

const STAMP_TYPES = ["string", "number", "boolean"] as const;
const EXPIRY_PRESETS = [
  { id: "never", label: "Never", days: null },
  { id: "1d", label: "1 day", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
] as const;

const nextId = () => `stamp:${crypto.randomUUID()}`;

// A grant's write stamp must satisfy its conditions; system-field conditions
// (system.*) and `name` can't be represented by a property stamp, so they block
// enabling write (the server would reject them anyway).
const isStampableKey = (key: string): boolean => !key.startsWith("system.") && key !== "name";

// Seed stamp rows from the eq conditions on plain property keys — those are the
// values a matching upload must carry, so pre-filling them makes the common
// "share this filtered view for uploads too" case one click.
const seedStamp = (conditions: QueryCondition[]): StampRow[] =>
  conditions
    .filter(
      (c): c is QueryCondition & { value: PropertyValue } =>
        c.op === "eq" &&
        c.value !== undefined &&
        c.value !== null &&
        !Array.isArray(c.value) &&
        isStampableKey(c.key),
    )
    .map((c) => {
      const type = valueType(c.value);
      return {
        id: nextId(),
        key: c.key,
        type: type === "string" || type === "number" || type === "boolean" ? type : "string",
        value: scalarToInput(c.value),
      };
    });

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
  const [stamp, setStamp] = useState<StampRow[]>(() => seedStamp(conditions));
  const [maxItems, setMaxItems] = useState("");
  const [maxTotalMb, setMaxTotalMb] = useState("");
  const [expiry, setExpiry] = useState<(typeof EXPIRY_PRESETS)[number]["id"]>("never");
  const [link, setLink] = useState<string | null>(null);

  const blockingKeys = [
    ...new Set(conditions.filter((c) => !isStampableKey(c.key)).map((c) => c.key)),
  ];
  const writeBlocked = blockingKeys.length > 0;
  // Plain-language summary of what's shared, instead of raw query syntax (KEV-8).
  const summary = describeFilter(conditions);

  // Sharing from an unsaved filter (no viewId) saves a view first, then builds
  // the grant on it — so a link always rests on a real, sidebar-visible view.
  const mutation = useMutation({
    mutationFn: async ({
      grant,
      conditions: where,
    }: {
      grant: Omit<CreateShareGrant, "viewId">;
      conditions: readonly QueryCondition[];
    }) => {
      let targetViewId = viewId;
      if (!targetViewId) {
        const view = await createView({ name: grant.name, conditions: [...where] });
        targetViewId = view.id;
        void queryClient.invalidateQueries({ queryKey: viewsQueryKey });
      }
      return createShare({ ...grant, viewId: targetViewId });
    },
    onSuccess: (result) => {
      setLink(`${window.location.origin}/s/${result.token}`);
      void queryClient.invalidateQueries({ queryKey: sharesQueryKey });
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
      const key = row.key.trim();
      if (!key) continue;
      const keyError = validateKey(key);
      if (keyError) return { error: `“${key}” — ${keyError}` };
      result[key] = coerceScalar(row.type, row.value);
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
                Copy it now — for security, this link won't be shown again.
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
                  <div className="flex flex-col gap-2">
                    {stamp.map((row) => (
                      <div key={row.id} className="flex flex-wrap items-center gap-2">
                        <Input
                          placeholder="key"
                          className="w-40"
                          value={row.key}
                          onChange={(e) =>
                            setStamp((prev) =>
                              prev.map((r) =>
                                r.id === row.id ? { ...r, key: e.target.value } : r,
                              ),
                            )
                          }
                        />
                        <Select
                          value={row.type}
                          onValueChange={(next) =>
                            setStamp((prev) =>
                              prev.map((r) =>
                                r.id === row.id ? { ...r, type: next as StampRow["type"] } : r,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {STAMP_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <Input
                          placeholder="value"
                          className="w-40"
                          value={row.value}
                          onChange={(e) =>
                            setStamp((prev) =>
                              prev.map((r) =>
                                r.id === row.id ? { ...r, value: e.target.value } : r,
                              ),
                            )
                          }
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setStamp((prev) => prev.filter((r) => r.id !== row.id))}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-fit"
                      onClick={() =>
                        setStamp((prev) => [
                          ...prev,
                          { id: nextId(), key: "", type: "string", value: "" },
                        ])
                      }
                    >
                      Add property
                    </Button>
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
