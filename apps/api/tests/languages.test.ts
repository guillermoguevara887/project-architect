import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import type {
  LanguageLessonSource,
  StructuredLanguageLesson,
} from "../src/languages/contracts.js";
import {
  LanguageLessonProcessingError,
  type LanguageLessonProcessor,
  type ProcessLanguageLessonInput,
  type SimplifyLanguageLessonInput,
} from "../src/languages/lesson-processor.js";
import type {
  ClaimLanguageLessonInput,
  ClaimLanguageLessonSimplificationInput,
  CompleteLanguageLessonProcessingInput,
  CompleteLanguageLessonSimplificationInput,
  CreateLanguageProjectInput,
  CreateNextLanguageLessonInput,
  FailLanguageLessonProcessingInput,
  FailLanguageLessonSimplificationInput,
  LanguageLesson,
  LanguageProject,
  LanguageStore,
  UpdateLanguageLessonInput,
} from "../src/languages/repository.js";

process.env.NODE_ENV = "test";
process.env.AUTH_COOKIE_SECRET =
  "test-only-cookie-secret-with-more-than-thirty-two-characters";

const firstUser: AuthUser = {
  id: "aaec2ea2-9130-4a70-b516-e187c994d119",
  username: "language-user",
  passwordHash: "unused",
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
};

const secondUser: AuthUser = {
  id: "bdf28936-4853-423d-b43e-020bb1b5ddcb",
  username: "other-user",
  passwordHash: "unused",
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
};

const structuredLesson: StructuredLanguageLesson = {
  vocabulary: [
    { term: "müde", meaning: "cansado", example: "Ich bin müde." },
  ],
  phrases: [
    {
      text: "Ich muss früh aufstehen.",
      translation: "Tengo que levantarme temprano.",
      note: null,
    },
  ],
  patterns: [
    {
      name: "Ich muss …",
      explanation: "Expresa una obligación.",
      examples: ["Ich muss arbeiten."],
    },
  ],
  miniStory: { text: "Lukas ist müde, aber morgen muss er früh aufstehen." },
  automaticThoughts: [{ text: "Ich bin sehr müde." }],
  dialogue: [
    { speaker: "Lukas", text: "Ich bin müde." },
    { speaker: "Anna", text: "Dann geh schlafen." },
  ],
  nextLevelBridge: [
    {
      base: "Ich bin müde.",
      advanced: "Ich bin ziemlich erschöpft.",
      note: "Introduce una forma ligeramente más rica.",
    },
  ],
  review: {
    keyVocabulary: ["müde"],
    keyPatterns: ["Ich muss …"],
  },
};

const simplifiedLesson: StructuredLanguageLesson = {
  vocabulary: [
    { term: "müde", meaning: "cansado", example: "Ich bin müde." },
  ],
  phrases: [
    {
      text: "Ich stehe früh auf.",
      translation: "Me levanto temprano.",
      note: null,
    },
  ],
  patterns: [
    {
      name: "Ich bin …",
      explanation: "Describe un estado.",
      examples: ["Ich bin müde."],
    },
  ],
  miniStory: { text: "Lukas ist müde. Morgen steht er früh auf." },
  automaticThoughts: [{ text: "Ich bin müde." }],
  dialogue: [
    { speaker: "Lukas", text: "Ich bin müde." },
    { speaker: "Anna", text: "Geh schlafen." },
  ],
  nextLevelBridge: [
    {
      base: "Ich bin müde.",
      advanced: "Ich bin sehr müde.",
      note: "Sehr añade intensidad.",
    },
  ],
  review: {
    keyVocabulary: ["müde"],
    keyPatterns: ["Ich bin …"],
  },
};

const regeneratedLesson: StructuredLanguageLesson = {
  ...simplifiedLesson,
  vocabulary: [
    { term: "früh", meaning: "temprano", example: "Ich stehe früh auf." },
  ],
  miniStory: { text: "Lukas steht früh auf. Er ist müde und trinkt Kaffee." },
  review: {
    keyVocabulary: ["früh"],
    keyPatterns: ["Ich stehe … auf."],
  },
};

class MemoryAuthStore implements AuthStore {
  private readonly users = [firstUser, secondUser];

  async findById(userId: string) {
    return this.users.find((user) => user.id === userId) ?? null;
  }

  async findByUsername(username: string) {
    return this.users.find((user) => user.username === username) ?? null;
  }
}

