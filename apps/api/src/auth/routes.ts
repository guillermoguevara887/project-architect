import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyPassword } from "./password.js";
import type { AuthStore, AuthUser } from "./repository.js";
import {
  clearSessionCookie,
  createSessionCookie,
  readSessionUserId,
} from "./session.js";

function publicUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    createdAt: user.createdAt.toISOString(),
  };
}

function invalidCredentials(reply: FastifyReply) {
  return reply.code(401).send({
    error: "INVALID_CREDENTIALS",
    message: "Usuario o contraseña incorrectos.",
  });
}

function readCredentials(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const { username, password } = body as Record<string, unknown>;

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.trim().length === 0 ||
    username.trim().length > 64 ||
    password.length === 0 ||
    password.length > 256
  ) {
    return null;
  }

  return {
    username: username.trim(),
    password,
  };
}

async function readAuthenticatedUser(
  request: FastifyRequest,
  store: AuthStore,
) {
  const userId = readSessionUserId(request.headers.cookie);

  return userId ? store.findById(userId) : null;
}

export function registerAuthRoutes(server: FastifyInstance, store: AuthStore) {
  server.post("/auth/login", async (request, reply) => {
    const credentials = readCredentials(request.body);

    if (!credentials) {
      return invalidCredentials(reply);
    }

    try {
      const user = await store.findByUsername(credentials.username);

      if (
        !user ||
        !(await verifyPassword(credentials.password, user.passwordHash))
      ) {
        return invalidCredentials(reply);
      }

      reply.header("set-cookie", createSessionCookie(user.id));

      return {
        user: publicUser(user),
      };
    } catch (error) {
      server.log.error({ error }, "Login failed.");

      return reply.code(503).send({
        error: "AUTH_UNAVAILABLE",
        message: "No se pudo iniciar sesión.",
      });
    }
  });

  server.get("/auth/session", async (request, reply) => {
    try {
      const user = await readAuthenticatedUser(request, store);

      if (!user) {
        return reply.code(401).send({ authenticated: false });
      }

      return {
        authenticated: true,
        user: publicUser(user),
      };
    } catch (error) {
      server.log.error({ error }, "Session verification failed.");

      return reply.code(503).send({
        authenticated: false,
        error: "AUTH_UNAVAILABLE",
      });
    }
  });

  server.post("/auth/logout", async (_request, reply) => {
    reply.header("set-cookie", clearSessionCookie());

    return { success: true };
  });
}
