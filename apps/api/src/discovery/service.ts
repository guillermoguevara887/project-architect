import type {
  DiscoveryAnswer,
  DiscoveryAnswerValue,
  DiscoveryDetail,
  DiscoveryProgress,
  DiscoveryQuestion,
  DiscoverySession,
  DiscoveryStatus,
  Project,
  ProjectDiscoverySummary,
} from "@project-architect/contracts";
import {
  getDiscoveryTemplate,
  type DiscoverySectionTemplate,
} from "./templates.js";

export type MaterializedDiscoveryQuestion = {
  questionKey: string;
  questionText: string;
  category: string;
  sectionKey: string;
  sectionTitle: string;
  questionType: DiscoveryQuestion["questionType"];
  options: string[] | null;
  position: number;
  sectionPosition: number;
  isRequired: boolean;
};

export type DiscoverySnapshot = {
  project: Project;
  session: DiscoverySession;
  questions: DiscoveryQuestion[];
};

export type DiscoverySessionPatch = {
  status?: DiscoveryStatus;
  currentStep?: number;
  completedAt?: string | null;
};

export type DiscoveryQuestionOwnership = {
  projectId: string;
  question: DiscoveryQuestion;
};

export interface DiscoveryStore {
  findProject(projectId: string): Promise<Project | null>;
  ensureSession(
    projectId: string,
    questions: MaterializedDiscoveryQuestion[],
  ): Promise<void>;
  getSnapshot(projectId: string): Promise<DiscoverySnapshot | null>;
  findQuestion(
    questionId: string,
  ): Promise<DiscoveryQuestionOwnership | null>;
  upsertAnswer(
    questionId: string,
    answer: DiscoveryAnswerValue,
  ): Promise<DiscoveryAnswer>;
  deleteAnswer(questionId: string): Promise<void>;
  updateSession(
    projectId: string,
    patch: DiscoverySessionPatch,
  ): Promise<DiscoverySession | null>;
}

export class DiscoveryServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function materializeTemplate(
  sections: DiscoverySectionTemplate[],
): MaterializedDiscoveryQuestion[] {
  return sections.flatMap((section, sectionPosition) =>
    section.questions.map((question, position) => ({
      questionKey: question.key,
      questionText: question.text,
      category: question.category,
      sectionKey: section.key,
      sectionTitle: section.title,
      questionType: question.type,
      options: question.options ?? null,
      position,
      sectionPosition,
      isRequired: question.required,
    })),
  );
}

function hasAnswer(answer: DiscoveryAnswer | null) {
  if (!answer) {
    return false;
  }

  if (typeof answer.answer === "string") {
    return answer.answer.trim().length > 0;
  }

  if (Array.isArray(answer.answer)) {
    return answer.answer.length > 0;
  }

  return true;
}

export function calculateDiscoveryProgress(
  questions: DiscoveryQuestion[],
): DiscoveryProgress {
  const answeredQuestions = questions.filter((question) =>
    hasAnswer(question.answer),
  );
  const requiredQuestions = questions.filter(
    (question) => question.isRequired,
  );
  const answeredRequiredQuestions = requiredQuestions.filter((question) =>
    hasAnswer(question.answer),
  );
  const percentage =
    questions.length === 0
      ? 0
      : Math.round((answeredQuestions.length / questions.length) * 100);
  const requiredPercentage =
    requiredQuestions.length === 0
      ? 100
      : Math.round(
          (answeredRequiredQuestions.length / requiredQuestions.length) * 100,
        );

  return {
    totalQuestions: questions.length,
    answeredQuestions: answeredQuestions.length,
    requiredQuestions: requiredQuestions.length,
    answeredRequiredQuestions: answeredRequiredQuestions.length,
    percentage,
    requiredPercentage,
    missingRequiredQuestionIds: requiredQuestions
      .filter((question) => !hasAnswer(question.answer))
      .map((question) => question.id),
  };
}

