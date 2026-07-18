import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { authClient } from "../lib/auth";
import { oauthContinuation } from "../lib/oauth";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "../components/AuthLayout";
import { PasswordInput } from "../components/PasswordInput";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { BILLING_PLANS } from "@keva/schema";

export function LoginPage() {
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Sign in failed.");
        return;
      }
      const continuation = oauthContinuation(window.location.search);
      const selectedPlan = new URLSearchParams(window.location.search).get("plan");
      const planDestination = BILLING_PLANS.some((candidate) => candidate.slug === selectedPlan)
        ? `/settings?plan=${encodeURIComponent(selectedPlan!)}`
        : null;
      const from = (location.state as { from?: unknown } | null)?.from;
      const returnPath = typeof from === "string" && from.startsWith("/") ? from : "/";
      window.location.replace(continuation ?? planDestination ?? returnPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to your keva account to continue.</p>
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
              autoComplete="current-password"
              required
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </FieldGroup>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link
          to={{ pathname: "/signup", search: window.location.search }}
          className="font-medium text-primary hover:underline"
        >
          Create one
        </Link>
      </p>
    </AuthLayout>
  );
}
