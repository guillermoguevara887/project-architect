import type { FastifyInstance, FastifyReply } from "fastify";
import {
  DiscoveryAnswerParamsSchema,
  DiscoveryDetailResponseSchema,
  DiscoveryProgressResponseSchema,
  DiscoverySessionResponseSchema,
  ProjectIdParamsSchema,
  SaveDiscoveryAnswerRequestSchema,
  SaveDiscoveryAnswerResponseSchema,
  UpdateDiscoverySessionRequestSchema,
} from "@project-architect/contracts";
import { apiError } from "../lib/api-error.js";
import {
  DiscoveryServiceError,
  type DiscoveryService,
} from "./service.js";

function invalidProjectId(reply: FastifyReply) {
  return reply
    .code(400)
    .send(apiError("INVALID_PROJECT_ID", "El ID del proyecto no es válido."));
}

function sendDiscoveryError(
  server: FastifyInstance,
  reply: FastifyReply,
  error: unknown,
  logMessage: string,
) {
  if (error instanceof DiscoveryServiceError) {
    return reply
      .code(error.statusCode)
      .send(apiError(error.code, error.message, error.details));
  }

  server.log.error({ error }, logMessage);

  return reply
    .code(500)
    .send(
      apiError(
        "DISCOVERY_OPERATION_FAILED",
        "No se pudo completar la operación de descubrimiento.",
      ),
    );
}

export function registerDiscoveryRoutes(
  server: FastifyInstance,
  discoveryService: DiscoveryService,
) {
  server.get("/projects/:projectId/discovery", async (request, reply) => {
    const parsedParams = ProjectIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      return invalidProjectId(reply);
    }

    try {
      return DiscoveryDetailResponseSchema.parse({
        discovery: await discoveryService.get(parsedParams.data.projectId),
      });
    } catch (error) {
      return sendDiscoveryError(
        server,
        reply,
        error,
        "Failed to load discovery.",
      );
    }
  });

  server.post("/projects/:projectId/discovery", async (request, reply) => {
    const parsedParams = ProjectIdParamsSchema.safeParse(request.params);

    if (!parsedParams.success) {
      return invalidProjectId(reply);
    }

    try {
      return reply.code(200).send(
        DiscoveryDetailResponseSchema.parse({
          discovery: await discoveryService.start(
            parsedParams.data.projectId,
          ),
        }),
      );
    } catch (error) {
      return sendDiscoveryError(
        server,
        reply,
        error,
        "Failed to start discovery.",
      );
    }
  });

  server.patch("/projects/:projectId/discovery", async (request, reply) => {
    const parsedParams = ProjectIdParamsSchema.safeParse(request.params);
    const parsedInput = UpdateDiscoverySessionRequestSchema.safeParse(
      request.body,
    );

    if (!parsedParams.success) {
      return invalidProjectId(reply);
    }

    if (!parsedInput.success) {
      return reply
        .code(400)
        .send(
          apiError(
            "INVALID_DISCOVERY_STEP",
            "La sección de descubrimiento no es válida.",
          ),
        );
    }

    try {
      return DiscoverySessionResponseSchema.parse(
        await discoveryService.updateCurrentStep(
          parsedParams.data.projectId,
          parsedInput.data.currentStep,
        ),
      );
    } catch (error) {
      return sendDiscoveryError(
        server,
        reply,
        error,
        "Failed to update discovery step.",
      );
    }
  });

  server.get(
    "/projects/:projectId/discovery/progress",
    async (request, reply) => {
      const parsedParams = ProjectIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return invalidProjectId(reply);
      }

      try {
        return DiscoveryProgressResponseSchema.parse({
          progress: await discoveryService.getProgress(
            parsedParams.data.projectId,
          ),
        });
      } catch (error) {
        return sendDiscoveryError(
          server,
          reply,
          error,
          "Failed to load discovery progress.",
        );
      }
    },
  );

  server.put(
    "/projects/:projectId/discovery/answers/:questionId",
    async (request, reply) => {
      const parsedParams = DiscoveryAnswerParamsSchema.safeParse(
        request.params,
      );
      const parsedInput = SaveDiscoveryAnswerRequestSchema.safeParse(
        request.body,
      );

      if (!parsedParams.success) {
        return reply
          .code(400)
          .send(
            apiError(
              "INVALID_DISCOVERY_QUESTION_ID",
              "El ID del proyecto o de la pregunta no es válido.",
            ),
          );
      }

      if (!parsedInput.success) {
        return reply
          .code(400)
          .send(
            apiError(
              "INVALID_DISCOVERY_ANSWER",
              "La respuesta enviada no es válida.",
            ),
          );
      }

      try {
        return SaveDiscoveryAnswerResponseSchema.parse(
          await discoveryService.saveAnswer(
            parsedParams.data.projectId,
            parsedParams.data.questionId,
            parsedInput.data.answer,
          ),
        );
      } catch (error) {
        return sendDiscoveryError(
          server,
          reply,
          error,
          "Failed to save discovery answer.",
        );
      }
    },
  );

  server.post(
    "/projects/:projectId/discovery/review",
    async (request, reply) => {
      const parsedParams = ProjectIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return invalidProjectId(reply);
      }

      try {
        return DiscoverySessionResponseSchema.parse(
          await discoveryService.markReadyForReview(
            parsedParams.data.projectId,
          ),
        );
      } catch (error) {
        return sendDiscoveryError(
          server,
          reply,
          error,
          "Failed to prepare discovery review.",
        );
      }
    },
  );

  server.post(
    "/projects/:projectId/discovery/complete",
    async (request, reply) => {
      const parsedParams = ProjectIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return invalidProjectId(reply);
      }

      try {
        return DiscoverySessionResponseSchema.parse(
          await discoveryService.complete(parsedParams.data.projectId),
        );
      } catch (error) {
        return sendDiscoveryError(
          server,
          reply,
          error,
          "Failed to complete discovery.",
        );
      }
    },
  );
}
