import { Effect } from "effect";
import type { AvatarRecipe } from "@keva/schema";
import { CreditCard, HardDrive, Palette, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { AppearanceCard } from "../components/AppearanceCard";
import { AvatarEditor } from "../components/AvatarEditor";
import { PasswordInput } from "../components/PasswordInput";
import { StorageUsageCard } from "../components/StorageUsageCard";
import { SubscriptionCard } from "../components/SubscriptionCard";
import { UserAvatar } from "../components/UserAvatar";
import { appCommit, appVersion } from "../lib/app-meta";
import { authClient } from "../lib/auth";
import { authOperationEffect } from "../lib/auth-effect";
import { errorMessage } from "../lib/errors";
import { avatarRecipeForUser, serializeAvatarRecipe } from "../lib/avatar";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SETTINGS_SECTIONS = ["profile", "security", "billing", "storage", "appearance"] as const;
const SETTINGS_FADE_IN = "motion-safe:animate-[settings-fade-in_300ms_ease-out_both]";
type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const isSettingsSection = (value: string | undefined): value is SettingsSection =>
  SETTINGS_SECTIONS.some((section) => section === value);

const ACCOUNT_ITEMS = [
  { value: "profile", label: "Profile", icon: UserRound },
  { value: "security", label: "Security", icon: ShieldCheck },
] as const;

const WORKSPACE_ITEMS = [
  { value: "billing", label: "Billing", icon: CreditCard },
  { value: "storage", label: "Storage", icon: HardDrive },
  { value: "appearance", label: "Appearance", icon: Palette },
] as const;

interface SettingsUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly avatar: string | null | undefined;
}

function SettingsNavigation() {
  return (
    <nav aria-label="Settings sections" className="md:sticky md:top-6 md:self-start">
      <TabsList className="grid h-auto w-full grid-cols-2 justify-start gap-1 bg-transparent p-0 group-data-horizontal/tabs:h-auto sm:grid-cols-3 md:flex md:flex-col md:items-stretch md:gap-6">
        <div className="contents md:flex md:flex-col md:gap-1">
          <p className="hidden px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground md:block">
            Account
          </p>
          {ACCOUNT_ITEMS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-9 w-full justify-start gap-2 px-3 text-muted-foreground shadow-none data-active:bg-muted data-active:text-foreground data-active:shadow-none"
            >
              <Icon />
              {label}
            </TabsTrigger>
          ))}
        </div>
        <div className="contents md:flex md:flex-col md:gap-1">
          <p className="hidden px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground md:block">
            Workspace
          </p>
          {WORKSPACE_ITEMS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="h-9 w-full justify-start gap-2 px-3 text-muted-foreground shadow-none data-active:bg-muted data-active:text-foreground data-active:shadow-none"
            >
              <Icon />
              {label}
            </TabsTrigger>
          ))}
        </div>
      </TabsList>
    </nav>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <header className="pb-5">
      <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
    </header>
  );
}

function saveAvatar(recipe: AvatarRecipe | null): Promise<boolean> {
  return Effect.runPromise(
    authOperationEffect(() =>
      authClient.updateUser({ avatar: recipe ? serializeAvatarRecipe(recipe) : null }),
    ).pipe(
      Effect.match({
        onFailure: (failure) => {
          toast.error(errorMessage(failure));
          return false;
        },
        onSuccess: () => {
          toast.success(recipe ? "Avatar updated" : "Avatar reset");
          return true;
        },
      }),
    ),
  );
}

function ProfileSettings({ user }: { user: SettingsUser }) {
  const [savingName, setSavingName] = useState(false);

  const onSaveProfile = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;

    setSavingName(true);
    const save = authOperationEffect(() => authClient.updateUser({ name })).pipe(
      Effect.match({
        onFailure: (failure) => toast.error(errorMessage(failure)),
        onSuccess: () => toast.success("Profile updated"),
      }),
      Effect.ensuring(Effect.sync(() => setSavingName(false))),
    );
    void Effect.runPromise(save);
  };

  return (
    <div>
      <SectionHeading title="Profile" />
      <Separator />

      <section className="grid gap-5 py-6 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div>
          <h3 className="font-medium">Profile picture</h3>
          <p className="mt-1 text-sm text-muted-foreground">Choose an avatar for your account.</p>
        </div>
        <div className="flex items-center gap-4 sm:justify-self-start">
          <UserAvatar
            avatar={avatarRecipeForUser(user.id, user.avatar)}
            name={user.name || user.email}
            className="size-16"
            labelled
          />
          <AvatarEditor
            key={`${user.id}:${user.avatar ?? "default"}`}
            userId={user.id}
            name={user.name || user.email}
            avatar={user.avatar}
            onSave={saveAvatar}
          />
        </div>
      </section>

      <Separator />

      <form
        onSubmit={onSaveProfile}
        className="grid gap-5 py-6 sm:grid-cols-[minmax(0,15rem)_minmax(0,28rem)]"
      >
        <div>
          <h3 className="font-medium">Personal details</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Your name is visible to people you share with.
          </p>
        </div>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" name="name" defaultValue={user.name} autoComplete="name" />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input id="email" value={user.email} disabled readOnly />
          </Field>
          <Button type="submit" className="w-fit" disabled={savingName}>
            {savingName && <Spinner data-icon="inline-start" />}
            Save changes
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}

