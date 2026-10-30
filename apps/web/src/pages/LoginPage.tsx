import { Effect, Schema } from "effect";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { authClient } from "../lib/auth";
import { authOperationEffect } from "../lib/auth-effect";
import { errorMessage } from "../lib/errors";
import {
  authContinuationSearch,
  authErrorMessage,
  loginContinuation,
} from "../lib/auth-continuation";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "../components/AuthLayout";
import { GoogleAuthButton } from "../components/GoogleAuthButton";
import { PasswordInput } from "../components/PasswordInput";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const LoginLocationState = Schema.Struct({ from: Schema.optional(Schema.String) });

export function LoginPage() {
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => authErrorMessage(window.location.search));
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const from = Schema.is(LoginLocationState)(location.state) ? location.state.from : undefined;
  const continuationSearch = authContinuationSearch(window.location.search);
  const destination = loginContinuation(continuationSearch, from);
  const authPage = `${window.location.pathname}${continuationSearch}`;
  const busy = passwordBusy || googleBusy;

  const onGoogleSignIn = () => {
    setError(null);
    setGoogleBusy(true);
    const signIn = authOperationEffect(() =>
      authClient.signIn.social({
        provider: "google",
        callbackURL: destination,
        errorCallbackURL: authPage,
      }),
    ).pipe(
      Effect.match({
        onFailure: (failure) => setError(errorMessage(failure)),
        onSuccess: () => undefined,
      }),
      Effect.ensuring(Effect.sync(() => setGoogleBusy(false))),
    );
    void Effect.runPromise(signIn);
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setPasswordBusy(true);
    const signIn = authOperationEffect(() => authClient.signIn.email({ email, password })).pipe(
      Effect.match({
        onFailure: (failure) => setError(errorMessage(failure)),
        onSuccess: () => window.location.replace(destination),
      }),
      Effect.ensuring(Effect.sync(() => setPasswordBusy(false))),
    );
    void Effect.runPromise(signIn);
  };

  return (
    <AuthLayout>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to your keva account to continue.</p>
      </div>
      <GoogleAuthButton busy={googleBusy} disabled={busy} onClick={onGoogleSignIn} />
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
            {passwordBusy && <Spinner data-icon="inline-start" />}
            {passwordBusy ? "Signing in…" : "Sign in"}
          </Button>
        </FieldGroup>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link
          to={{ pathname: "/signup", search: continuationSearch }}
          className="font-medium text-primary hover:underline"
        >
          Create one
        </Link>
      </p>
    </AuthLayout>
  );
}