class MemoryLanguageStore implements LanguageStore {
  readonly projects: LanguageProject[] = [];
  readonly lessons: LanguageLesson[] = [];
  private timestamp = Date.parse("2026-08-16T12:00:00.000Z");

  private now() {
    this.timestamp += 1_000;
    return new Date(this.timestamp);
  }

  private ownsProject(projectId: string, userId: string) {
    return this.projects.some(
      (project) => project.id === projectId && project.userId === userId,
    );
  }

  async listProjects(userId: string) {
    return this.projects
      .filter((project) => project.userId === userId)
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      );
  }

  async createProject(input: CreateLanguageProjectInput) {
    const now = this.now();
    const project: LanguageProject = {
      id: randomUUID(),
      userId: input.userId,
      language: input.language,
      level: input.level,
      createdAt: now,
      updatedAt: now,
    };

    this.projects.push(project);
    return project;
  }

  async findProjectByIdForUser(projectId: string, userId: string) {
    return (
      this.projects.find(
        (project) => project.id === projectId && project.userId === userId,
      ) ?? null
    );
  }

  async createNextLesson(input: CreateNextLanguageLessonInput) {
    if (!this.ownsProject(input.languageProjectId, input.userId)) {
      return null;
    }

    const lessonNumber =
      Math.max(
        0,
        ...this.lessons
          .filter(
            (lesson) => lesson.languageProjectId === input.languageProjectId,
          )
          .map((lesson) => lesson.lessonNumber),
      ) + 1;
    const sourceLessonNumber =
      Math.max(
        0,
        ...this.lessons
          .filter(
            (lesson) =>
              lesson.languageProjectId === input.languageProjectId &&
              lesson.lessonSource === input.lessonSource,
          )
          .map((lesson) => lesson.sourceLessonNumber),
      ) + 1;
    const now = this.now();
    const lesson: LanguageLesson = {
      id: randomUUID(),
      languageProjectId: input.languageProjectId,
      lessonNumber,
      lessonSource: input.lessonSource,
      sourceLessonNumber,
      sourceContent: "",
      status: "draft",
      structuredContent: null,
      simplifiedStructuredContent: null,
      simplificationStartedAt: null,
      simplifiedAt: null,
      processedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    this.lessons.push(lesson);
    return lesson;
  }

  async listLessons(projectId: string, userId: string) {
    if (!this.ownsProject(projectId, userId)) {
      return null;
    }

    return this.lessons
      .filter((lesson) => lesson.languageProjectId === projectId)
      .sort((left, right) => left.lessonNumber - right.lessonNumber);
  }

  async findLessonByIdForUser(
    lessonId: string,
    projectId: string,
    userId: string,
  ) {
    if (!this.ownsProject(projectId, userId)) {
      return null;
    }

    return (
      this.lessons.find(
        (lesson) =>
          lesson.id === lessonId && lesson.languageProjectId === projectId,
      ) ?? null
    );
  }

  async updateLessonSourceContent(input: UpdateLanguageLessonInput) {
    if (!this.ownsProject(input.languageProjectId, input.userId)) {
      return { kind: "not_found" as const };
    }

    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );

    if (!lesson) {
      return { kind: "not_found" as const };
    }

    if (lesson.status !== "draft" && lesson.status !== "failed") {
      return { kind: "not_editable" as const };
    }

    lesson.sourceContent = input.sourceContent;
    lesson.updatedAt = this.now();
    return { kind: "updated" as const, lesson };
  }

  async claimLessonForProcessing(input: ClaimLanguageLessonInput) {
    const project = this.projects.find(
      (candidate) =>
        candidate.id === input.languageProjectId &&
        candidate.userId === input.userId,
    );

    if (!project) {
      return { kind: "not_found" as const };
    }

    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );

    if (!lesson) {
      return { kind: "not_found" as const };
    }

    if (lesson.status === "ready") {
      return { kind: "already_ready" as const };
    }

    if (lesson.status === "processing") {
      return { kind: "processing" as const };
    }

    lesson.sourceContent = input.sourceContent;
    lesson.status = "processing";
    lesson.structuredContent = null;
    lesson.processedAt = null;
    lesson.updatedAt = this.now();
    return { kind: "claimed" as const, lesson, project };
  }

  async completeLessonProcessing(input: CompleteLanguageLessonProcessingInput) {
    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );

    if (
      !this.ownsProject(input.languageProjectId, input.userId) ||
      !lesson ||
      lesson.status !== "processing" ||
      lesson.updatedAt.getTime() !== input.processingStartedAt.getTime()
    ) {
      return null;
    }

    const now = this.now();
    lesson.status = "ready";
    lesson.structuredContent = input.structuredContent;
    lesson.processedAt = now;
    lesson.updatedAt = now;
    return lesson;
  }

  async failLessonProcessing(input: FailLanguageLessonProcessingInput) {
    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );

    if (
      !this.ownsProject(input.languageProjectId, input.userId) ||
      !lesson ||
      lesson.status !== "processing" ||
      lesson.updatedAt.getTime() !== input.processingStartedAt.getTime()
    ) {
      return null;
    }

    lesson.status = "failed";
    lesson.structuredContent = null;
    lesson.processedAt = null;
    lesson.updatedAt = this.now();
    return lesson;
  }

  async claimLessonForSimplification(
    input: ClaimLanguageLessonSimplificationInput,
  ) {
    const project = this.projects.find(
      (candidate) =>
        candidate.id === input.languageProjectId &&
        candidate.userId === input.userId,
    );

    if (!project) {
      return { kind: "not_found" as const };
    }

    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );

    if (!lesson) {
      return { kind: "not_found" as const };
    }

    if (lesson.status !== "ready" || !lesson.structuredContent) {
      return { kind: "not_ready" as const };
    }

    if (!input.regenerate && lesson.simplifiedStructuredContent) {
      return { kind: "already_simplified" as const, lesson };
    }

    if (lesson.simplificationStartedAt) {
      return { kind: "processing" as const };
    }

    lesson.simplificationStartedAt = this.now();
    return { kind: "claimed" as const, lesson, project };
  }

  async completeLessonSimplification(
    input: CompleteLanguageLessonSimplificationInput,
  ) {
    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );

    if (
      !this.ownsProject(input.languageProjectId, input.userId) ||
      !lesson ||
      lesson.status !== "ready" ||
      lesson.simplificationStartedAt?.getTime() !==
        input.simplificationStartedAt.getTime()
    ) {
      return null;
    }

    const now = this.now();
    lesson.simplifiedStructuredContent = input.simplifiedStructuredContent;
    lesson.simplifiedAt = now;
    lesson.simplificationStartedAt = null;
    lesson.updatedAt = now;
    return lesson;
  }

  async failLessonSimplification(
    input: FailLanguageLessonSimplificationInput,
  ) {
    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );

    if (
      !this.ownsProject(input.languageProjectId, input.userId) ||
      !lesson ||
      lesson.status !== "ready" ||
      lesson.simplificationStartedAt?.getTime() !==
        input.simplificationStartedAt.getTime()
    ) {
      return null;
    }

    lesson.simplificationStartedAt = null;
    return lesson;
  }

  async deleteLesson(lessonId: string, projectId: string, userId: string) {
    if (!this.ownsProject(projectId, userId)) {
      return false;
    }

    const index = this.lessons.findIndex(
      (lesson) =>
        lesson.id === lessonId && lesson.languageProjectId === projectId,
    );

    if (index === -1) {
      return false;
    }

    this.lessons.splice(index, 1);
    return true;
  }
}