function SecuritySettings() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const onChangePassword = (event: React.FormEvent) => {
    event.preventDefault();
    setSavingPassword(true);
    const changePassword = authOperationEffect(() =>
      authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true }),
    ).pipe(
      Effect.match({
        onFailure: (failure) => toast.error(errorMessage(failure)),
        onSuccess: () => {
          toast.success("Password changed");
          setCurrentPassword("");
          setNewPassword("");
        },
      }),
      Effect.ensuring(Effect.sync(() => setSavingPassword(false))),
    );
    void Effect.runPromise(changePassword);
  };

  return (
    <div>
      <SectionHeading title="Security" />
      <Separator />
      <form
        onSubmit={onChangePassword}
        className="grid gap-5 py-6 sm:grid-cols-[minmax(0,15rem)_minmax(0,28rem)]"
      >
        <div>
          <h3 className="font-medium">Change password</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Other sessions are signed out after your password changes.
          </p>
        </div>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="current-password">Current password</FieldLabel>
            <PasswordInput
              id="current-password"
              value={currentPassword}
              autoComplete="current-password"
              required
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="new-password">New password</FieldLabel>
            <PasswordInput
              id="new-password"
              value={newPassword}
              autoComplete="new-password"
              required
              onChange={(event) => setNewPassword(event.target.value)}
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
      <Separator />
      <footer className="flex justify-end py-3">
        <p className="text-xs text-muted-foreground font-mono">
          {appVersion ? `Version ${appVersion.replace(/^v/, "")}` : `Commit ${appCommit}`}
        </p>
      </footer>
    </div>
  );
}

export function SettingsPage() {
  const { data } = authClient.useSession();
  const { section } = useParams<{ section: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const fallbackSection =
    new URLSearchParams(location.search).get("checkout") === "complete" ? "billing" : "profile";
  const activeSection = isSettingsSection(section) ? section : fallbackSection;

  if (section !== activeSection) {
    return <Navigate to={`/settings/${activeSection}${location.search}`} replace />;
  }

  return (
    <Tabs
      value={activeSection}
      onValueChange={(value) => navigate(`/settings/${value}`)}
      className={`grid min-w-0 gap-6 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10 2xl:grid-cols-[11rem_minmax(0,56rem)_11rem] 2xl:justify-between 2xl:gap-0 ${SETTINGS_FADE_IN}`}
    >
      <div className="pb-2 md:pb-0">
        <SettingsNavigation />
      </div>

      <main className="mx-auto w-full min-w-0 max-w-3xl 2xl:max-w-4xl">
        <TabsContent value="profile" className={SETTINGS_FADE_IN}>
          {data?.user ? (
            <ProfileSettings
              key={data.user.id}
              user={{
                id: data.user.id,
                name: data.user.name ?? "",
                email: data.user.email,
                avatar: data.user.avatar,
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <Spinner />
              <span className="sr-only">Loading profile</span>
            </div>
          )}
        </TabsContent>
        <TabsContent value="security" className={SETTINGS_FADE_IN}>
          <SecuritySettings />
        </TabsContent>
        <TabsContent value="billing" className={SETTINGS_FADE_IN}>
          <SubscriptionCard />
        </TabsContent>
        <TabsContent value="storage" className={SETTINGS_FADE_IN}>
          <StorageUsageCard />
        </TabsContent>
        <TabsContent value="appearance" className={SETTINGS_FADE_IN}>
          <AppearanceCard />
        </TabsContent>
      </main>
    </Tabs>
  );
}
