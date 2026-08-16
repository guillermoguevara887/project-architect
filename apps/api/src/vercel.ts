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

  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      response.off("finish", finish);
      response.off("close", finish);
      response.off("error", fail);
      resolve();
    };
    const fail = (error: Error) => {
      response.off("finish", finish);
      response.off("close", finish);
      response.off("error", fail);
      reject(error);
    };

    response.once("finish", finish);
    response.once("close", finish);
    response.once("error", fail);

    try {
      server.server.emit("request", request, response);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
