import { Resend } from "resend";

export interface EmailVerificationConfig {
  readonly apiKey: string;
  readonly from: string;
}

export interface EmailVerificationEnv {
  readonly KEVA_ENVIRONMENT?: string | undefined;
  readonly RESEND_API_KEY?: string | undefined;
  readonly RESEND_FROM?: string | undefined;
}

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new Error(`${name} is required when KEVA_ENVIRONMENT=production`);
  return value;
};

export const emailVerificationConfigFor = (
  env: EmailVerificationEnv,
): EmailVerificationConfig | undefined => {
  if (env.KEVA_ENVIRONMENT !== "production") return undefined;
  return {
    apiKey: required(env.RESEND_API_KEY, "RESEND_API_KEY"),
    from: required(env.RESEND_FROM, "RESEND_FROM"),
  };
};

export const createVerificationEmailSender = (config: EmailVerificationConfig) => {
  const resend = new Resend(config.apiKey);
  return async ({
    email,
    url,
  }: {
    readonly email: string;
    readonly url: string;
  }): Promise<void> => {
    const { error } = await resend.emails.send({
      from: config.from,
      to: email,
      subject: "Verify your Keva account",
      text: `Verify your Keva account by opening this link:\n\n${url}\n\nThis link expires in one hour. If you did not create an account, you can ignore this email.`,
    });
    if (error) throw new Error(`Resend failed to send verification email: ${error.message}`);
  };
};
