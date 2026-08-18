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
import {
  languageLessonProcessor,
  type LanguageLessonProcessor,
} from "./languages/lesson-processor.js";
import { languageStore, type LanguageStore } from "./languages/repository.js";
import { registerLanguageRoutes } from "./languages/routes.js";

type ServerDependencies = {
  authStore?: AuthStore;
  architectProjectStore?: ArchitectProjectStore;
  journeyStore?: JourneyStore;
  languageStore?: LanguageStore;
  languageLessonProcessor?: LanguageLessonProcessor;
};

function databaseFailureReason(error: unknown) {
  if (!(error instanceof Error)) {
    return "connection_failed";
  }

  const code =
    "code" in error && typeof error.code === "string" ? error.code : undefined;

  if (error.message === "DATABASE_URL is not configured.") {
    return "not_configured";
  }

  if (code === "ERR_INVALID_URL") {
    return "invalid_url";
  }

  if (code === "ENOTFOUND") {
    return "host_not_found";
  }

  if (code === "ECONNREFUSED") {
    return "connection_refused";
  }

  if (code === "ETIMEDOUT" || code === "CONNECT_TIMEOUT") {
    return "connection_timeout";
  }

  if (code === "28P01") {
    return "authentication_failed";
  }

  if (code === "3D000") {
    return "database_not_found";
  }

  if (code?.startsWith("ERR_TLS") || code?.includes("CERT")) {
    return "tls_failed";
  }

  return "connection_failed";
}

export function configureServer(
  server: FastifyInstance,
  dependencies: ServerDependencies = {},
) {
  assertSessionConfiguration();
  const configuredAuthStore = dependencies.authStore ?? authStore;

  server.get("/", async () => {
    return {
      status: "ok",
      service: "memoos-api",
    };
  });

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
        reason: databaseFailureReason(error),
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
  registerLanguageRoutes(
    server,
    dependencies.languageStore ?? languageStore,
    configuredAuthStore,
    dependencies.languageLessonProcessor ?? languageLessonProcessor,
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
