import { z } from "zod";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "../auth/password.js";

const usernameSchema = z
  .string()
  .trim()
  .min(1, "El nombre de usuario es obligatorio.")
  .max(64, "El nombre de usuario no puede superar 64 caracteres.");

const emailSchema = z
  .string()
  .trim()
  .min(1, "El correo electrónico es obligatorio.")
  .max(320, "El correo electrónico es demasiado largo.")
  .email("Introduce un correo electrónico válido.")
  .transform((email) => email.toLowerCase());

const newPasswordSchema = z
  .string()
  .min(
    MIN_PASSWORD_LENGTH,
    `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  )
  .max(
    MAX_PASSWORD_LENGTH,
    `La contraseña no puede superar ${MAX_PASSWORD_LENGTH} caracteres.`,
  );

export const accountProfileUpdateSchema = z
  .object({
    username: usernameSchema.optional(),
    email: emailSchema.optional(),
  })
  .strict()
  .refine((value) => value.username !== undefined || value.email !== undefined, {
    message: "No se proporcionaron cambios.",
  });

export const authenticatedPasswordUpdateSchema = z
  .object({
    currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().max(MAX_PASSWORD_LENGTH),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({ email: emailSchema })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(32).max(512),
    newPassword: newPasswordSchema,
    confirmPassword: z.string().max(MAX_PASSWORD_LENGTH),
  })
  .strict();

export type AccountProfileUpdate = z.infer<typeof accountProfileUpdateSchema>;
