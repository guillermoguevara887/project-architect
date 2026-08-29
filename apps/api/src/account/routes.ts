import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { readSessionUserId } from "../auth/session.js";
import {
  accountProfileUpdateSchema,
  authenticatedPasswordUpdateSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "./contracts.js";
import {
  PasswordResetEmailConfigurationError,
  type PasswordResetMailer,
} from "./email.js";
import {
  AccountConflictError,
  type Account,
  type AccountStore,
} from "./repository.js";

const RESET_TOKEN_DURATION_MS = 45 * 60 * 1_000;
const GENERIC_RESET_MESSAGE =
  "Si existe una cuenta asociada a ese correo, recibirás un enlace para restablecer tu contraseña.";

export type AccountRouteDependencies = {
  accountStore: AccountStore;
  mailer: PasswordResetMailer;
  now?: () => Date;
  tokenGenerator?: () => string;
};

function publicAccount(account: Account) {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    createdAt: account.createdAt.toISOString(),
  };
}

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function authenticatedAccount(
  request: FastifyRequest,
  store: AccountStore,
) {
  const userId = readSessionUserId(request.headers.cookie);
  return userId ? store.findById(userId) : null;
}

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: "UNAUTHORIZED" });
}

function validationError(reply: FastifyReply, message: string) {
  return reply.code(400).send({
    error: "VALIDATION_ERROR",
    message,
  });
}

function firstValidationMessage(error: {
  issues: Array<{ message: string }>;
}) {
  return error.issues[0]?.message ?? "Los datos proporcionados no son válidos.";
}

