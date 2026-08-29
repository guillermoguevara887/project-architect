export type PasswordResetEmail = {
  recipient: string;
  token: string;
};

export interface PasswordResetMailer {
  assertConfigured(): void;
  sendPasswordResetEmail(message: PasswordResetEmail): Promise<void>;
}

export class PasswordResetEmailConfigurationError extends Error {
  constructor(readonly missingVariables: string[]) {
    super(
      `Password reset email is not configured: ${missingVariables.join(", ")}.`,
    );
    this.name = "PasswordResetEmailConfigurationError";
  }
}

export class PasswordResetEmailDeliveryError extends Error {
  constructor(readonly status: number) {
    super("The password reset email provider rejected the request.");
    this.name = "PasswordResetEmailDeliveryError";
  }
}

type ResendConfiguration = {
  apiKey: string;
  appUrl: URL;
  fromEmail: string;
};

function readConfiguration(): ResendConfiguration {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const fromEmail = process.env.PASSWORD_RESET_FROM_EMAIL?.trim();
  const appUrlValue = process.env.APP_URL?.trim();
  const missingVariables = [
    !apiKey ? "RESEND_API_KEY" : null,
    !fromEmail ? "PASSWORD_RESET_FROM_EMAIL" : null,
    !appUrlValue ? "APP_URL" : null,
  ].filter((value): value is string => value !== null);

  if (!apiKey || !fromEmail || !appUrlValue) {
    throw new PasswordResetEmailConfigurationError(missingVariables);
  }

  let appUrl: URL;

  try {
    appUrl = new URL(appUrlValue);
  } catch {
    throw new PasswordResetEmailConfigurationError(["APP_URL"]);
  }

  if (appUrl.protocol !== "http:" && appUrl.protocol !== "https:") {
    throw new PasswordResetEmailConfigurationError(["APP_URL"]);
  }

  return {
    apiKey,
    appUrl,
    fromEmail,
  };
}

function resetUrl(appUrl: URL, token: string) {
  const url = new URL("/reset-password", appUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export const resendPasswordResetMailer: PasswordResetMailer = {
  assertConfigured() {
    readConfiguration();
  },

  async sendPasswordResetEmail(message) {
    const configuration = readConfiguration();
    const url = resetUrl(configuration.appUrl, message.token);
    const safeUrl = escapeHtml(url);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${configuration.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: configuration.fromEmail,
        to: [message.recipient],
        subject: "Restablece tu contraseña de MemoOS",
        html:
          "<p>Has solicitado restablecer tu contraseña de MemoOS.</p>" +
          `<p><a href="${safeUrl}">Restablecer contraseña</a></p>` +
          "<p>Este enlace caduca en 45 minutos y solo puede utilizarse una vez.</p>",
        text:
          "Has solicitado restablecer tu contraseña de MemoOS.\n\n" +
          `${url}\n\n` +
          "Este enlace caduca en 45 minutos y solo puede utilizarse una vez.",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new PasswordResetEmailDeliveryError(response.status);
    }
  },
};