class FakeLanguageLessonProcessor implements LanguageLessonProcessor {
  readonly calls: ProcessLanguageLessonInput[] = [];
  readonly simplificationCalls: SimplifyLanguageLessonInput[] = [];
  result = structuredLesson;
  simplificationResult = structuredLesson;
  error: Error | null = null;
  simplificationError: Error | null = null;
  simplificationWait: Promise<void> | null = null;

  async process(input: ProcessLanguageLessonInput) {
    this.calls.push(input);

    if (this.error) {
      throw this.error;
    }

    return this.result;
  }

  async simplify(input: SimplifyLanguageLessonInput) {
    this.simplificationCalls.push(input);

    if (this.simplificationWait) {
      await this.simplificationWait;
    }

    if (this.simplificationError) {
      throw this.simplificationError;
    }

    return this.simplificationResult;
  }
}

function sessionCookie(userId: string) {
  return createSessionCookie(userId).split(";", 1)[0];
}

function testServer(
  store = new MemoryLanguageStore(),
  processor = new FakeLanguageLessonProcessor(),
) {
  return {
    store,
    processor,
    server: createServer(
      {},
      {
        authStore: new MemoryAuthStore(),
        languageStore: store,
        languageLessonProcessor: processor,
      },
    ),
  };
}

async function createProject(
  server: ReturnType<typeof createServer>,
  cookie: string,
) {
  const response = await server.inject({
    method: "POST",
    url: "/languages/projects",
    headers: { cookie },
    payload: { language: "  Alemán  ", level: "  Nivel 2  " },
  });

  assert.equal(response.statusCode, 201);
  return response.json().project as {
    id: string;
    language: string;
    level: string;
  };
}

