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
import {
  projectTextImprover,
  type ProjectTextImprover,
} from "./architect-projects/text-improver.js";
import {
  accountStore,
  type AccountStore,
} from "./account/repository.js";
import {
  resendPasswordResetMailer,
  type PasswordResetMailer,
} from "./account/email.js";
import { registerAccountRoutes } from "./account/routes.js";
import { authStore, type AuthStore } from "./auth/repository.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { assertSessionConfiguration } from "./auth/session.js";
import { closeDbConnection, getDb } from "./db/client.js";
import {
  exerciseStore,
  type ExerciseStore,
} from "./exercises/repository.js";
import { registerExerciseRoutes } from "./exercises/routes.js";
import { exerciseTutor, type ExerciseTutor } from "./exercises/tutor.js";
import { journeyStore, type JourneyStore } from "./journey/repository.js";
import { registerJourneyRoutes } from "./journey/routes.js";
import {
  freeLanguageLessonAnalyzer,
  type FreeLanguageLessonAnalyzer,
} from "./languages/free-analyzer.js";
import {
  freeLanguageLessonTitleGenerator,
  type FreeLanguageLessonTitleGenerator,
} from "./languages/free-title-generator.js";
import {
  assimilLanguageLessonProcessor,
  type AssimilLanguageLessonProcessor,
} from "./languages/assimil-processor.js";
import {
  languageLessonProcessor,
  type LanguageLessonProcessor,
} from "./languages/lesson-processor.js";
import {
  languageLessonSplitter,
  type LanguageLessonSplitter,
} from "./languages/lesson-splitter.js";
import {
  languageLessonVerySimplifier,
  type LanguageLessonVerySimplifier,
} from "./languages/lesson-very-simplifier.js";
import {
  elevenLabsLanguageAudioProvider,
  languageAudioProvider,
  type LanguageAudioProvider,
} from "./languages/audio.js";
import {
  languageAudioStore,
  type LanguageAudioStore,
} from "./languages/audio-repository.js";
import {
  languageAudioStorage,
  type LanguageAudioStorage,
} from "./languages/audio-storage.js";
import { registerLanguageAudioRoutes } from "./languages/audio-routes.js";
import { languageStore, type LanguageStore } from "./languages/repository.js";
import { registerLanguageRoutes } from "./languages/routes.js";
import {
  curriculumDocumentService,
  type CurriculumDocumentService,
} from "./languages/documents/service.js";
import { registerCurriculumDocumentRoutes } from "./languages/documents/routes.js";
import {
  productionLessonGenerationService,
  type ProductionLessonGenerationService,
} from "./languages/generation/service.js";
import { registerProductionLessonGenerationRoutes } from "./languages/generation/routes.js";

type ServerDependencies = {
  authStore?: AuthStore;
  accountStore?: AccountStore;
  passwordResetMailer?: PasswordResetMailer;
  accountNow?: () => Date;
  passwordResetTokenGenerator?: () => string;
  architectProjectStore?: ArchitectProjectStore;
  projectTextImprover?: ProjectTextImprover;
  journeyStore?: JourneyStore;
  exerciseStore?: ExerciseStore;
  exerciseTutor?: ExerciseTutor;
  languageStore?: LanguageStore;
  languageLessonProcessor?: LanguageLessonProcessor;
  languageLessonSplitter?: LanguageLessonSplitter;
  languageLessonVerySimplifier?: LanguageLessonVerySimplifier;
  freeLanguageLessonAnalyzer?: FreeLanguageLessonAnalyzer;
  freeLanguageLessonTitleGenerator?: FreeLanguageLessonTitleGenerator;
  assimilLanguageLessonProcessor?: AssimilLanguageLessonProcessor;
  languageAudioStore?: LanguageAudioStore;
  languageAudioProvider?: LanguageAudioProvider;
  elevenLabsLanguageAudioProvider?: LanguageAudioProvider;
  languageAudioStorage?: LanguageAudioStorage;
  curriculumDocumentService?: CurriculumDocumentService;
  productionLessonGenerationService?: ProductionLessonGenerationService;
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
  registerAccountRoutes(server, {
    accountStore: dependencies.accountStore ?? accountStore,
    mailer: dependencies.passwordResetMailer ?? resendPasswordResetMailer,
    now: dependencies.accountNow,
    tokenGenerator: dependencies.passwordResetTokenGenerator,
  });
  registerArchitectProjectRoutes(
    server,
    dependencies.architectProjectStore ?? architectProjectStore,
    configuredAuthStore,
    dependencies.projectTextImprover ?? projectTextImprover,
  );
  registerJourneyRoutes(
    server,
    dependencies.journeyStore ?? journeyStore,
    configuredAuthStore,
  );
  registerExerciseRoutes(
    server,
    dependencies.exerciseStore ?? exerciseStore,
    configuredAuthStore,
    dependencies.exerciseTutor ?? exerciseTutor,
  );
  registerLanguageRoutes(
    server,
    dependencies.languageStore ?? languageStore,
    configuredAuthStore,
    dependencies.languageLessonProcessor ?? languageLessonProcessor,
    dependencies.languageLessonSplitter ?? languageLessonSplitter,
    dependencies.languageLessonVerySimplifier ?? languageLessonVerySimplifier,
    dependencies.freeLanguageLessonAnalyzer ?? freeLanguageLessonAnalyzer,
    dependencies.freeLanguageLessonTitleGenerator ??
      freeLanguageLessonTitleGenerator,
    dependencies.assimilLanguageLessonProcessor ?? assimilLanguageLessonProcessor,
  );
  registerCurriculumDocumentRoutes(server, {
    authStore: configuredAuthStore,
    service: dependencies.curriculumDocumentService ?? curriculumDocumentService,
  });
  registerProductionLessonGenerationRoutes(server, {
    authStore: configuredAuthStore,
    service:
      dependencies.productionLessonGenerationService ??
      productionLessonGenerationService,
  });
  registerLanguageAudioRoutes(server, {
    authStore: configuredAuthStore,
    languageStore: dependencies.languageStore ?? languageStore,
    audioStore: dependencies.languageAudioStore ?? languageAudioStore,
    provider: dependencies.languageAudioProvider ?? languageAudioProvider,
    elevenLabsProvider:
      dependencies.elevenLabsLanguageAudioProvider ??
      elevenLabsLanguageAudioProvider,
    storage: dependencies.languageAudioStorage ?? languageAudioStorage,
  });

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
