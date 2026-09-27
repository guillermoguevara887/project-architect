import type { FastifyRequest } from "fastify";
import type { AuthStore } from "./repository.js";
import { readSession } from "./session.js";

export async function readAuthenticatedUser(
  request: FastifyRequest,
  store: AuthStore,
) {
  const session = readSession(request.headers.cookie);
  if (!session) return null;
  const user = await store.findById(session.userId);
  return user?.sessionVersion === session.sessionVersion ? user : null;
}