export function registerAccountRoutes(
  server: FastifyInstance,
  dependencies: AccountRouteDependencies,
) {
  const now = dependencies.now ?? (() => new Date());
  const generateToken =
    dependencies.tokenGenerator ?? (() => randomBytes(32).toString("base64url"));

  server.get("/account", async (request, reply) => {
    try {
      const account = await authenticatedAccount(
        request,
        dependencies.accountStore,
      );

      if (!account) {
        return unauthorized(reply);
      }

      reply.header("cache-control", "no-store");
      return { account: publicAccount(account) };
    } catch (error) {
      server.log.error({ error }, "Account lookup failed.");
      return reply.code(503).send({
        error: "ACCOUNT_UNAVAILABLE",
        message: "No se pudo cargar la cuenta.",
      });
    }
  });

  server.patch("/account/profile", async (request, reply) => {
    const parsed = accountProfileUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      return validationError(reply, firstValidationMessage(parsed.error));
    }

    try {
      const account = await authenticatedAccount(
        request,
        dependencies.accountStore,
      );

      if (!account) {
        return unauthorized(reply);
      }

      const updated = await dependencies.accountStore.updateProfile(
        account.id,
        parsed.data,
      );

      if (!updated) {
        return unauthorized(reply);
      }

      return {
        account: publicAccount(updated),
        message:
          parsed.data.username !== undefined
            ? "Nombre de usuario actualizado"
            : "Correo electrónico actualizado",
      };
    } catch (error) {
      if (error instanceof AccountConflictError) {
        return reply.code(409).send({
          error:
            error.field === "username"
              ? "USERNAME_IN_USE"
              : "EMAIL_IN_USE",
          message:
            error.field === "username"
              ? "Este nombre de usuario ya está en uso"
              : "Este correo electrónico ya está en uso",
        });
      }

      server.log.error({ error }, "Account profile update failed.");
      return reply.code(503).send({
        error: "ACCOUNT_UNAVAILABLE",
        message: "No se pudo actualizar la cuenta.",
      });
    }
  });

  server.patch("/account/password", async (request, reply) => {
    const parsed = authenticatedPasswordUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      return validationError(reply, firstValidationMessage(parsed.error));
    }

    if (parsed.data.newPassword !== parsed.data.confirmPassword) {
      return validationError(reply, "Las contraseñas no coinciden");
    }

    try {
      const account = await authenticatedAccount(
        request,
        dependencies.accountStore,
      );

      if (!account) {
        return unauthorized(reply);
      }

      if (
        !(await verifyPassword(
          parsed.data.currentPassword,
          account.passwordHash,
        ))
      ) {
        return reply.code(400).send({
          error: "CURRENT_PASSWORD_INCORRECT",
          message: "La contraseña actual es incorrecta",
        });
      }

      const passwordHash = await hashPassword(parsed.data.newPassword);
      const updated = await dependencies.accountStore.updatePassword(
        account.id,
        passwordHash,
      );

      if (!updated) {
        return unauthorized(reply);
      }

      return { success: true, message: "Contraseña actualizada" };
    } catch (error) {
      server.log.error({ error }, "Authenticated password update failed.");
      return reply.code(503).send({
        error: "ACCOUNT_UNAVAILABLE",
        message: "No se pudo actualizar la contraseña.",
      });
    }
  });

  server.post("/auth/forgot-password", async (request, reply) => {
    const parsed = forgotPasswordSchema.safeParse(request.body);

    if (!parsed.success) {
      return validationError(reply, firstValidationMessage(parsed.error));
    }

    try {
      dependencies.mailer.assertConfigured();
    } catch (error) {
      if (error instanceof PasswordResetEmailConfigurationError) {
        return reply.code(503).send({
          error: "PASSWORD_RESET_EMAIL_NOT_CONFIGURED",
          message: "La recuperación por correo no está configurada.",
          missingVariables: error.missingVariables,
        });
      }

      throw error;
    }

    try {
      const account = await dependencies.accountStore.findByEmail(
        parsed.data.email,
      );

      if (!account) {
        return reply.code(202).send({ message: GENERIC_RESET_MESSAGE });
      }

      const rawToken = generateToken();
      const hashedToken = tokenHash(rawToken);
      const requestedAt = now();
      await dependencies.accountStore.createPasswordResetToken({
        userId: account.id,
        tokenHash: hashedToken,
        expiresAt: new Date(requestedAt.getTime() + RESET_TOKEN_DURATION_MS),
      });

      try {
        await dependencies.mailer.sendPasswordResetEmail({
          recipient: parsed.data.email,
          token: rawToken,
        });
      } catch {
        await dependencies.accountStore.invalidatePasswordResetToken(
          hashedToken,
          now(),
        );
        server.log.error("Password reset email delivery failed.");
        return reply.code(503).send({
          error: "PASSWORD_RESET_EMAIL_UNAVAILABLE",
          message: "No se pudo enviar el correo de recuperación.",
        });
      }

      return reply.code(202).send({ message: GENERIC_RESET_MESSAGE });
    } catch (error) {
      server.log.error({ error }, "Password reset request failed.");
      return reply.code(503).send({
        error: "PASSWORD_RESET_UNAVAILABLE",
        message: "No se pudo procesar la recuperación.",
      });
    }
  });

  server.post("/auth/reset-password", async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);

    if (!parsed.success) {
      return validationError(reply, firstValidationMessage(parsed.error));
    }

    if (parsed.data.newPassword !== parsed.data.confirmPassword) {
      return validationError(reply, "Las contraseñas no coinciden");
    }

    const hashedToken = tokenHash(parsed.data.token);
    const requestedAt = now();

    try {
      if (
        !(await dependencies.accountStore.hasUsablePasswordResetToken(
          hashedToken,
          requestedAt,
        ))
      ) {
        return reply.code(400).send({
          error: "INVALID_PASSWORD_RESET_TOKEN",
          message: "El enlace de recuperación ha expirado o ya fue utilizado.",
        });
      }

      const passwordHash = await hashPassword(parsed.data.newPassword);
      const updated = await dependencies.accountStore.resetPasswordWithToken({
        tokenHash: hashedToken,
        passwordHash,
        now: now(),
      });

      if (!updated) {
        return reply.code(400).send({
          error: "INVALID_PASSWORD_RESET_TOKEN",
          message: "El enlace de recuperación ha expirado o ya fue utilizado.",
        });
      }

      return {
        success: true,
        message: "Contraseña actualizada. Ya puedes iniciar sesión.",
      };
    } catch (error) {
      server.log.error({ error }, "Password reset failed.");
      return reply.code(503).send({
        error: "PASSWORD_RESET_UNAVAILABLE",
        message: "No se pudo restablecer la contraseña.",
      });
    }
  });
}