async function createLesson(
  server: ReturnType<typeof createServer>,
  projectId: string,
  cookie: string,
  lessonSource?: LanguageLessonSource,
) {
  const response = await server.inject({
    method: "POST",
    url: `/languages/projects/${projectId}/lessons`,
    headers: { cookie },
    ...(lessonSource ? { payload: { lessonSource } } : {}),
  });

  assert.equal(response.statusCode, 201);
  return response.json().lesson as {
    id: string;
    lessonNumber: number;
    lessonSource: LanguageLessonSource;
    sourceLessonNumber: number;
  };
}

async function processLesson(
  server: ReturnType<typeof createServer>,
  projectId: string,
  lessonId: string,
  cookie: string,
  sourceContent = "Ich bin sehr müde.",
) {
  return server.inject({
    method: "POST",
    url: `/languages/projects/${projectId}/lessons/${lessonId}/process`,
    headers: { cookie },
    payload: { sourceContent },
  });
}

async function simplifyLesson(
  server: ReturnType<typeof createServer>,
  projectId: string,
  lessonId: string,
  cookie: string,
  regenerate = false,
) {
  return server.inject({
    method: "POST",
    url: `/languages/projects/${projectId}/lessons/${lessonId}/simplify`,
    headers: { cookie },
    ...(regenerate ? { payload: { regenerate: true } } : {}),
  });
}

test("Idiomas requires authentication and validates project fields", async () => {
  const { store, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const unauthenticatedList = await server.inject({
      method: "GET",
      url: "/languages/projects",
    });
    const invalidCreation = await server.inject({
      method: "POST",
      url: "/languages/projects",
      headers: { cookie },
      payload: { language: " ", level: "Nivel 2" },
    });

    assert.equal(unauthenticatedList.statusCode, 401);
    assert.equal(invalidCreation.statusCode, 400);
    assert.equal(store.projects.length, 0);
  } finally {
    await server.close();
  }
});

