import { sql } from "drizzle-orm";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import {
  architectProjectStore,
  type ArchitectProjectStore,
} from "./architect-projects/repository.js";
import { registerArchitectProjectRoutes } from "./architect-projects/routes.js";
import { authStore, type AuthStore } from "./auth/repository.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { assertSessionConfiguration } from "./auth/session.js";
import { closeDbConnection, getDb } from "./db/client.js";
import { journeyStore, type JourneyStore } from "./journey/repository.js";
import { registerJourneyRoutes } from "./journey/routes.js";

type ServerDependencies = {
  authStore?: AuthStore;
  architectProjectStore?: ArchitectProjectStore;
  journeyStore?: JourneyStore;
};

export function configureServer(
  server: FastifyInstance,
  dependencies: ServerDependencies = {},
) {
  assertSessionConfiguration();
  const configuredAuthStore = dependencies.authStore ?? authStore;

  server.get("/health", async () => {
    return {
      status: "ok",
      service: "memoos-api",
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

  registerAuthRoutes(server, configuredAuthStore);
  registerArchitectProjectRoutes(
    server,
    dependencies.architectProjectStore ?? architectProjectStore,
    configuredAuthStore,
  );
  registerJourneyRoutes(
    server,
    dependencies.journeyStore ?? journeyStore,
    configuredAuthStore,
  );

  server.addHook("onClose", async () => {
    await closeDbConnection();
  });

  return server;
}

export function createServer(
  options: FastifyServerOptions = {},
  dependencies: ServerDependencies = {},
) {
  return configureServer(Fastify(options), dependencies);
}
