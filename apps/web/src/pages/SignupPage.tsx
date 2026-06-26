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

export function SignupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await authClient.signUp.email({ email, password, name });
      if (result.error) {
        setError(result.error.message ?? "Sign up failed.");
        return;
      }
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed.");
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
            <CardTitle>Create account</CardTitle>
            <CardDescription>
              Your structured home for files — set it up in seconds.
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
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
