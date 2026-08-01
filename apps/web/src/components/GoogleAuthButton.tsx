import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden data-icon="inline-start">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.74 2.98-4.31 2.98-7.4Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.98-.9 6.63-2.42l-3.24-2.54c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.87A6.01 6.01 0 0 1 6.07 12c0-.65.11-1.28.32-1.87V7.51H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.49l3.35-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 6c1.47 0 2.79.51 3.82 1.5l2.88-2.88A9.68 9.68 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.35 2.62C7.18 7.76 9.39 6 12 6Z"
      />
    </svg>
  );
}

export function GoogleAuthButton({
  busy,
  disabled,
  onClick,
}: {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Button type="button" variant="outline" size="lg" disabled={disabled} onClick={onClick}>
        {busy ? <Spinner data-icon="inline-start" /> : <GoogleIcon />}
        {busy ? "Connecting to Google…" : "Continue with Google"}
      </Button>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <Separator />
        <span className="text-xs font-medium text-muted-foreground">or continue with email</span>
        <Separator />
      </div>
    </div>
  );
}
