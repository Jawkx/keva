import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "../lib/auth";
import { PageHeader } from "../components/PageHeader";
import { AppearanceCard } from "../components/AppearanceCard";
import { PasswordInput } from "../components/PasswordInput";
import { StorageUsageCard } from "../components/StorageUsageCard";
import { SubscriptionCard } from "../components/SubscriptionCard";
import { AvatarEditor } from "../components/AvatarEditor";
import { UserAvatar } from "../components/UserAvatar";
import { avatarRecipeForUser, serializeAvatarRecipe } from "../lib/avatar";
import type { AvatarRecipe } from "@keva/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function SettingsPage() {
  const { data } = authClient.useSession();
  const email = data?.user?.email ?? "";
  const initialTab =
    new URLSearchParams(window.location.search).get("checkout") === "complete"
      ? "billing"
      : "account";

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

  const onSaveAvatar = async (recipe: AvatarRecipe | null): Promise<boolean> => {
    try {
      const result = await authClient.updateUser({
        avatar: recipe ? serializeAvatarRecipe(recipe) : null,
      });
      if (result.error) {
        toast.error(result.error.message ?? "Could not update avatar.");
        return false;
      }
      toast.success(recipe ? "Avatar updated" : "Avatar reset");
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update avatar.");
      return false;
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
      <PageHeader title="Settings" description="Manage your account, plan, and preferences." />

      <Tabs defaultValue={initialTab} className="gap-5">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList className="min-w-max">
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="storage">Storage</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="account">
          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>Your avatar, display name, and email.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-6">
                {data?.user && (
                  <div className="flex items-center gap-4 rounded-xl border bg-muted/20 p-4">
                    <UserAvatar
                      avatar={avatarRecipeForUser(data.user.id, data.user.avatar)}
                      name={data.user.name || data.user.email}
                      className="size-20"
                      labelled
                    />
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{data.user.name || data.user.email}</p>
                        <p className="text-xs text-muted-foreground">Lorelei by DiceBear</p>
                      </div>
                      <AvatarEditor
                        key={`${data.user.id}:${data.user.avatar ?? "default"}`}
                        userId={data.user.id}
                        name={data.user.name || data.user.email}
                        avatar={data.user.avatar}
                        onSave={onSaveAvatar}
                      />
                    </div>
                  </div>
                )}
                <form onSubmit={onSaveProfile}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="name">Name</FieldLabel>
                      <Input
                        id="name"
                        value={name}
                        autoComplete="name"
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <Field>
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
                    <Field>
                      <FieldLabel htmlFor="current-password">Current password</FieldLabel>
                      <PasswordInput
                        id="current-password"
                        value={currentPassword}
                        autoComplete="current-password"
                        required
                        onChange={(e) => setCurrentPassword(e.target.value)}
                      />
                    </Field>
                    <Field>
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
        </TabsContent>

        <TabsContent value="billing">
          <SubscriptionCard />
        </TabsContent>

        <TabsContent value="storage">
          <StorageUsageCard />
        </TabsContent>

        <TabsContent value="appearance">
          <AppearanceCard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
