import Fastify, { type FastifyServerOptions } from "fastify";
import {
  HealthResponseSchema,
  type HealthResponse,
} from "@project-architect/contracts";
import { discoveryStore } from "./discovery/repository.js";
import { registerDiscoveryRoutes } from "./discovery/routes.js";
import {
  createDiscoveryService,
  type DiscoveryService,
} from "./discovery/service.js";
import { registerProjectRoutes } from "./projects/routes.js";

type ServerDependencies = {
  discoveryService?: DiscoveryService;
};

export function createServer(
  options: FastifyServerOptions = {},
  dependencies: ServerDependencies = {},
) {
  const server = Fastify(options);
  const discoveryService =
    dependencies.discoveryService ?? createDiscoveryService(discoveryStore);

  server.get("/health", async (): Promise<HealthResponse> => {
    return HealthResponseSchema.parse({
      status: "ok",
      service: "project-architect-api",
    });
  });

  registerProjectRoutes(server, discoveryService);
  registerDiscoveryRoutes(server, discoveryService);

  return server;
}
