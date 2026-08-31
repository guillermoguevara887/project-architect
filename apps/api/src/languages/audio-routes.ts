import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthStore } from "../auth/repository.js";
import { readSessionUserId } from "../auth/session.js";
import {
  getOrCreateLanguageAudio,
  languageLessonAudioRequestSchema,
  OPENAI_LANGUAGE_AUDIO_CONFIG,
  resolveLanguageStoryAudioConfiguration,
  resolveLanguageStoryAudioLanguage,
  resolveLanguageLessonAudioText,
  type LanguageAudioConfiguration,
  type LanguageAudioProvider,
} from "./audio.js";
import type { LanguageAudioStore } from "./audio-repository.js";
import type { LanguageAudioStorage } from "./audio-storage.js";
import {
  assimilLanguageLessonContentSchema,
  languageLessonIdSchema,
  languageProjectIdSchema,
  structuredLanguageLessonSchema,
} from "./contracts.js";
import type { LanguageStore } from "./repository.js";

async function authenticatedUserId(
  request: FastifyRequest,
  authStore: AuthStore,
) {
  const userId = readSessionUserId(request.headers.cookie);

  if (!userId) return null;

  const user = await authStore.findById(userId);
  return user?.id ?? null;
}

export function registerLanguageAudioRoutes(
  server: FastifyInstance,
  dependencies: {
    authStore: AuthStore;
    languageStore: LanguageStore;
    audioStore: LanguageAudioStore;
    provider: LanguageAudioProvider;
    elevenLabsProvider: LanguageAudioProvider;
    storage: LanguageAudioStorage;
  },
) {
  server.post<{ Params: { projectId: string; lessonId: string } }>(
    "/languages/projects/:projectId/lessons/:lessonId/audio",
    async (request, reply) => {
      const { projectId, lessonId } = request.params;

      try {
        const userId = await authenticatedUserId(
          request,
          dependencies.authStore,
        );

        if (!userId) {
          return reply.code(401).send({ error: "UNAUTHORIZED" });
        }

        if (
          !languageProjectIdSchema.safeParse(projectId).success ||
          !languageLessonIdSchema.safeParse(lessonId).success
        ) {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        const parsedInput = languageLessonAudioRequestSchema.safeParse(
          request.body,
        );

        if (!parsedInput.success) {
          return reply.code(400).send({
            error: "INVALID_LANGUAGE_AUDIO_REQUEST",
            message: "La pronunciación solicitada no es válida.",
          });
        }

        const project = await dependencies.languageStore.findProjectByIdForUser(
          projectId,
          userId,
        );
        const lesson = await dependencies.languageStore.findLessonByIdForUser(
          lessonId,
          projectId,
          userId,
        );

        if (!project || !lesson) {
          return reply.code(404).send({ error: "LANGUAGE_LESSON_NOT_FOUND" });
        }

        if (
          lesson.lessonSource === "assimil" &&
          assimilLanguageLessonContentSchema.safeParse(lesson.structuredContent)
            .success
        ) {
          return reply.code(409).send({
            error: "LANGUAGE_ASSIMIL_AUDIO_UNAVAILABLE",
            message:
              "El audio de esta lección Assimil todavía no está disponible.",
          });
        }

        const freeTextAudio = parsedInput.data.section === "freeText";

        if (freeTextAudio) {
          if (
            lesson.status !== "ready" ||
            lesson.lessonSource !== "free" ||
            lesson.freeTitle === null ||
            !lesson.sourceContent.trim()
          ) {
            return reply.code(409).send({
              error: "LANGUAGE_FREE_AUDIO_UNAVAILABLE",
              message: "El audio de esta lección libre no está disponible.",
            });
          }
        } else if (lesson.status !== "ready" || !lesson.structuredContent) {
          return reply.code(409).send({
            error: "LANGUAGE_LESSON_NOT_READY",
            message: "El audio está disponible únicamente en lecciones procesadas.",
          });
        }

        const content = freeTextAudio
          ? null
          : parsedInput.data.version === "simplified"
            ? lesson.simplifiedStructuredContent
            : lesson.structuredContent;

        if (!freeTextAudio && !content) {
          return reply.code(409).send({
            error: "LANGUAGE_LESSON_AUDIO_VERSION_UNAVAILABLE",
            message: "La versión solicitada no está disponible.",
          });
        }

        let configuration: LanguageAudioConfiguration | null =
          OPENAI_LANGUAGE_AUDIO_CONFIG;

        if (
          parsedInput.data.section === "freeText" ||
          parsedInput.data.section === "miniStory" ||
          parsedInput.data.section === "dialogue"
        ) {
          const dialogueAudio = parsedInput.data.section === "dialogue";
          const freeAudio = parsedInput.data.section === "freeText";

          if (!resolveLanguageStoryAudioLanguage(project.language)) {
            return reply.code(409).send({
              error: freeAudio
                ? "LANGUAGE_FREE_AUDIO_UNAVAILABLE"
                : dialogueAudio
                  ? "LANGUAGE_DIALOGUE_AUDIO_UNAVAILABLE"
                  : "LANGUAGE_STORY_AUDIO_UNAVAILABLE",
              message: freeAudio
                ? "El audio de la lección libre todavía no está disponible para este idioma."
                : dialogueAudio
                  ? "El audio del diálogo todavía no está disponible para este idioma."
                  : "El audio de Mini historia no está disponible para este idioma.",
            });
          }

          configuration = resolveLanguageStoryAudioConfiguration(
            project.language,
            parsedInput.data.voice,
          );
        }

        if (!configuration) {
          const dialogueAudio = parsedInput.data.section === "dialogue";
          const freeAudio = parsedInput.data.section === "freeText";

          return reply.code(409).send({
            error: freeAudio
              ? "LANGUAGE_FREE_AUDIO_VOICE_UNAVAILABLE"
              : dialogueAudio
                ? "LANGUAGE_DIALOGUE_AUDIO_VOICE_UNAVAILABLE"
                : "LANGUAGE_STORY_AUDIO_VOICE_UNAVAILABLE",
            message: freeAudio
              ? "La voz de la lección libre todavía no está disponible."
              : dialogueAudio
                ? "La voz del diálogo todavía no está disponible."
                : "La voz seleccionada todavía no está disponible.",
          });
        }

        const originalText = freeTextAudio
          ? lesson.sourceContent
          : resolveLanguageLessonAudioText(
              structuredLanguageLessonSchema.parse(content),
              parsedInput.data,
            );

        if (!originalText) {
          return reply.code(400).send({
            error: "INVALID_LANGUAGE_AUDIO_TARGET",
            message: "La pronunciación solicitada no existe.",
          });
        }

        const result = await getOrCreateLanguageAudio(
          {
            userId,
            language: project.language,
            originalText,
            configuration,
          },
          {
            store: dependencies.audioStore,
            provider:
              configuration.provider === "elevenlabs"
                ? dependencies.elevenLabsProvider
                : dependencies.provider,
            storage: dependencies.storage,
          },
        );

        if (result.kind === "processing") {
          return reply.code(409).send({
            error: "LANGUAGE_AUDIO_GENERATION_PROCESSING",
            message: "Esta pronunciación ya se está generando.",
          });
        }

        return reply
          .header("content-type", configuration.contentType)
          .header("cache-control", "private, no-store")
          .header("x-content-type-options", "nosniff")
          .send(Buffer.from(result.audio));
      } catch (error) {
        server.log.error(
          { error, projectId, lessonId },
          "Language lesson audio failed.",
        );
        return reply.code(502).send({
          error: "LANGUAGE_AUDIO_FAILED",
          message: "No se pudo preparar la pronunciación. Intenta nuevamente.",
        });
      }
    },
  );
}
