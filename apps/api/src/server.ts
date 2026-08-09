import { sql } from "drizzle-orm";
import Fastify, { type FastifyServerOptions } from "fastify";
import { authStore, type AuthStore } from "./auth/repository.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { assertSessionConfiguration } from "./auth/session.js";
import { closeDbConnection, getDb } from "./db/client.js";

type ServerDependencies = {
  authStore?: AuthStore;
};

export function createServer(
  options: FastifyServerOptions = {},
  dependencies: ServerDependencies = {},
) {
  assertSessionConfiguration();
  const server = Fastify(options);

  server.get("/health", async () => {
    return {
      status: "ok",
      service: "project-architect-api",
    };
  });

  server.get("/health/db", async (_request, reply) => {
    try {
      await getDb().execute(sql`select 1`);

      return {
        database: "connected",
      };
    } catch (error) {
      server.log.error({ error }, "Database health check failed.");

      return reply.code(503).send({
        database: "disconnected",
      });
    }
  });

  registerAuthRoutes(server, dependencies.authStore ?? authStore);

  server.addHook("onClose", async () => {
    await closeDbConnection();
  });

  return server;
}