function toDiscoveryDetail(snapshot: DiscoverySnapshot): DiscoveryDetail {
  const groupedSections = new Map<
    string,
    {
      key: string;
      title: string;
      position: number;
      questions: DiscoveryQuestion[];
    }
  >();

  for (const question of snapshot.questions) {
    const existing = groupedSections.get(question.sectionKey);

    if (existing) {
      existing.questions.push(question);
      continue;
    }

    groupedSections.set(question.sectionKey, {
      key: question.sectionKey,
      title: question.sectionTitle,
      position: question.sectionPosition,
      questions: [question],
    });
  }

  const sections = [...groupedSections.values()]
    .sort((left, right) => left.position - right.position)
    .map((section) => ({
      ...section,
      questions: section.questions.sort(
        (left, right) => left.position - right.position,
      ),
    }));

  return {
    project: snapshot.project,
    session: snapshot.session,
    sections,
    progress: calculateDiscoveryProgress(snapshot.questions),
  };
}

function normalizeString(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAnswer(
  question: DiscoveryQuestion,
  value: DiscoveryAnswerValue | null,
): DiscoveryAnswerValue | null {
  if (value === null) {
    return null;
  }

  switch (question.questionType) {
    case "short_text":
    case "long_text": {
      if (typeof value !== "string") {
        break;
      }

      return normalizeString(value);
    }
    case "date": {
      if (typeof value !== "string") {
        break;
      }

      const normalized = normalizeString(value);

      if (!normalized) {
        return null;
      }

      const parsedDate = new Date(`${normalized}T00:00:00.000Z`);

      if (
        /^\d{4}-\d{2}-\d{2}$/.test(normalized) &&
        !Number.isNaN(parsedDate.getTime()) &&
        parsedDate.toISOString().slice(0, 10) === normalized
      ) {
        return normalized;
      }

      break;
    }
    case "number": {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }

      break;
    }
    case "yes_no": {
      if (typeof value === "boolean") {
        return value;
      }

      break;
    }
    case "single_select": {
      if (typeof value !== "string") {
        break;
      }

      const normalized = normalizeString(value);

      if (!normalized) {
        return null;
      }

      if (question.options?.includes(normalized)) {
        return normalized;
      }

      break;
    }
    case "multi_select": {
      if (!Array.isArray(value)) {
        break;
      }

      const normalized = [
        ...new Set(
          value
            .map((option) => option.trim())
            .filter((option) => option.length > 0),
        ),
      ];

      if (normalized.length === 0) {
        return null;
      }

      if (
        question.options &&
        normalized.every((option) => question.options?.includes(option))
      ) {
        return normalized;
      }

      break;
    }
  }

  throw new DiscoveryServiceError(
    "INVALID_DISCOVERY_ANSWER",
    "La respuesta no coincide con el tipo de pregunta.",
    400,
  );
}

async function requireProject(store: DiscoveryStore, projectId: string) {
  const project = await store.findProject(projectId);

  if (!project) {
    throw new DiscoveryServiceError(
      "PROJECT_NOT_FOUND",
      "El proyecto solicitado no existe.",
      404,
    );
  }

  return project;
}

async function requireSnapshot(store: DiscoveryStore, projectId: string) {
  await requireProject(store, projectId);
  const snapshot = await store.getSnapshot(projectId);

  if (!snapshot) {
    throw new DiscoveryServiceError(
      "DISCOVERY_NOT_STARTED",
      "El descubrimiento todavía no ha comenzado.",
      404,
    );
  }

  return snapshot;
}

