import type { IncomingMessage, ServerResponse } from "node:http";
import Fastify from "fastify";
import { configureServer } from "./create-server.js";

const server = configureServer(Fastify({ logger: true }));
const serverReady = server.ready();

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await serverReady;
  server.server.emit("request", request, response);
}
