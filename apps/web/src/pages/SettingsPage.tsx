import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "../lib/auth";
import { PageHeader } from "../components/PageHeader";
import { AppearanceCard } from "../components/AppearanceCard";
import { PasswordInput } from "../components/PasswordInput";
import { StorageUsageCard } from "../components/StorageUsageCard";
import { SubscriptionCard } from "../components/SubscriptionCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export function SettingsPage() {
  const { data } = authClient.useSession();
  const email = data?.user?.email ?? "";

  const [name, setName] = useState(data?.user?.name ?? "");
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const onSaveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingName(true);
    try {
      const result = await authClient.updateUser({ name: name.trim() });
      if (result.error) {
        toast.error(result.error.message ?? "Could not update profile.");
        return;
      }
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update profile.");
    } finally {
      setSavingName(false);
    }
  };

  const onChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingPassword(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        toast.error(result.error.message ?? "Could not change password.");
        return;
      }
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change password.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" description="Manage your account." />

      <div className="flex flex-col gap-6">
        <SubscriptionCard />

        <StorageUsageCard />

        <AppearanceCard />

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Your display name and email.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSaveProfile}>
              <FieldGroup>
                <Field className="max-w-sm">
                  <FieldLabel htmlFor="name">Name</FieldLabel>
                  <Input
                    id="name"
                    value={name}
                    autoComplete="name"
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field className="max-w-sm">
                  <FieldLabel htmlFor="email">Email</FieldLabel>
                  <Input id="email" value={email} disabled readOnly />
                </Field>
                <Button type="submit" className="w-fit" disabled={savingName || !name.trim()}>
                  {savingName && <Spinner data-icon="inline-start" />}
                  Save
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              Other sessions are signed out when you change your password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onChangePassword}>
              <FieldGroup>
                <Field className="max-w-sm">
                  <FieldLabel htmlFor="current-password">Current password</FieldLabel>
                  <PasswordInput
                    id="current-password"
                    value={currentPassword}
                    autoComplete="current-password"
                    required
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </Field>
                <Field className="max-w-sm">
                  <FieldLabel htmlFor="new-password">New password</FieldLabel>
                  <PasswordInput
                    id="new-password"
                    value={newPassword}
                    autoComplete="new-password"
                    required
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </Field>
                <Button
                  type="submit"
                  className="w-fit"
                  disabled={savingPassword || !currentPassword || !newPassword}
                >
                  {savingPassword && <Spinner data-icon="inline-start" />}
                  Update password
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