export function createDiscoveryService(store: DiscoveryStore) {
  return {
    async get(projectId: string) {
      return toDiscoveryDetail(await requireSnapshot(store, projectId));
    },

    async getSummary(projectId: string): Promise<ProjectDiscoverySummary> {
      const snapshot = await store.getSnapshot(projectId);

      if (!snapshot) {
        return {
          status: "not_started",
          percentage: 0,
          currentStep: 0,
        };
      }

      return {
        status: snapshot.session.status,
        percentage: calculateDiscoveryProgress(snapshot.questions).percentage,
        currentStep: snapshot.session.currentStep,
      };
    },

    async start(projectId: string) {
      const project = await requireProject(store, projectId);
      const template = getDiscoveryTemplate(project.projectType);

      await store.ensureSession(projectId, materializeTemplate(template));

      const snapshot = await store.getSnapshot(projectId);

      if (!snapshot) {
        throw new DiscoveryServiceError(
          "DISCOVERY_START_FAILED",
          "No se pudo iniciar el descubrimiento.",
          500,
        );
      }

      return toDiscoveryDetail(snapshot);
    },

    async saveAnswer(
      projectId: string,
      questionId: string,
      value: DiscoveryAnswerValue | null,
    ) {
      const snapshot = await requireSnapshot(store, projectId);

      if (snapshot.session.status === "completed") {
        throw new DiscoveryServiceError(
          "DISCOVERY_ALREADY_COMPLETED",
          "El descubrimiento ya está completado.",
          409,
        );
      }

      const ownership = await store.findQuestion(questionId);

      if (!ownership) {
        throw new DiscoveryServiceError(
          "DISCOVERY_QUESTION_NOT_FOUND",
          "La pregunta solicitada no existe.",
          404,
        );
      }

      if (ownership.projectId !== projectId) {
        throw new DiscoveryServiceError(
          "QUESTION_NOT_IN_PROJECT",
          "La pregunta no pertenece al proyecto indicado.",
          400,
        );
      }

      const normalizedAnswer = normalizeAnswer(ownership.question, value);
      let answer: DiscoveryAnswer | null;

      if (normalizedAnswer === null) {
        await store.deleteAnswer(questionId);
        answer = null;
      } else {
        answer = await store.upsertAnswer(questionId, normalizedAnswer);
      }

      if (snapshot.session.status === "ready_for_review") {
        await store.updateSession(projectId, {
          status: "in_progress",
          completedAt: null,
        });
      }

      const updatedSnapshot = await requireSnapshot(store, projectId);

      return {
        answer,
        progress: calculateDiscoveryProgress(updatedSnapshot.questions),
      };
    },

    async updateCurrentStep(projectId: string, currentStep: number) {
      const snapshot = await requireSnapshot(store, projectId);
      const maxStep = snapshot.questions.reduce(
        (maximum, question) =>
          Math.max(maximum, question.sectionPosition),
        0,
      );

      if (currentStep > maxStep) {
        throw new DiscoveryServiceError(
          "INVALID_DISCOVERY_STEP",
          "La sección solicitada no existe.",
          400,
        );
      }

      if (snapshot.session.status === "completed") {
        return {
          session: snapshot.session,
          progress: calculateDiscoveryProgress(snapshot.questions),
        };
      }

      const session = await store.updateSession(projectId, {
        currentStep,
        ...(snapshot.session.status === "ready_for_review"
          ? { status: "in_progress" as const }
          : {}),
      });

      if (!session) {
        throw new DiscoveryServiceError(
          "DISCOVERY_NOT_STARTED",
          "El descubrimiento todavía no ha comenzado.",
          404,
        );
      }

      return {
        session,
        progress: calculateDiscoveryProgress(snapshot.questions),
      };
    },

    async markReadyForReview(projectId: string) {
      const snapshot = await requireSnapshot(store, projectId);

      if (snapshot.session.status === "completed") {
        return {
          session: snapshot.session,
          progress: calculateDiscoveryProgress(snapshot.questions),
        };
      }

      const session = await store.updateSession(projectId, {
        status: "ready_for_review",
      });

      if (!session) {
        throw new DiscoveryServiceError(
          "DISCOVERY_NOT_STARTED",
          "El descubrimiento todavía no ha comenzado.",
          404,
        );
      }

      return {
        session,
        progress: calculateDiscoveryProgress(snapshot.questions),
      };
    },

    async complete(projectId: string) {
      const snapshot = await requireSnapshot(store, projectId);
      const progress = calculateDiscoveryProgress(snapshot.questions);

      if (snapshot.session.status === "completed") {
        return {
          session: snapshot.session,
          progress,
        };
      }

      if (progress.missingRequiredQuestionIds.length > 0) {
        throw new DiscoveryServiceError(
          "REQUIRED_ANSWERS_MISSING",
          "Responde todas las preguntas obligatorias antes de completar.",
          409,
          {
            missingRequiredQuestionIds:
              progress.missingRequiredQuestionIds,
          },
        );
      }

      const session = await store.updateSession(projectId, {
        status: "completed",
        completedAt: new Date().toISOString(),
      });

      if (!session) {
        throw new DiscoveryServiceError(
          "DISCOVERY_NOT_STARTED",
          "El descubrimiento todavía no ha comenzado.",
          404,
        );
      }

      return {
        session,
        progress,
      };
    },

    async getProgress(projectId: string) {
      const snapshot = await requireSnapshot(store, projectId);
      return calculateDiscoveryProgress(snapshot.questions);
    },
  };
}

export type DiscoveryService = ReturnType<typeof createDiscoveryService>;