test("a language project is trimmed, listed and visible only to its owner", async () => {
  const { server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const project = await createProject(server, ownerCookie);
    const ownerList = await server.inject({
      method: "GET",
      url: "/languages/projects",
      headers: { cookie: ownerCookie },
    });
    const otherDetail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}`,
      headers: { cookie: otherCookie },
    });

    assert.equal(project.language, "Alemán");
    assert.equal(project.level, "Nivel 2");
    assert.equal(ownerList.statusCode, 200);
    assert.equal(ownerList.json().projects[0].language, "Alemán");
    assert.equal(otherDetail.statusCode, 404);
  } finally {
    await server.close();
  }
});

test("lessons remain sequential and draft source material can still persist", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const first = await createLesson(server, project.id, cookie);
    const second = await createLesson(server, project.id, cookie);
    const sourceContent = "  Guten Morgen.\nWie geht es dir?  ";
    const update = await server.inject({
      method: "PATCH",
      url: `/languages/projects/${project.id}/lessons/${first.id}`,
      headers: { cookie },
      payload: { sourceContent },
    });

    assert.equal(first.lessonNumber, 1);
    assert.equal(second.lessonNumber, 2);
    assert.equal(first.sourceLessonNumber, 1);
    assert.equal(second.sourceLessonNumber, 2);
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().lesson.sourceContent, sourceContent);
    assert.equal(update.json().lesson.status, "draft");
  } finally {
    await server.close();
  }
});

test("lesson provenance accepts every supported value, persists and defaults to free", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const supportedSources: LanguageLessonSource[] = [
    "assimil",
    "language_framework",
    "free",
  ];

  try {
    const project = await createProject(server, cookie);

    for (const lessonSource of supportedSources) {
      const created = await createLesson(
        server,
        project.id,
        cookie,
        lessonSource,
      );
      assert.equal(created.lessonSource, lessonSource);
      assert.equal(created.sourceLessonNumber, 1);

      const detail = await server.inject({
        method: "GET",
        url: `/languages/projects/${project.id}/lessons/${created.id}`,
        headers: { cookie },
      });

      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().lesson.lessonSource, lessonSource);
      assert.equal(detail.json().lesson.sourceLessonNumber, 1);
    }

    const compatibleCreation = await createLesson(server, project.id, cookie);
    assert.equal(compatibleCreation.lessonSource, "free");
    assert.equal(compatibleCreation.sourceLessonNumber, 2);

    const list = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie },
    });

    assert.equal(list.statusCode, 200);
    assert.deepEqual(
      list.json().lessons.map(
        (lesson: { lessonSource: LanguageLessonSource }) => lesson.lessonSource,
      ),
      [...supportedSources, "free"],
    );
    assert.deepEqual(
      list.json().lessons.map(
        (lesson: { sourceLessonNumber: number }) => lesson.sourceLessonNumber,
      ),
      [1, 1, 1, 2],
    );
  } finally {
    await server.close();
  }
});

test("lesson source numbering is independent while general order stays sequential", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const lessonSources: LanguageLessonSource[] = [
    "assimil",
    "language_framework",
    "assimil",
    "free",
    "language_framework",
  ];

  try {
    const project = await createProject(server, cookie);
    const created = [];

    for (const lessonSource of lessonSources) {
      created.push(
        await createLesson(server, project.id, cookie, lessonSource),
      );
    }

    assert.deepEqual(
      created.map(({ lessonNumber }) => lessonNumber),
      [1, 2, 3, 4, 5],
    );
    assert.deepEqual(
      created.map(({ sourceLessonNumber }) => sourceLessonNumber),
      [1, 1, 2, 1, 2],
    );

    const list = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie },
    });
    const detail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${created[2]?.id}`,
      headers: { cookie },
    });

    assert.equal(list.statusCode, 200);
    assert.deepEqual(
      list.json().lessons.map(
        (lesson: {
          lessonNumber: number;
          lessonSource: LanguageLessonSource;
          sourceLessonNumber: number;
        }) => ({
          lessonNumber: lesson.lessonNumber,
          lessonSource: lesson.lessonSource,
          sourceLessonNumber: lesson.sourceLessonNumber,
        }),
      ),
      lessonSources.map((lessonSource, index) => ({
        lessonNumber: index + 1,
        lessonSource,
        sourceLessonNumber: [1, 1, 2, 1, 2][index],
      })),
    );
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().lesson.lessonNumber, 3);
    assert.equal(detail.json().lesson.lessonSource, "assimil");
    assert.equal(detail.json().lesson.sourceLessonNumber, 2);
  } finally {
    await server.close();
  }
});

test("lesson provenance rejects unsupported values", async () => {
  const { store, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const response = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie },
      payload: { lessonSource: "unknown_source" },
    });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json().error, "INVALID_LANGUAGE_LESSON_SOURCE");
    assert.equal(store.lessons.length, 0);
  } finally {
    await server.close();
  }
});

test("processing uses project language and level, stores all sections and hides ready source", async () => {
  const { store, processor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const sourceContent = "  Ich bin sehr müde.  ";

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    const response = await processLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      sourceContent,
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(processor.calls, [
      { language: "Alemán", level: "Nivel 2", sourceContent },
    ]);
    assert.equal(store.lessons[0]?.status, "ready");
    assert.equal(store.lessons[0]?.sourceContent, sourceContent);
    assert.deepEqual(store.lessons[0]?.structuredContent, structuredLesson);
    assert.ok(store.lessons[0]?.processedAt);
    assert.equal("sourceContent" in response.json().lesson, false);
    assert.deepEqual(
      Object.keys(response.json().lesson.structuredContent).sort(),
      [
        "automaticThoughts",
        "dialogue",
        "miniStory",
        "nextLevelBridge",
        "patterns",
        "phrases",
        "review",
        "vocabulary",
      ],
    );
  } finally {
    await server.close();
  }
});

