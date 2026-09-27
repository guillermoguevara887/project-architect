import type { FastifyInstance } from "fastify";
import { requireSuperadmin } from "../auth/authorization.js";
import type { AuthStore } from "../auth/repository.js";
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
}
