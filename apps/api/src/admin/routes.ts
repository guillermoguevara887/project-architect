import type { FastifyInstance } from "fastify";
import { AccountConflictError } from "../account/repository.js";
import { requireSuperadmin } from "../auth/authorization.js";
import { hashPassword } from "../auth/password.js";
import type { AuthStore } from "../auth/repository.js";
import { adminUserCreateSchema } from "./contracts.js";
import type { AdminUserStore } from "./repository.js";

export function registerAdminRoutes(
  server: FastifyInstance,
  authStore: AuthStore,
  userStore: AdminUserStore,
) {
  server.get(
    "/admin/users",
    { preHandler: requireSuperadmin(authStore) },
    async (_request, reply) => {
      reply.header("cache-control", "no-store");

      try {
        const users = await userStore.listUsers();
        return {
          users: users.map(({ id, username, email, role }) => ({
            id,
            username,
            email,
            role,
          })),
        };
      } catch (error) {
        server.log.error({ error }, "Admin user listing failed.");
        return reply.code(503).send({ error: "ADMIN_UNAVAILABLE" });
      }
    },
  );

  server.post(
    "/admin/users",
    { preHandler: requireSuperadmin(authStore) },
    async (request, reply) => {
      reply.header("cache-control", "no-store");
      const parsed = adminUserCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "VALIDATION_ERROR",
          message:
            parsed.error.issues[0]?.message ??
            "Los datos proporcionados no son válidos.",
        });
      }

      try {
        const passwordHash = await hashPassword(parsed.data.password);
        const created = await userStore.createUser({
          username: parsed.data.username,
          email: parsed.data.email ?? null,
          passwordHash,
        });

        return reply.code(201).send({
          user: {
            id: created.id,
            username: created.username,
            email: created.email,
            role: created.role,
          },
        });
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

        server.log.error("Admin user creation failed.");
        return reply.code(503).send({
          error: "ADMIN_UNAVAILABLE",
          message: "No se pudo crear el usuario.",
        });
      }
    },
  );
}
