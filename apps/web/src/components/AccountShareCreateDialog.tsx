import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  propertiesMatchCondition,
  type CreateAccountShare,
  type PropertyValue,
  type QueryCondition,
  type ShareScope,
} from "@keva/schema";
import { accountSharesQueryKey, createAccountShare } from "../lib/account-shares";
import { errorMessage } from "../lib/errors";
import { uploadStampFrom } from "../lib/upload-stamp";
import { validateKey } from "../lib/properties";
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

interface AccountShareCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  viewId: string;
  viewName: string;
  conditions: QueryCondition[];
}

const isStampableKey = (key: string): boolean => !key.startsWith("system.") && key !== "name";
const EXPIRY_PRESETS = [
  { id: "never", label: "Never", days: null },
  { id: "1d", label: "1 day", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
] as const;

export function AccountShareCreateDialog({
  open,
  onOpenChange,
  viewId,
  viewName,
  conditions,
}: AccountShareCreateDialogProps) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [canRead, setCanRead] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [stamp, setStamp] = useState<PropertyStampChip[]>([]);
  const [maxItems, setMaxItems] = useState("");
  const [maxTotalMb, setMaxTotalMb] = useState("");
  const [expiry, setExpiry] = useState<(typeof EXPIRY_PRESETS)[number]["id"]>("never");
  const requiredStamp = uploadStampFrom(conditions);
  const requiredStampEntries = Object.entries(requiredStamp);
  const writeBlocked = conditions.some((condition) => !isStampableKey(condition.key));

  const mutation = useMutation({
    mutationFn: createAccountShare,
    onSuccess: () => {
      toast.success(`Invitation sent to ${email.trim()}`);
      void queryClient.invalidateQueries({ queryKey: accountSharesQueryKey });
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const scopes: ShareScope[] = [
    ...(canRead ? (["read"] as const) : []),
    ...(canWrite && !writeBlocked ? (["write"] as const) : []),
  ];

  const submit = () => {
    if (!email.trim() || scopes.length === 0) return;
    const input: CreateAccountShare = { recipientEmail: email.trim(), viewId, scopes };
    if (scopes.includes("write")) {
      const writeStamp: Record<string, PropertyValue> = {};
      for (const row of stamp) {
        const keyError = validateKey(row.key);
        if (keyError) {
          toast.error(`“${row.key}” — ${keyError}`);
          return;
        }
        if (row.key in requiredStamp) {
          toast.error(`“${row.key}” is fixed by this view`);
          return;
        }
        writeStamp[row.key] = row.value;
      }
      Object.assign(writeStamp, requiredStamp);
      if (!conditions.every((condition) => propertiesMatchCondition(writeStamp, condition))) {
        toast.error("The upload properties must match every filter in this view");
        return;
      }
      Object.assign(input, { writeStamp });
      const items = Number(maxItems);
      if (maxItems.trim() && Number.isFinite(items) && items > 0) {
        Object.assign(input, { maxItems: Math.floor(items) });
      }
      const mb = Number(maxTotalMb);
      if (maxTotalMb.trim() && Number.isFinite(mb) && mb > 0) {
        Object.assign(input, { maxTotalBytes: Math.round(mb * 1024 * 1024) });
      }
    }
    const preset = EXPIRY_PRESETS.find((candidate) => candidate.id === expiry);
    if (preset?.days) {
      Object.assign(input, {
        expiresAt: new Date(Date.now() + preset.days * 86_400_000).toISOString(),
      });
    }
    mutation.mutate(input);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite to {viewName}</DialogTitle>
          <DialogDescription>
            Enter the exact email for an existing Keva account. They must accept before gaining
            access.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto pr-1">
          <Field>
            <FieldLabel htmlFor="account-share-email">Email</FieldLabel>
            <Input
              id="account-share-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="person@example.com"
            />
          </Field>

          <FieldSet>
            <FieldLegend variant="label">Access</FieldLegend>
            <div className="flex flex-col gap-3">
              <Field orientation="horizontal" className="w-auto">
                <Checkbox
                  id="account-share-read"
                  checked={canRead}
                  onCheckedChange={(value) => setCanRead(Boolean(value))}
                />
                <FieldLabel htmlFor="account-share-read" className="font-normal">
                  Can view & download
                </FieldLabel>
              </Field>
              <Field orientation="horizontal" className="w-auto">
                <Checkbox
                  id="account-share-write"
                  checked={canWrite}
                  disabled={writeBlocked}
                  onCheckedChange={(value) => setCanWrite(Boolean(value))}
                />
                <FieldLabel htmlFor="account-share-write" className="font-normal">
                  Can upload
                </FieldLabel>
              </Field>
              {writeBlocked && (
                <p className="text-xs text-muted-foreground">
                  Upload access requires a view filtered only by custom properties.
                </p>
              )}
            </div>
          </FieldSet>

          {canWrite && !writeBlocked && (
            <FieldSet>
              <FieldLegend variant="label">Applied to uploads</FieldLegend>
              <p className="text-xs text-muted-foreground">
                These owner-controlled properties are applied to every file they upload.
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
                  <FieldLabel htmlFor="account-share-max-items">Max uploads</FieldLabel>
                  <Input
                    id="account-share-max-items"
                    type="number"
                    min={1}
                    placeholder="unlimited"
                    value={maxItems}
                    onChange={(event) => setMaxItems(event.target.value)}
                  />
                </Field>
                <Field className="w-40">
                  <FieldLabel htmlFor="account-share-max-mb">Max total (MB)</FieldLabel>
                  <Input
                    id="account-share-max-mb"
                    type="number"
                    min={1}
                    placeholder="unlimited"
                    value={maxTotalMb}
                    onChange={(event) => setMaxTotalMb(event.target.value)}
                  />
                </Field>
              </div>
            </FieldSet>
          )}

          <Field className="w-48">
            <FieldLabel>Expires</FieldLabel>
            <Select value={expiry} onValueChange={(value) => setExpiry(value as typeof expiry)}>
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

          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            <div className="mb-1 flex items-center gap-2 font-medium text-foreground">
              <UserPlus className="size-4" />
              Files stay in your space
            </div>
            Uploaded files use your storage and remain under your control. Invitees cannot edit
            properties or delete files.
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            onClick={submit}
            disabled={mutation.isPending || !email.trim() || scopes.length === 0}
          >
            {mutation.isPending ? "Sending…" : "Send invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
