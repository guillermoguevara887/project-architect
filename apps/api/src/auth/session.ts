import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "architect_session";
const SESSION_DURATION_SECONDS = 8 * 60 * 60;
const DEVELOPMENT_SECRET =
  "architect-development-cookie-secret-change-before-production";

type SessionPayload = {
  version: 1;
  userId: string;
  expiresAt: number;
};

function isProduction() {
  return (
    process.env.NODE_ENV === "production" || process.env.APP_ENV === "production"
  );
}

function getSessionSecret() {
  const configuredSecret = process.env.AUTH_COOKIE_SECRET;

  if (configuredSecret && configuredSecret.length >= 32) {
    return configuredSecret;
  }

  if (isProduction()) {
    throw new Error(
      "AUTH_COOKIE_SECRET must contain at least 32 characters in production.",
    );
  }

  return DEVELOPMENT_SECRET;
}

export function assertSessionConfiguration() {
  getSessionSecret();
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret())
    .update(value)
    .digest("base64url");
}

function serializeCookie(value: string, maxAge: number) {
  const attributes = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];

  if (isProduction()) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function createSessionCookie(userId: string) {
  const payload: SessionPayload = {
    version: 1,
    userId,
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );

  return serializeCookie(
    `${encodedPayload}.${sign(encodedPayload)}`,
    SESSION_DURATION_SECONDS,
  );
}

export function clearSessionCookie() {
  return `${serializeCookie("", 0)}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function readCookie(cookieHeader: string | undefined) {
  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex < 0) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();

    if (name === COOKIE_NAME) {
      return cookie.slice(separatorIndex + 1).trim();
    }
  }

  return null;
}

export function readSessionUserId(cookieHeader: string | undefined) {
  const token = readCookie(cookieHeader);

  if (!token) {
    return null;
  }

  const [encodedPayload, receivedSignature] = token.split(".");

  if (!encodedPayload || !receivedSignature) {
    return null;
  }

  const expectedSignature = Buffer.from(sign(encodedPayload));
  const providedSignature = Buffer.from(receivedSignature);

  if (
    expectedSignature.length !== providedSignature.length ||
    !timingSafeEqual(expectedSignature, providedSignature)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<SessionPayload>;

    if (
      payload.version !== 1 ||
      typeof payload.userId !== "string" ||
      payload.userId.length === 0 ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return payload.userId;
  } catch {
    return null;
  }
}
