import type { preHandlerAsyncHookHandler } from "fastify";
import { readAuthenticatedUser } from "./authenticated-user.js";
import type { AuthStore } from "./repository.js";

// Register as preHandler: requireSuperadmin(store); Fastify stops rejected requests.
export function requireSuperadmin(store: AuthStore): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    try {
      const user = await readAuthenticatedUser(request, store);
      if (!user) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }
      if (user.role !== "superadmin") {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }
    } catch (error) {
      request.log.error({ error }, "Superadmin authorization failed.");
      return reply.code(503).send({
        authenticated: false,
        error: "AUTH_UNAVAILABLE",
      });
    }
  };
}
