import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthStore } from "../auth/repository.js";
import { readSessionUserId } from "../auth/session.js";
import {
  createExerciseSchema,
  exerciseIdSchema,
  updateExerciseSchema,
  updateExerciseStatusSchema,
  updateExerciseWorkspaceSchema,
} from "./contracts.js";
import type { Exercise, ExerciseStore } from "./repository.js";
import { ExerciseTutorError, type ExerciseTutor } from "./tutor.js";

function publicExercise(exercise: Exercise) {
  return {
    id: exercise.id,
    title: exercise.title,
    sourceName: exercise.sourceName,
    chapter: exercise.chapter,
    exerciseNumber: exercise.exerciseNumber,
    prompt: exercise.prompt,
    status: exercise.status,
    guideContent: exercise.guideContent,
    suggestedSteps: exercise.suggestedSteps,
    workspaceType: exercise.workspaceType,
    workspaceValue: exercise.workspaceValue,
    createdAt: exercise.createdAt.toISOString(),
    updatedAt: exercise.updatedAt.toISOString(),
  };
}

function publicExerciseSummary(exercise: Exercise) {
  return {
    id: exercise.id,
    title: exercise.title,
    sourceName: exercise.sourceName,
    chapter: exercise.chapter,
    exerciseNumber: exercise.exerciseNumber,
    status: exercise.status,
    createdAt: exercise.createdAt.toISOString(),
    updatedAt: exercise.updatedAt.toISOString(),
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

export function registerExerciseRoutes(
  server: FastifyInstance,
  store: ExerciseStore,
  authStore: AuthStore,
  tutor: ExerciseTutor,
) {
  server.get("/exercises", async (request, reply) => {
    try {
      const userId = await authenticatedUserId(request, authStore);

      if (!userId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const exercises = await store.listExercises(userId);
      return { exercises: exercises.map(publicExerciseSummary) };
    } catch (error) {
      server.log.error({ error }, "Exercise listing failed.");
      return reply.code(503).send({
        error: "EXERCISES_UNAVAILABLE",
        message: "No se pudieron cargar los ejercicios.",
      });
    }
  });

  server.post("/exercises", async (request, reply) => {
    try {
      const userId = await authenticatedUserId(request, authStore);

      if (!userId) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const parsedInput = createExerciseSchema.safeParse(request.body);

      if (!parsedInput.success) {
        return reply.code(400).send({
          error: "INVALID_EXERCISE",
          message: "Completa el título y el enunciado del ejercicio.",
        });
      }

      const exercise = await store.createExercise({
        userId,
        title: parsedInput.data.title,
        sourceName: parsedInput.data.sourceName ?? null,
        chapter: parsedInput.data.chapter ?? null,
        exerciseNumber: parsedInput.data.exerciseNumber ?? null,
        prompt: parsedInput.data.prompt,
      });

      return reply.code(201).send({ exercise: publicExercise(exercise) });
    } catch (error) {
      server.log.error({ error }, "Exercise creation failed.");
      return reply.code(503).send({
        error: "EXERCISES_UNAVAILABLE",
        message: "No se pudo guardar el ejercicio.",
      });
    }
  });

  server.get<{ Params: { exerciseId: string } }>(
    "/exercises/:exerciseId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!exerciseIdSchema.safeParse(request.params.exerciseId).success) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        const exercise = await store.findExerciseByIdForUser(
          request.params.exerciseId,
          userId,
        );

        if (!exercise) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        return { exercise: publicExercise(exercise) };
      } catch (error) {
        server.log.error({ error }, "Exercise lookup failed.");
        return reply.code(503).send({
          error: "EXERCISES_UNAVAILABLE",
          message: "No se pudo cargar el ejercicio.",
        });
      }
    },
  );

  server.patch<{ Params: { exerciseId: string } }>(
    "/exercises/:exerciseId",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!exerciseIdSchema.safeParse(request.params.exerciseId).success) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        const parsedInput = updateExerciseSchema.safeParse(request.body);

        if (!parsedInput.success) {
          return reply.code(400).send({
            error: "INVALID_EXERCISE",
            message: "Los datos del ejercicio no son válidos.",
          });
        }

        const exercise = await store.updateExercise({
          exerciseId: request.params.exerciseId,
          userId,
          ...parsedInput.data,
        });

        if (!exercise) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        return { exercise: publicExercise(exercise) };
      } catch (error) {
        server.log.error({ error }, "Exercise update failed.");
        return reply.code(503).send({
          error: "EXERCISES_UNAVAILABLE",
          message: "No se pudo actualizar el ejercicio.",
        });
      }
    },
  );

  server.patch<{ Params: { exerciseId: string } }>(
    "/exercises/:exerciseId/status",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!exerciseIdSchema.safeParse(request.params.exerciseId).success) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        const parsedInput = updateExerciseStatusSchema.safeParse(request.body);

        if (!parsedInput.success) {
          return reply.code(400).send({
            error: "INVALID_EXERCISE_STATUS",
            message: "Selecciona un estado válido.",
          });
        }

        const exercise = await store.updateStatus(
          request.params.exerciseId,
          userId,
          parsedInput.data.status,
        );

        if (!exercise) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        return { exercise: publicExercise(exercise) };
      } catch (error) {
        server.log.error({ error }, "Exercise status update failed.");
        return reply.code(503).send({
          error: "EXERCISES_UNAVAILABLE",
          message: "No se pudo cambiar el estado.",
        });
      }
    },
  );

  server.put<{ Params: { exerciseId: string } }>(
    "/exercises/:exerciseId/workspace",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!exerciseIdSchema.safeParse(request.params.exerciseId).success) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        const parsedInput = updateExerciseWorkspaceSchema.safeParse(
          request.body,
        );

        if (!parsedInput.success) {
          return reply.code(400).send({
            error: "INVALID_EXERCISE_WORKSPACE",
            message: "Revisa el tipo y la ubicación del espacio de trabajo.",
          });
        }

        const exercise = await store.updateWorkspace({
          exerciseId: request.params.exerciseId,
          userId,
          ...parsedInput.data,
        });

        if (!exercise) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        return { exercise: publicExercise(exercise) };
      } catch (error) {
        server.log.error({ error }, "Exercise workspace update failed.");
        return reply.code(503).send({
          error: "EXERCISES_UNAVAILABLE",
          message: "No se pudo guardar el espacio de trabajo.",
        });
      }
    },
  );

  server.post<{ Params: { exerciseId: string } }>(
    "/exercises/:exerciseId/guide",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!exerciseIdSchema.safeParse(request.params.exerciseId).success) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        const current = await store.findExerciseByIdForUser(
          request.params.exerciseId,
          userId,
        );

        if (!current) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        const guideContent = await tutor.generateGuide(current);
        const exercise = await store.saveGuide(
          current.id,
          userId,
          guideContent,
        );

        if (!exercise) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        return { exercise: publicExercise(exercise) };
      } catch (error) {
        server.log.error({ error }, "Exercise guide generation failed.");

        if (error instanceof ExerciseTutorError) {
          return reply.code(503).send({
            error:
              error.code === "not_configured"
                ? "EXERCISE_AI_NOT_CONFIGURED"
                : "EXERCISE_AI_UNAVAILABLE",
            message:
              error.code === "not_configured"
                ? "La IA de Ejercicios todavía no está configurada."
                : "No se pudo generar la guía. Inténtalo de nuevo.",
          });
        }

        return reply.code(503).send({
          error: "EXERCISES_UNAVAILABLE",
          message: "No se pudo guardar la guía.",
        });
      }
    },
  );

  server.post<{ Params: { exerciseId: string } }>(
    "/exercises/:exerciseId/steps",
    async (request, reply) => {
      try {
        const userId = await authenticatedUserId(request, authStore);

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (!exerciseIdSchema.safeParse(request.params.exerciseId).success) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        const current = await store.findExerciseByIdForUser(
          request.params.exerciseId,
          userId,
        );

        if (!current) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        const suggestedSteps = await tutor.generateSteps(current);
        const exercise = await store.saveSuggestedSteps(
          current.id,
          userId,
          suggestedSteps,
        );

        if (!exercise) {
          return reply.code(404).send({ error: "EXERCISE_NOT_FOUND" });
        }

        return { exercise: publicExercise(exercise) };
      } catch (error) {
        server.log.error({ error }, "Exercise steps generation failed.");

        if (error instanceof ExerciseTutorError) {
          return reply.code(503).send({
            error:
              error.code === "not_configured"
                ? "EXERCISE_AI_NOT_CONFIGURED"
                : "EXERCISE_AI_UNAVAILABLE",
            message:
              error.code === "not_configured"
                ? "La IA de Ejercicios todavía no está configurada."
                : "No se pudieron generar los pasos. Inténtalo de nuevo.",
          });
        }

        return reply.code(503).send({
          error: "EXERCISES_UNAVAILABLE",
          message: "No se pudieron guardar los pasos.",
        });
      }
    },
  );
}
