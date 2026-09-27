import { z } from "zod";
import {
  emailSchema,
  newPasswordSchema,
  usernameSchema,
} from "../account/contracts.js";

export const adminUserCreateSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema.optional(),
    password: newPasswordSchema,
  })
  .strict();
