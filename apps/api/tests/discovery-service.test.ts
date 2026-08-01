import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type {
  DiscoveryAnswer,
  DiscoveryAnswerValue,
  DiscoveryQuestion,
  DiscoverySession,
  Project,
} from "@project-architect/contracts";
import { createServer } from "../src/server.js";
import {
  calculateDiscoveryProgress,
  createDiscoveryService,
  DiscoveryServiceError,
  type DiscoveryQuestionOwnership,
  type DiscoverySessionPatch,
  type DiscoverySnapshot,
  type DiscoveryStore,
  type MaterializedDiscoveryQuestion,
} from "../src/discovery/service.js";
import { getDiscoveryTemplate } from "../src/discovery/templates.js";

const PROJECT_A_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_B_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-07-27T12:00:00.000Z";

function createProject(
  id: string,
  projectType: Project["projectType"],
): Project {
  return {
    id,
    name: projectType === "research" ? "Investigación" : "Hackathon",
    projectType,
    globalObjective: "Objetivo global de prueba.",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

class InMemoryDiscoveryStore implements DiscoveryStore {
  readonly projects = new Map<string, Project>([
    [PROJECT_A_ID, createProject(PROJECT_A_ID, "research")],
    [PROJECT_B_ID, createProject(PROJECT_B_ID, "competition")],
  ]);
  readonly sessions = new Map<string, DiscoverySession>();
  readonly questions = new Map<string, DiscoveryQuestion>();
  readonly answers = new Map<string, DiscoveryAnswer>();
  createdSessionCount = 0;

  async findProject(projectId: string) {
    return this.projects.get(projectId) ?? null;
  }

  async ensureSession(
    projectId: string,
    questions: MaterializedDiscoveryQuestion[],
  ) {
    if (this.sessions.has(projectId)) {
      return;
    }

    this.createdSessionCount += 1;
    const session: DiscoverySession = {
      id: randomUUID(),
      projectId,
      status: "in_progress",
      currentStep: 0,
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };

    this.sessions.set(projectId, session);

    for (const question of questions) {
      const id = randomUUID();
      this.questions.set(id, {
        id,
        discoverySessionId: session.id,
        ...question,
        createdAt: NOW,
        answer: null,
      });
    }
  }

  async getSnapshot(projectId: string): Promise<DiscoverySnapshot | null> {
    const project = this.projects.get(projectId);
    const session = this.sessions.get(projectId);

    if (!project || !session) {
      return null;
    }

    return {
      project,
      session: { ...session },
      questions: [...this.questions.values()]
        .filter(
          (question) => question.discoverySessionId === session.id,
        )
        .map((question) => ({
          ...question,
          answer: this.answers.get(question.id) ?? null,
        })),
    };
  }

  async findQuestion(
    questionId: string,
  ): Promise<DiscoveryQuestionOwnership | null> {
    const question = this.questions.get(questionId);

    if (!question) {
      return null;
    }

    const session = [...this.sessions.values()].find(
      (candidate) => candidate.id === question.discoverySessionId,
    );

    if (!session) {
      return null;
    }

    return {
      projectId: session.projectId,
      question: {
        ...question,
        answer: this.answers.get(question.id) ?? null,
      },
    };
  }

  async upsertAnswer(
    questionId: string,
    answer: DiscoveryAnswerValue,
  ): Promise<DiscoveryAnswer> {
    const existing = this.answers.get(questionId);
    const saved: DiscoveryAnswer = existing
      ? {
          ...existing,
          answer,
          updatedAt: new Date().toISOString(),
        }
      : {
          id: randomUUID(),
          questionId,
          answer,
          createdAt: NOW,
          updatedAt: NOW,
        };

    this.answers.set(questionId, saved);
    return saved;
  }

  async deleteAnswer(questionId: string) {
    this.answers.delete(questionId);
  }

  async updateSession(
    projectId: string,
    patch: DiscoverySessionPatch,
  ): Promise<DiscoverySession | null> {
    const session = this.sessions.get(projectId);

    if (!session) {
      return null;
    }

    const updated: DiscoverySession = {
      ...session,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(projectId, updated);
    return updated;
  }
}

function answerForQuestion(
  question: DiscoveryQuestion,
): DiscoveryAnswerValue {
  switch (question.questionType) {
    case "date":
      return "2026-12-01";
    case "number":
      return 5;
    case "yes_no":
      return true;
    case "single_select":
      return question.options?.[0] ?? "Sin opción";
    case "multi_select":
      return question.options?.slice(0, 1) ?? [];
    case "short_text":
    case "long_text":
      return `Respuesta para ${question.questionKey}`;
  }
}

test("selects different deterministic templates by project type", () => {
  const research = getDiscoveryTemplate("research");
  const competition = getDiscoveryTemplate("competition");

  assert.equal(research.length, 5);
  assert.equal(competition.length, 5);
  assert.equal(
    research.some((section) =>
      section.questions.some(
        (question) => question.key === "research-question",
      ),
    ),
    true,
  );
  assert.equal(
    competition.some((section) =>
      section.questions.some((question) => question.key === "rules"),
    ),
    true,
  );
});

test("starts discovery idempotently without duplicating questions", async () => {
  const store = new InMemoryDiscoveryStore();
  const service = createDiscoveryService(store);

  const first = await service.start(PROJECT_A_ID);
  const second = await service.start(PROJECT_A_ID);

  assert.equal(first.session.id, second.session.id);
  assert.equal(first.progress.totalQuestions, second.progress.totalQuestions);
  assert.equal(store.createdSessionCount, 1);
  assert.equal(
    new Set(second.sections.flatMap((section) => section.questions.map((question) => question.questionKey))).size,
    second.progress.totalQuestions,
  );
});

test("creates and updates one answer without duplication", async () => {
  const store = new InMemoryDiscoveryStore();
  const service = createDiscoveryService(store);
  const discovery = await service.start(PROJECT_A_ID);
  const question = discovery.sections[0]?.questions[0];

  assert.ok(question);

  const created = await service.saveAnswer(
    PROJECT_A_ID,
    question.id,
    "Respuesta inicial",
  );
  const updated = await service.saveAnswer(
    PROJECT_A_ID,
    question.id,
    "Respuesta actualizada",
  );

  assert.ok(created.answer);
  assert.ok(updated.answer);
  assert.equal(created.answer.id, updated.answer.id);
  assert.equal(updated.answer.answer, "Respuesta actualizada");
  assert.equal(store.answers.size, 1);
  assert.equal(updated.progress.answeredQuestions, 1);
});

test("counts boolean false as an answered question", async () => {
  const store = new InMemoryDiscoveryStore();
  const service = createDiscoveryService(store);
  const discovery = await service.start(PROJECT_A_ID);
  const yesNoQuestion = discovery.sections
    .flatMap((section) => section.questions)
    .find((question) => question.questionType === "yes_no");

  assert.ok(yesNoQuestion);
  await service.saveAnswer(PROJECT_A_ID, yesNoQuestion.id, false);
  const snapshot = await store.getSnapshot(PROJECT_A_ID);

  assert.ok(snapshot);
  assert.equal(calculateDiscoveryProgress(snapshot.questions).answeredQuestions, 1);
});

test("rejects a question that belongs to another project", async () => {
  const store = new InMemoryDiscoveryStore();
  const service = createDiscoveryService(store);
  await service.start(PROJECT_A_ID);
  const otherDiscovery = await service.start(PROJECT_B_ID);
  const otherQuestion = otherDiscovery.sections[0]?.questions[0];

  assert.ok(otherQuestion);

  await assert.rejects(
    service.saveAnswer(PROJECT_A_ID, otherQuestion.id, "No permitido"),
    (error) =>
      error instanceof DiscoveryServiceError &&
      error.code === "QUESTION_NOT_IN_PROJECT",
  );
});

test("does not complete while required answers are missing", async () => {
  const store = new InMemoryDiscoveryStore();
  const service = createDiscoveryService(store);
  await service.start(PROJECT_A_ID);

  await assert.rejects(
    service.complete(PROJECT_A_ID),
    (error) =>
      error instanceof DiscoveryServiceError &&
      error.code === "REQUIRED_ANSWERS_MISSING",
  );
});

test("completes after every required question is answered", async () => {
  const store = new InMemoryDiscoveryStore();
  const service = createDiscoveryService(store);
  const discovery = await service.start(PROJECT_A_ID);
  const requiredQuestions = discovery.sections
    .flatMap((section) => section.questions)
    .filter((question) => question.isRequired);

  for (const question of requiredQuestions) {
    await service.saveAnswer(
      PROJECT_A_ID,
      question.id,
      answerForQuestion(question),
    );
  }

  const completed = await service.complete(PROJECT_A_ID);

  assert.equal(completed.session.status, "completed");
  assert.ok(completed.session.completedAt);
  assert.equal(completed.progress.requiredPercentage, 100);
  assert.deepEqual(completed.progress.missingRequiredQuestionIds, []);
});

test("Fastify discovery start endpoint is idempotent and validates answers", async () => {
  const store = new InMemoryDiscoveryStore();
  const discoveryService = createDiscoveryService(store);
  const server = createServer({}, { discoveryService });

  const first = await server.inject({
    method: "POST",
    url: `/projects/${PROJECT_A_ID}/discovery`,
  });
  const second = await server.inject({
    method: "POST",
    url: `/projects/${PROJECT_A_ID}/discovery`,
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.json().discovery.session.id, second.json().discovery.session.id);

  const questionId = first.json().discovery.sections[0].questions[0].id;
  const invalidAnswer = await server.inject({
    method: "PUT",
    url: `/projects/${PROJECT_A_ID}/discovery/answers/${questionId}`,
    payload: {
      answer: {
        invalid: true,
      },
    },
  });

  assert.equal(invalidAnswer.statusCode, 400);
  assert.equal(invalidAnswer.json().error.code, "INVALID_DISCOVERY_ANSWER");

  await server.close();
});
