import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthStore } from "../auth/repository.js";
import { readSessionUserId } from "../auth/session.js";
import type { JourneySourceType } from "../db/schema.js";
import type {
  JourneyFeedEntry,
  JourneyIdea,
  JourneyStore,
} from "./repository.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_TYPES = new Set<JourneySourceType>([
  "url",
  "article",
  "paper",
  "pdf",
  "book",
  "video",
  "personal_note",
  "other",
]);

function publicIdea(idea: JourneyIdea) {
  return {
    id: idea.id,
    title: idea.title,
    sourceType: idea.sourceType,
    sourceReference: idea.sourceReference,
    createdAt: idea.createdAt.toISOString(),
    updatedAt: idea.updatedAt.toISOString(),
  };
}

function publicEntry(entry: JourneyFeedEntry) {
  return {
    id: entry.id,
    ideaId: entry.ideaId,
    content: entry.content,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

async function authenticatedUserId(
  request: FastifyRequest,
  authStore: AuthStore,
) {
  const userId = readSessionUserId(request.headers.cookie);

  if (!userId) {
    return null;
  }

  const user = await authStore.findById(userId);
  return user?.id ?? null;
}

function readIdeaInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const { title, sourceType, sourceReference } = body as Record<
    string,
    unknown
  >;

  if (
    typeof title !== "string" ||
    title.trim().length === 0 ||
    title.trim().length > 200 ||
    typeof sourceType !== "string" ||
    !SOURCE_TYPES.has(sourceType as JourneySourceType) ||
    typeof sourceReference !== "string" ||
    sourceReference.trim().length === 0 ||
    sourceReference.trim().length > 4000
  ) {
    return null;
  }

  return {
    title: title.trim(),
    sourceType: sourceType as JourneySourceType,
    sourceReference: sourceReference.trim(),
  };
}

function readEntryInput(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const { content } = body as Record<string, unknown>;

  if (
    typeof content !== "string" ||
    content.trim().length === 0 ||
    content.trim().length > 10_000
  ) {
    return null;
  }

  return { content: content.trim() };
}

function validId(id: string) {
  return UUID_PATTERN.test(id);
}

export function registerJourneyRoutes(
  server: FastifyInstance,
  store: JourneyStore,
  authStore: AuthStore,
) {
  server.get("/journey/ideas", async (request, reply) => {
    try {
      const userId = await authenticatedUserId(request, authStore);

      if (!userId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const ideas = await store.listIdeas(userId);
      return { ideas: ideas.map(publicIdea) };
    } catch (error) {
      server.log.error({ error }, "Journey idea listing failed.");
      return reply.code(503).send({
        error: "JOURNEY_UNAVAILABLE",
        message: "No se pudieron cargar las ideas.",
      });
    }
  });

  server.post("/journey/ideas", async (request, reply) => {
    try {
      const userId = await authenticatedUserId(request, authStore);

      if (!userId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const input = readIdeaInput(request.body);

      if (!input) {
        return reply.code(400).send({
          error: "INVALID_IDEA",
          message: "Completa el título, el tipo de fuente y la referencia.",
        });
      }

      const idea = await store.createIdea({ userId, ...input });
      return reply.code(201).send({ idea: publicIdea(idea) });
    } catch (error) {
      server.log.error({ error }, "Journey idea creation failed.");
      return reply.code(503).send({
        error: "JOURNEY_UNAVAILABLE",
        message: "No se pudo guardar la idea.",
      });
    }
  });

  server.get<{ Params: { ideaId: string } }>(
    "/journey/ideas/:ideaId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!validId(request.params.ideaId)) {
          return reply.code(404).send({ error: "IDEA_NOT_FOUND" });
        }

        const idea = await store.findIdeaByIdForUser(
          request.params.ideaId,
          userId,
        );

        if (!idea) {
          return reply.code(404).send({ error: "IDEA_NOT_FOUND" });
        }

        return { idea: publicIdea(idea) };
      } catch (error) {
        server.log.error({ error }, "Journey idea lookup failed.");
        return reply.code(503).send({
          error: "JOURNEY_UNAVAILABLE",
          message: "No se pudo cargar la idea.",
        });
      }
    },
  );

  server.get<{ Params: { ideaId: string } }>(
    "/journey/ideas/:ideaId/entries",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!validId(request.params.ideaId)) {
          return reply.code(404).send({ error: "IDEA_NOT_FOUND" });
        }

        const entries = await store.listFeedEntries(
          request.params.ideaId,
          userId,
        );

        if (!entries) {
          return reply.code(404).send({ error: "IDEA_NOT_FOUND" });
        }

        return { entries: entries.map(publicEntry) };
      } catch (error) {
        server.log.error({ error }, "Journey feed listing failed.");
        return reply.code(503).send({
          error: "JOURNEY_UNAVAILABLE",
          message: "No se pudo cargar el diario.",
        });
      }
    },
  );

  server.post<{ Params: { ideaId: string } }>(
    "/journey/ideas/:ideaId/entries",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        const input = readEntryInput(request.body);

        if (!validId(request.params.ideaId)) {
          return reply.code(404).send({ error: "IDEA_NOT_FOUND" });
        }

        if (!input) {
          return reply.code(400).send({
            error: "INVALID_ENTRY",
            message: "Escribe una entrada para el diario.",
          });
        }

        const entry = await store.createFeedEntry({
          ideaId: request.params.ideaId,
          userId,
          content: input.content,
        });

        if (!entry) {
          return reply.code(404).send({ error: "IDEA_NOT_FOUND" });
        }

        return reply.code(201).send({ entry: publicEntry(entry) });
      } catch (error) {
        server.log.error({ error }, "Journey feed entry creation failed.");
        return reply.code(503).send({
          error: "JOURNEY_UNAVAILABLE",
          message: "No se pudo guardar la entrada.",
        });
      }
    },
  );

  server.patch<{ Params: { ideaId: string; entryId: string } }>(
    "/journey/ideas/:ideaId/entries/:entryId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        const input = readEntryInput(request.body);

        if (
          !validId(request.params.ideaId) ||
          !validId(request.params.entryId)
        ) {
          return reply.code(404).send({ error: "ENTRY_NOT_FOUND" });
        }

        if (!input) {
          return reply.code(400).send({
            error: "INVALID_ENTRY",
            message: "La entrada no puede estar vacía.",
          });
        }

        const entry = await store.updateFeedEntry({
          ideaId: request.params.ideaId,
          entryId: request.params.entryId,
          userId,
          content: input.content,
        });

        if (!entry) {
          return reply.code(404).send({ error: "ENTRY_NOT_FOUND" });
        }

        return { entry: publicEntry(entry) };
      } catch (error) {
        server.log.error({ error }, "Journey feed entry update failed.");
        return reply.code(503).send({
          error: "JOURNEY_UNAVAILABLE",
          message: "No se pudo actualizar la entrada.",
        });
      }
    },
  );

  server.delete<{ Params: { ideaId: string; entryId: string } }>(
    "/journey/ideas/:ideaId/entries/:entryId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (
          !validId(request.params.ideaId) ||
          !validId(request.params.entryId)
        ) {
          return reply.code(404).send({ error: "ENTRY_NOT_FOUND" });
        }

        const deleted = await store.deleteFeedEntry(
          request.params.entryId,
          request.params.ideaId,
          userId,
        );

        if (!deleted) {
          return reply.code(404).send({ error: "ENTRY_NOT_FOUND" });
        }

        return reply.code(204).send();
      } catch (error) {
        server.log.error({ error }, "Journey feed entry deletion failed.");
        return reply.code(503).send({
          error: "JOURNEY_UNAVAILABLE",
          message: "No se pudo borrar la entrada.",
        });
      }
    },
  );
}
