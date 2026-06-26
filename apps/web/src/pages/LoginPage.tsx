import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IconAlertTriangle, IconDatabase } from "@tabler/icons-react";
import { authClient } from "../lib/auth";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PasswordInput } from "../components/PasswordInput";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

export function LoginPage() {
  const navigate = useNavigate();
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
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-2 font-heading text-lg font-semibold">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <IconDatabase className="size-5" />
          </div>
          keva
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Welcome back. Enter your credentials to continue.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit}>
              <FieldGroup>
                {error && (
                  <Alert variant="destructive">
                    <IconAlertTriangle />
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
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link to="/signup" className="text-primary hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
