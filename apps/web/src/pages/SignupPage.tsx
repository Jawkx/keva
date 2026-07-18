import { MailCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { authClient } from "../lib/auth";
import { oauthContinuation } from "../lib/oauth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordInput } from "../components/PasswordInput";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { BILLING_PLANS } from "@keva/schema";

const planContinuation = (): string | null => {
  const plan = new URLSearchParams(window.location.search).get("plan");
  return BILLING_PLANS.some((candidate) => candidate.slug === plan)
    ? `/settings?plan=${encodeURIComponent(plan!)}`
    : null;
};

export function SignupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const continuation = oauthContinuation(window.location.search);
      const destination = continuation ?? planContinuation() ?? "/";
      const result = await authClient.signUp.email({
        email,
        password,
        name,
        callbackURL: destination,
      });
      if (result.error) {
        setError(result.error.message ?? "Sign up failed.");
        return;
      }
      if (!result.data.token) {
        setVerificationSent(true);
        return;
      }
      window.location.replace(destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed.");
    } finally {
      setBusy(false);
    }
  };

  if (verificationSent) {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </p>
        </div>
        <Alert>
          <MailCheck />
          <AlertTitle>Open the link to finish signing up</AlertTitle>
          <AlertDescription>The link expires in one hour.</AlertDescription>
        </Alert>
        <p className="text-center text-sm text-muted-foreground">
          Already verified?{" "}
          <Link
            to={{ pathname: "/login", search: window.location.search }}
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Your structured home for files — set it up in seconds.
        </p>
      </div>
      <form onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>{error}</AlertTitle>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input
              id="name"
              type="text"
              value={name}
              autoComplete="name"
              required
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              value={email}
              autoComplete="email"
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <PasswordInput
              id="password"
              value={password}
              autoComplete="new-password"
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "Creating…" : "Create account"}
          </Button>
        </FieldGroup>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          to={{ pathname: "/login", search: window.location.search }}
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