test("empty input is rejected before processing", async () => {
  const { processor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    const response = await processLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      "   \n",
    );

    assert.equal(response.statusCode, 400);
    assert.equal(processor.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("another user cannot read, process, simplify, update or delete a lesson", async () => {
  const { processor, server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const project = await createProject(server, ownerCookie);
    const lesson = await createLesson(server, project.id, ownerCookie);
    const detail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${lesson.id}`,
      headers: { cookie: otherCookie },
    });
    const processing = await processLesson(
      server,
      project.id,
      lesson.id,
      otherCookie,
    );
    const simplification = await simplifyLesson(
      server,
      project.id,
      lesson.id,
      otherCookie,
    );
    const update = await server.inject({
      method: "PATCH",
      url: `/languages/projects/${project.id}/lessons/${lesson.id}`,
      headers: { cookie: otherCookie },
      payload: { sourceContent: "Private material" },
    });
    const deletion = await server.inject({
      method: "DELETE",
      url: `/languages/projects/${project.id}/lessons/${lesson.id}`,
      headers: { cookie: otherCookie },
    });

    assert.equal(detail.statusCode, 404);
    assert.equal(processing.statusCode, 404);
    assert.equal(simplification.statusCode, 404);
    assert.equal(update.statusCode, 404);
    assert.equal(deletion.statusCode, 404);
    assert.equal(processor.calls.length, 0);
    assert.equal(processor.simplificationCalls.length, 0);
  } finally {
    await server.close();
  }
});

test("provider and validation failures preserve source material and allow retry", async () => {
  const { store, processor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const sourceContent = "Hast du schon gegessen?";

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    processor.error = new LanguageLessonProcessingError("invalid_response");
    const failed = await processLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      sourceContent,
    );

    assert.equal(failed.statusCode, 502);
    assert.equal(store.lessons[0]?.status, "failed");
    assert.equal(store.lessons[0]?.sourceContent, sourceContent);
    assert.equal(store.lessons[0]?.structuredContent, null);

    processor.error = null;
    const retried = await processLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      sourceContent,
    );

    assert.equal(retried.statusCode, 200);
    assert.equal(store.lessons[0]?.status, "ready");
  } finally {
    await server.close();
  }
});

test("ready and actively processing lessons cannot be processed twice", async () => {
  const { store, processor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const first = await createLesson(server, project.id, cookie);
    assert.equal(
      (await processLesson(server, project.id, first.id, cookie)).statusCode,
      200,
    );
    assert.equal(
      (await processLesson(server, project.id, first.id, cookie)).statusCode,
      409,
    );

    const second = await createLesson(server, project.id, cookie);
    const processingLesson = store.lessons.find(
      (lesson) => lesson.id === second.id,
    );
    assert.ok(processingLesson);
    processingLesson.status = "processing";
    processingLesson.updatedAt = new Date();
    assert.equal(
      (await processLesson(server, project.id, second.id, cookie)).statusCode,
      409,
    );
    assert.equal(processor.calls.length, 1);
  } finally {
    await server.close();
  }
});

test("ready lessons cannot be edited through the legacy PATCH route", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);
    const update = await server.inject({
      method: "PATCH",
      url: `/languages/projects/${project.id}/lessons/${lesson.id}`,
      headers: { cookie },
      payload: { sourceContent: "Silently replace ready content" },
    });

    assert.equal(update.statusCode, 409);
    assert.equal(update.json().error, "LANGUAGE_LESSON_NOT_EDITABLE");
  } finally {
    await server.close();
  }
});

test("deletion removes only the selected lesson and never renumbers others", async () => {
  const { store, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const first = await createLesson(server, project.id, cookie);
    const second = await createLesson(server, project.id, cookie);
    const deletion = await server.inject({
      method: "DELETE",
      url: `/languages/projects/${project.id}/lessons/${first.id}`,
      headers: { cookie },
    });

    assert.equal(deletion.statusCode, 204);
    assert.equal(store.lessons.length, 1);
    assert.equal(store.lessons[0]?.id, second.id);
    assert.equal(store.lessons[0]?.lessonNumber, 2);
  } finally {
    await server.close();
  }
});

test("ready lesson detail persists structure without exposing source content", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie, "Private source");
    const detail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${lesson.id}`,
      headers: { cookie },
    });

    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().lesson.status, "ready");
    assert.equal("sourceContent" in detail.json().lesson, false);
    assert.deepEqual(detail.json().lesson.structuredContent, structuredLesson);
    assert.equal(detail.json().lesson.simplifiedStructuredContent, null);
    assert.equal(detail.json().lesson.simplifiedAt, null);
  } finally {
    await server.close();
  }
});

test("only a ready lesson can be simplified", async () => {
  const { processor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const draft = await createLesson(server, project.id, cookie);
    const response = await simplifyLesson(
      server,
      project.id,
      draft.id,
      cookie,
    );

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "LANGUAGE_LESSON_NOT_READY");
    assert.equal(processor.simplificationCalls.length, 0);
  } finally {
    await server.close();
  }
});

test("simplification uses structured content, persists eight sections and preserves the original", async () => {
  const { store, processor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const created = await createLesson(server, project.id, cookie);
    await processLesson(
      server,
      project.id,
      created.id,
      cookie,
      "Private source that must not drive simplification",
    );
    const originalBefore = structuredClone(
      store.lessons[0]?.structuredContent,
    );
    processor.simplificationResult = simplifiedLesson;

    const response = await simplifyLesson(
      server,
      project.id,
      created.id,
      cookie,
    );
    const detail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${created.id}`,
      headers: { cookie },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(processor.simplificationCalls, [
      {
        language: "Alemán",
        level: "Nivel 2",
        structuredContent: structuredLesson,
      },
    ]);
    assert.deepEqual(store.lessons[0]?.structuredContent, originalBefore);
    assert.deepEqual(
      store.lessons[0]?.simplifiedStructuredContent,
      simplifiedLesson,
    );
    assert.ok(store.lessons[0]?.simplifiedAt);
    assert.equal(store.lessons[0]?.simplificationStartedAt, null);
    assert.deepEqual(
      Object.keys(response.json().lesson.simplifiedStructuredContent).sort(),
      [
        "automaticThoughts",
        "dialogue",
        "miniStory",
        "nextLevelBridge",
        "patterns",
        "phrases",
        "review",
        "vocabulary",
      ],
    );
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(
      detail.json().lesson.simplifiedStructuredContent,
      simplifiedLesson,
    );
    assert.ok(detail.json().lesson.simplifiedAt);
    assert.deepEqual(detail.json().lesson.structuredContent, originalBefore);
  } finally {
    await server.close();
  }
});

test("a persisted simplification makes the endpoint idempotent", async () => {
  const { processor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);
    processor.simplificationResult = simplifiedLesson;

    const first = await simplifyLesson(
      server,
      project.id,
      lesson.id,
      cookie,
    );
    const second = await simplifyLesson(
      server,
      project.id,
      lesson.id,
      cookie,
    );

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(processor.simplificationCalls.length, 1);
    assert.deepEqual(
      second.json().lesson.simplifiedStructuredContent,
      simplifiedLesson,
    );
  } finally {
    await server.close();
  }
});

test("explicit regeneration replaces only the simplification using the original source", async () => {
  const { store, processor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);
    const originalBefore = structuredClone(
      store.lessons[0]?.structuredContent,
    );
    const originalJsonBefore = JSON.stringify(originalBefore);
    processor.simplificationResult = simplifiedLesson;
    await simplifyLesson(server, project.id, lesson.id, cookie);
    const firstSimplifiedAt = store.lessons[0]?.simplifiedAt;
    processor.simplificationResult = regeneratedLesson;

    const regenerated = await simplifyLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      true,
    );

    assert.equal(regenerated.statusCode, 200);
    assert.equal(processor.simplificationCalls.length, 2);
    assert.deepEqual(
      processor.simplificationCalls[1]?.structuredContent,
      originalBefore,
    );
    assert.notDeepEqual(
      processor.simplificationCalls[1]?.structuredContent,
      simplifiedLesson,
    );
    assert.equal(
      JSON.stringify(store.lessons[0]?.structuredContent),
      originalJsonBefore,
    );
    assert.deepEqual(
      store.lessons[0]?.simplifiedStructuredContent,
      regeneratedLesson,
    );
    assert.ok(store.lessons[0]?.simplifiedAt);
    assert.ok(
      store.lessons[0]!.simplifiedAt!.getTime() >
        firstSimplifiedAt!.getTime(),
    );
    assert.deepEqual(
      regenerated.json().lesson.simplifiedStructuredContent,
      regeneratedLesson,
    );
  } finally {
    await server.close();
  }
});

test("two concurrent regenerations produce only one new OpenAI call", async () => {
  const { store, processor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);
  let releaseSimplification = () => {};

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);
    processor.simplificationResult = simplifiedLesson;
    await simplifyLesson(server, project.id, lesson.id, cookie);
    processor.simplificationResult = regeneratedLesson;
    processor.simplificationWait = new Promise<void>((resolve) => {
      releaseSimplification = resolve;
    });

    const firstRequest = simplifyLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      true,
    );

    for (
      let attempt = 0;
      attempt < 20 && processor.simplificationCalls.length < 2;
      attempt += 1
    ) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const secondResponse = await simplifyLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      true,
    );
    assert.deepEqual(
      store.lessons[0]?.simplifiedStructuredContent,
      simplifiedLesson,
    );
    releaseSimplification();
    const firstResponse = await firstRequest;

    assert.equal(firstResponse.statusCode, 200);
    assert.equal(secondResponse.statusCode, 409);
    assert.equal(
      secondResponse.json().error,
      "LANGUAGE_LESSON_SIMPLIFICATION_PROCESSING",
    );
    assert.equal(processor.simplificationCalls.length, 2);
    assert.deepEqual(
      store.lessons[0]?.simplifiedStructuredContent,
      regeneratedLesson,
    );
  } finally {
    releaseSimplification();
    await server.close();
  }
});

test("regeneration errors preserve the original and previous simplification", async () => {
  const { store, processor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);
    const originalBefore = structuredClone(
      store.lessons[0]?.structuredContent,
    );
    processor.simplificationResult = simplifiedLesson;
    await simplifyLesson(server, project.id, lesson.id, cookie);
    const simplifiedBefore = structuredClone(
      store.lessons[0]?.simplifiedStructuredContent,
    );
    const simplifiedAtBefore = store.lessons[0]?.simplifiedAt;
    processor.simplificationError = new LanguageLessonProcessingError(
      "provider_error",
    );

    const failed = await simplifyLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      true,
    );

    assert.equal(failed.statusCode, 502);
    assert.equal(store.lessons[0]?.status, "ready");
    assert.deepEqual(store.lessons[0]?.structuredContent, originalBefore);
    assert.deepEqual(
      store.lessons[0]?.simplifiedStructuredContent,
      simplifiedBefore,
    );
    assert.equal(
      store.lessons[0]?.simplifiedAt?.getTime(),
      simplifiedAtBefore?.getTime(),
    );
    assert.equal(store.lessons[0]?.simplificationStartedAt, null);

    processor.simplificationError = null;
    processor.simplificationResult = regeneratedLesson;
    const retried = await simplifyLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      true,
    );

    assert.equal(retried.statusCode, 200);
    assert.equal(processor.simplificationCalls.length, 3);
  } finally {
    await server.close();
  }
});

test("Idiomas Phase 2 migration is additive and keeps existing lessons as draft", async () => {
  const migration = await readFile(
    new URL("../drizzle/0006_structure_language_lessons.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /ALTER TABLE "language_lessons"/);
  assert.match(migration, /"status" text DEFAULT 'draft' NOT NULL/);
  assert.match(migration, /"structured_content" jsonb/);
  assert.match(migration, /"processed_at" timestamp with time zone/);
  assert.match(migration, /language_lessons_status_check/);
  assert.match(migration, /language_lessons_ready_content_check/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE/i);
});

test("lesson source migration defaults existing lessons to free and constrains values", async () => {
  const migration = await readFile(
    new URL("../drizzle/0007_add_language_lesson_source.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /ALTER TABLE "language_lessons"/);
  assert.match(migration, /"lesson_source" text DEFAULT 'free' NOT NULL/);
  assert.match(migration, /language_lessons_source_check/);
  assert.match(migration, /'assimil', 'language_framework', 'free'/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE/i);
});

test("lesson source number migration backfills by project and source without replacing general order", async () => {
  const migration = await readFile(
    new URL(
      "../drizzle/0008_add_language_lesson_source_number.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /ADD COLUMN "source_lesson_number" integer/);
  assert.match(migration, /ROW_NUMBER\(\) OVER/i);
  assert.match(
    migration,
    /PARTITION BY "language_project_id", "lesson_source"/,
  );
  assert.match(migration, /ORDER BY "lesson_number"/);
  assert.match(
    migration,
    /ALTER COLUMN "source_lesson_number" SET NOT NULL/,
  );
  assert.match(migration, /language_lessons_source_number_check/);
  assert.match(migration, /language_lessons_project_source_number_unique/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE/i);
  assert.doesNotMatch(migration, /SET\s+"lesson_number"/i);
});

test("lesson simplification migration is additive and preserves existing lessons", async () => {
  const migration = await readFile(
    new URL(
      "../drizzle/0009_add_language_lesson_simplification.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /ALTER TABLE "language_lessons"/);
  assert.match(migration, /"simplified_structured_content" jsonb/);
  assert.match(
    migration,
    /"simplification_started_at" timestamp with time zone/,
  );
  assert.match(migration, /"simplified_at" timestamp with time zone/);
  assert.match(migration, /language_lessons_simplified_content_check/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE/i);
  assert.doesNotMatch(
    migration,
    /ADD COLUMN "(?:simplified_structured_content|simplification_started_at|simplified_at)"[^\n]*NOT NULL/i,
  );
});
