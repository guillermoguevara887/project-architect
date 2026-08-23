import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import type {
  GenerateLanguageAudioInput,
  LanguageAudioProvider,
} from "../src/languages/audio.js";
import type {
  ClaimLanguageAudioInput,
  LanguageAudioAsset,
  LanguageAudioStore,
} from "../src/languages/audio-repository.js";
import type {
  LanguageAudioStorage,
  PutLanguageAudioInput,
} from "../src/languages/audio-storage.js";
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
process.env.ELEVENLABS_VOICE_ID_DE_FEMALE = "test-german-female-voice";
process.env.ELEVENLABS_VOICE_ID_DE_MALE = "test-german-male-voice";
for (const code of ["EN", "FR", "PL", "JA", "IT", "PT", "TR", "VI", "NO"]) {
  process.env[`ELEVENLABS_VOICE_ID_${code}_FEMALE`] =
    `test-${code.toLowerCase()}-female-voice`;
  process.env[`ELEVENLABS_VOICE_ID_${code}_MALE`] =
    `test-${code.toLowerCase()}-male-voice`;
}

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

class MemoryLanguageAudioStore implements LanguageAudioStore {
  readonly assets: LanguageAudioAsset[] = [];
  private timestamp = Date.parse("2026-08-16T16:00:00.000Z");

  private now() {
    this.timestamp += 1_000;
    return new Date(this.timestamp);
  }

  private matchingAsset(input: ClaimLanguageAudioInput) {
    return this.assets.find(
      (asset) =>
        asset.userId === input.userId &&
        asset.language === input.language &&
        asset.normalizedText === input.normalizedText &&
        asset.provider === input.provider &&
        asset.model === input.model &&
        asset.voice === input.voice &&
        asset.audioFormat === input.audioFormat,
    );
  }

  async claim(input: ClaimLanguageAudioInput) {
    const existing = this.matchingAsset(input);

    if (existing?.status === "ready") {
      return { kind: "ready" as const, asset: existing };
    }

    if (existing?.status === "generating") {
      return { kind: "processing" as const };
    }

    const generationStartedAt = this.now();
    const now = this.now();
    const asset: LanguageAudioAsset = existing ?? {
      id: randomUUID(),
      ...input,
      status: "generating",
      generationStartedAt,
      createdAt: now,
      updatedAt: now,
    };

    Object.assign(asset, input, {
      status: "generating",
      generationStartedAt,
      updatedAt: now,
    });

    if (!existing) this.assets.push(asset);

    return { kind: "claimed" as const, asset, generationStartedAt };
  }

  async complete(input: { assetId: string; generationStartedAt: Date }) {
    const asset = this.assets.find(({ id }) => id === input.assetId);

    if (
      !asset ||
      asset.status !== "generating" ||
      asset.generationStartedAt?.getTime() !==
        input.generationStartedAt.getTime()
    ) {
      return null;
    }

    asset.status = "ready";
    asset.generationStartedAt = null;
    asset.updatedAt = this.now();
    return asset;
  }

  async fail(input: { assetId: string; generationStartedAt: Date }) {
    const asset = this.assets.find(({ id }) => id === input.assetId);

    if (
      !asset ||
      asset.status !== "generating" ||
      asset.generationStartedAt?.getTime() !==
        input.generationStartedAt.getTime()
    ) {
      return null;
    }

    asset.status = "failed";
    asset.generationStartedAt = null;
    asset.updatedAt = this.now();
    return asset;
  }
}

class FakeLanguageAudioProvider implements LanguageAudioProvider {
  readonly calls: Array<Pick<GenerateLanguageAudioInput, "text" | "language">> = [];
  readonly configurations: GenerateLanguageAudioInput["configuration"][] = [];
  result = new Uint8Array([73, 68, 51]);
  error: Error | null = null;
  wait: Promise<void> | null = null;

  async generate(input: GenerateLanguageAudioInput) {
    this.calls.push({ text: input.text, language: input.language });
    this.configurations.push(input.configuration);
    if (this.wait) await this.wait;
    if (this.error) throw this.error;
    return this.result;
  }
}

class MemoryLanguageAudioStorage implements LanguageAudioStorage {
  readonly objects = new Map<string, Uint8Array>();
  readonly puts: PutLanguageAudioInput[] = [];
  readonly gets: string[] = [];
  putError: Error | null = null;

  async put(input: PutLanguageAudioInput) {
    this.puts.push(input);
    if (this.putError) throw this.putError;
    this.objects.set(input.key, input.body);
  }

  async get(key: string) {
    this.gets.push(key);
    const object = this.objects.get(key);
    if (!object) throw new Error("Audio object missing.");
    return object;
  }
}

function sessionCookie(userId: string) {
  return createSessionCookie(userId).split(";", 1)[0];
}

function testServer(
  store = new MemoryLanguageStore(),
  processor = new FakeLanguageLessonProcessor(),
  audioStore = new MemoryLanguageAudioStore(),
  audioProvider = new FakeLanguageAudioProvider(),
  audioStorage = new MemoryLanguageAudioStorage(),
  elevenLabsProvider = new FakeLanguageAudioProvider(),
) {
  return {
    store,
    processor,
    audioStore,
    audioProvider,
    audioStorage,
    elevenLabsProvider,
    server: createServer(
      {},
      {
        authStore: new MemoryAuthStore(),
        languageStore: store,
        languageLessonProcessor: processor,
        languageAudioStore: audioStore,
        languageAudioProvider: audioProvider,
        elevenLabsLanguageAudioProvider: elevenLabsProvider,
        languageAudioStorage: audioStorage,
      },
    ),
  };
}

async function createProject(
  server: ReturnType<typeof createServer>,
  cookie: string,
  language = "Alemán",
  level = "Nivel 2",
) {
  const response = await server.inject({
    method: "POST",
    url: "/languages/projects",
    headers: { cookie },
    payload: { language: `  ${language}  `, level: `  ${level}  ` },
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

async function requestLessonAudio(
  server: ReturnType<typeof createServer>,
  projectId: string,
  lessonId: string,
  cookie: string,
  payload: unknown,
) {
  return server.inject({
    method: "POST",
    url: `/languages/projects/${projectId}/lessons/${lessonId}/audio`,
    headers: { cookie },
    payload,
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

test("another user cannot read, process, simplify, play, update or delete a lesson", async () => {
  const { processor, audioProvider, server } = testServer();
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
    const audio = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      otherCookie,
      { version: "original", section: "vocabulary", index: 0 },
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
    assert.equal(audio.statusCode, 404);
    assert.equal(update.statusCode, 404);
    assert.equal(deletion.statusCode, 404);
    assert.equal(processor.calls.length, 0);
    assert.equal(audioProvider.calls.length, 0);
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

test("public lesson accepts historical German and Japanese content without kanji", async () => {
  const { store, server } = testServer();
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
    assert.equal("kanji" in detail.json().lesson.structuredContent, false);
    assert.equal(detail.json().lesson.simplifiedStructuredContent, null);
    assert.equal(detail.json().lesson.simplifiedAt, null);

    const storedProject = store.projects.find(({ id }) => id === project.id);
    assert.ok(storedProject);
    storedProject.language = "日本語";
    const japaneseDetail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${lesson.id}`,
      headers: { cookie },
    });
    assert.equal(japaneseDetail.statusCode, 200);
    assert.equal("kanji" in japaneseDetail.json().lesson.structuredContent, false);
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

test("historical simplification without kanji persists and preserves the original", async () => {
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
    assert.equal(
      "kanji" in detail.json().lesson.simplifiedStructuredContent,
      false,
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

test("lesson audio resolves vocabulary, phrases and automatic thoughts using OpenAI", async () => {
  const { store, audioProvider, elevenLabsProvider, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);
    const storedLesson = store.lessons.find(({ id }) => id === lesson.id);
    assert.ok(storedLesson);
    storedLesson.simplifiedStructuredContent = simplifiedLesson;
    storedLesson.simplifiedAt = new Date();

    const vocabulary = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "vocabulary", index: 0 },
    );
    const phrase = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "phrases", index: 0 },
    );
    const automaticThought = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "automaticThoughts", index: 0 },
    );
    const simplifiedAutomaticThought = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "simplified", section: "automaticThoughts", index: 0 },
    );

    assert.equal(vocabulary.statusCode, 200);
    assert.equal(phrase.statusCode, 200);
    assert.equal(automaticThought.statusCode, 200);
    assert.equal(simplifiedAutomaticThought.statusCode, 200);
    assert.deepEqual(audioProvider.calls, [
      { text: "müde", language: "Alemán" },
      { text: "Ich muss früh aufstehen.", language: "Alemán" },
      { text: "Ich bin sehr müde.", language: "Alemán" },
      { text: "Ich bin müde.", language: "Alemán" },
    ]);
    assert.ok(
      audioProvider.configurations.every(
        (configuration) =>
          configuration.provider === "openai" &&
          configuration.model === "gpt-4o-mini-tts" &&
          configuration.voice === "coral" &&
          configuration.audioFormat === "mp3" &&
          configuration.fileExtension === "mp3",
      ),
    );
    assert.equal(elevenLabsProvider.calls.length, 0);
    assert.ok(
      audioProvider.calls.every(
        ({ text }) =>
          text !== "cansado" &&
          text !== "Tengo que levantarme temprano.",
      ),
    );
  } finally {
    await server.close();
  }
});

test("automatic thoughts reuse the existing OpenAI cache and private storage", async () => {
  const { store, audioStore, audioProvider, audioStorage, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);
    const storedLesson = store.lessons.find(({ id }) => id === lesson.id);
    assert.ok(storedLesson?.structuredContent);
    storedLesson.structuredContent.automaticThoughts[0] = {
      text: storedLesson.structuredContent.phrases[0]?.text ?? "",
    };

    const phrase = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "phrases", index: 0 },
    );
    const cachedThought = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "automaticThoughts", index: 0 },
    );

    assert.equal(phrase.statusCode, 200);
    assert.equal(cachedThought.statusCode, 200);
    assert.equal(audioProvider.calls.length, 1);
    assert.equal(audioStorage.puts.length, 1);
    assert.equal(audioStorage.gets.length, 1);
    assert.equal(audioStore.assets.length, 1);
    assert.equal(audioStore.assets[0]?.provider, "openai");
    assert.match(
      audioStore.assets[0]?.storageKey ?? "",
      /^language-audio\/[a-f0-9]{64}\.mp3$/,
    );
  } finally {
    await server.close();
  }
});

test("lesson audio rejects arbitrary text, unsupported sections and invalid indexes", async () => {
  const { audioProvider, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);

    const unauthenticated = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons/${lesson.id}/audio`,
      payload: { version: "original", section: "vocabulary", index: 0 },
    });

    const arbitraryText = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      {
        version: "original",
        section: "vocabulary",
        index: 0,
        text: "Texto elegido por el navegador",
      },
    );
    const unsupportedSection = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "patterns", index: 0 },
    );
    const invalidMiniStoryIndex = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "miniStory", index: 1, voice: "female" },
    );
    const invalidIndex = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "phrases", index: 99 },
    );
    const automaticThoughtWithVoice = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      {
        version: "original",
        section: "automaticThoughts",
        index: 0,
        voice: "female",
      },
    );
    const missingAutomaticThought = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "automaticThoughts", index: 99 },
    );
    const dialogueWithoutVoice = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "dialogue", index: 0 },
    );
    const dialogueWithText = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      {
        version: "original",
        section: "dialogue",
        index: 0,
        voice: "female",
        text: "Texto arbitrario",
      },
    );
    const dialogueWithSpeaker = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      {
        version: "original",
        section: "dialogue",
        index: 0,
        voice: "male",
        speaker: "Navegador",
      },
    );
    const missingDialogueLine = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "dialogue", index: 99, voice: "male" },
    );

    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(arbitraryText.statusCode, 400);
    assert.equal(unsupportedSection.statusCode, 400);
    assert.equal(invalidMiniStoryIndex.statusCode, 400);
    assert.equal(invalidIndex.statusCode, 400);
    assert.equal(automaticThoughtWithVoice.statusCode, 400);
    assert.equal(missingAutomaticThought.statusCode, 400);
    assert.equal(dialogueWithoutVoice.statusCode, 400);
    assert.equal(dialogueWithText.statusCode, 400);
    assert.equal(dialogueWithSpeaker.statusCode, 400);
    assert.equal(missingDialogueLine.statusCode, 400);
    assert.equal(
      missingDialogueLine.json().error,
      "INVALID_LANGUAGE_AUDIO_TARGET",
    );
    assert.equal(
      missingAutomaticThought.json().error,
      "INVALID_LANGUAGE_AUDIO_TARGET",
    );
    assert.equal(audioProvider.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("German mini story uses ElevenLabs for original and simplified content and reuses cache", async () => {
  const {
    store,
    audioStore,
    audioProvider,
    audioStorage,
    elevenLabsProvider,
    server,
  } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie, "  Deutsch  ");
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);
    const storedLesson = store.lessons.find(({ id }) => id === lesson.id);
    assert.ok(storedLesson);
    storedLesson.simplifiedStructuredContent = simplifiedLesson;
    storedLesson.simplifiedAt = new Date();

    const original = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "miniStory", index: 0, voice: "female" },
    );
    const cachedOriginal = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "miniStory", index: 0, voice: "female" },
    );
    const maleOriginal = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "miniStory", index: 0, voice: "male" },
    );
    const simplified = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      {
        version: "simplified",
        section: "miniStory",
        index: 0,
        voice: "female",
      },
    );

    assert.equal(original.statusCode, 200);
    assert.equal(cachedOriginal.statusCode, 200);
    assert.equal(cachedOriginal.body, "ID3");
    assert.equal(maleOriginal.statusCode, 200);
    assert.equal(simplified.statusCode, 200);
    assert.equal(audioProvider.calls.length, 0);
    assert.deepEqual(elevenLabsProvider.calls, [
      {
        text: "Lukas ist müde, aber morgen muss er früh aufstehen.",
        language: "Deutsch",
      },
      {
        text: "Lukas ist müde, aber morgen muss er früh aufstehen.",
        language: "Deutsch",
      },
      {
        text: "Lukas ist müde. Morgen steht er früh auf.",
        language: "Deutsch",
      },
    ]);
    assert.ok(
      elevenLabsProvider.configurations.every(
        (configuration) =>
          configuration.provider === "elevenlabs" &&
          configuration.model === "eleven_multilingual_v2" &&
          ["test-german-female-voice", "test-german-male-voice"].includes(
            configuration.voice,
          ) &&
          configuration.audioFormat === "mp3_44100_128" &&
          configuration.fileExtension === "mp3",
      ),
    );
    assert.equal(audioStorage.puts.length, 3);
    assert.equal(audioStorage.gets.length, 1);
    assert.equal(audioStore.assets.length, 3);
    assert.ok(
      audioStore.assets.every(
        (asset) =>
          asset.provider === "elevenlabs" &&
          asset.model === "eleven_multilingual_v2" &&
          ["test-german-female-voice", "test-german-male-voice"].includes(
            asset.voice,
          ) &&
          asset.audioFormat === "mp3_44100_128" &&
          /^language-audio\/[a-f0-9]{64}\.mp3$/.test(asset.storageKey),
      ),
    );
  } finally {
    await server.close();
  }
});

test("dialogue uses voiced ElevenLabs targets and reuses each stored line asset", async () => {
  const {
    store,
    audioStore,
    audioProvider,
    audioStorage,
    elevenLabsProvider,
    server,
  } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie, "Deutsch");
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);
    const storedLesson = store.lessons.find(({ id }) => id === lesson.id);
    assert.ok(storedLesson);
    storedLesson.simplifiedStructuredContent = simplifiedLesson;
    storedLesson.simplifiedAt = new Date();

    const requests = [
      { version: "original", section: "dialogue", index: 0, voice: "female" },
      { version: "original", section: "dialogue", index: 0, voice: "female" },
      { version: "original", section: "dialogue", index: 1, voice: "male" },
      { version: "simplified", section: "dialogue", index: 0, voice: "female" },
    ] as const;

    for (const payload of requests) {
      const response = await requestLessonAudio(
        server,
        project.id,
        lesson.id,
        cookie,
        payload,
      );
      assert.equal(response.statusCode, 200);
    }

    assert.equal(audioProvider.calls.length, 0);
    assert.deepEqual(elevenLabsProvider.calls, [
      { text: "Ich bin müde.", language: "Deutsch" },
      { text: "Dann geh schlafen.", language: "Deutsch" },
    ]);
    assert.deepEqual(
      elevenLabsProvider.configurations.map(({ model, voice }) => ({
        model,
        voice,
      })),
      [
        {
          model: "eleven_multilingual_v2",
          voice: "test-german-female-voice",
        },
        {
          model: "eleven_multilingual_v2",
          voice: "test-german-male-voice",
        },
      ],
    );
    assert.equal(audioStore.assets.length, 2);
    assert.equal(audioStorage.puts.length, 2);
    assert.equal(audioStorage.gets.length, 2);
  } finally {
    await server.close();
  }
});

test("dialogue selects multilingual and Flash configurations without OpenAI fallback", async () => {
  const { audioProvider, elevenLabsProvider, server } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const languages = [
    ["Français", "fr", "female", "eleven_multilingual_v2", undefined],
    ["Tiếng Việt", "vi", "male", "eleven_flash_v2_5", "vi"],
    ["Norsk", "no", "female", "eleven_flash_v2_5", "no"],
  ] as const;

  try {
    for (const [language, code, voice] of languages) {
      const project = await createProject(server, cookie, language);
      const lesson = await createLesson(server, project.id, cookie);
      await processLesson(server, project.id, lesson.id, cookie);
      const response = await requestLessonAudio(
        server,
        project.id,
        lesson.id,
        cookie,
        { version: "original", section: "dialogue", index: 0, voice },
      );
      assert.equal(response.statusCode, 200, `${code} ${voice}`);
    }

    assert.equal(audioProvider.calls.length, 0);
    assert.deepEqual(
      elevenLabsProvider.configurations.map(
        ({ model, voice, languageCode }) => ({ model, voice, languageCode }),
      ),
      languages.map(([, code, voice, model, languageCode]) => ({
        model,
        voice: `test-${code}-${voice}-voice`,
        languageCode,
      })),
    );
  } finally {
    await server.close();
  }
});

test("dialogue returns its own unavailable errors without provider fallback", async () => {
  const unsupported = testServer();
  const missingVoice = testServer();
  const cookie = sessionCookie(firstUser.id);
  const femaleVoice = process.env.ELEVENLABS_VOICE_ID_DE_FEMALE;

  try {
    const unsupportedProject = await createProject(
      unsupported.server,
      cookie,
      "Klingon",
    );
    const unsupportedLesson = await createLesson(
      unsupported.server,
      unsupportedProject.id,
      cookie,
    );
    await processLesson(
      unsupported.server,
      unsupportedProject.id,
      unsupportedLesson.id,
      cookie,
    );
    const unavailable = await requestLessonAudio(
      unsupported.server,
      unsupportedProject.id,
      unsupportedLesson.id,
      cookie,
      { version: "original", section: "dialogue", index: 0, voice: "female" },
    );

    const germanProject = await createProject(
      missingVoice.server,
      cookie,
      "Alemán",
    );
    const germanLesson = await createLesson(
      missingVoice.server,
      germanProject.id,
      cookie,
    );
    await processLesson(
      missingVoice.server,
      germanProject.id,
      germanLesson.id,
      cookie,
    );
    delete process.env.ELEVENLABS_VOICE_ID_DE_FEMALE;
    const voiceUnavailable = await requestLessonAudio(
      missingVoice.server,
      germanProject.id,
      germanLesson.id,
      cookie,
      { version: "original", section: "dialogue", index: 0, voice: "female" },
    );

    assert.equal(unavailable.statusCode, 409);
    assert.equal(unavailable.json().error, "LANGUAGE_DIALOGUE_AUDIO_UNAVAILABLE");
    assert.equal(voiceUnavailable.statusCode, 409);
    assert.equal(
      voiceUnavailable.json().error,
      "LANGUAGE_DIALOGUE_AUDIO_VOICE_UNAVAILABLE",
    );
    assert.equal(unsupported.audioProvider.calls.length, 0);
    assert.equal(unsupported.elevenLabsProvider.calls.length, 0);
    assert.equal(missingVoice.audioProvider.calls.length, 0);
    assert.equal(missingVoice.elevenLabsProvider.calls.length, 0);
  } finally {
    if (femaleVoice) {
      process.env.ELEVENLABS_VOICE_ID_DE_FEMALE = femaleVoice;
    }
    await unsupported.server.close();
    await missingVoice.server.close();
  }
});

test("configured story languages select their own ElevenLabs voice and model", async () => {
  const { audioProvider, elevenLabsProvider, server } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const languages = [
    ["English", "en", "male", "eleven_multilingual_v2", undefined],
    ["Français", "fr", "female", "eleven_multilingual_v2", undefined],
    ["Polski", "pl", "male", "eleven_multilingual_v2", undefined],
    ["日本語", "ja", "female", "eleven_multilingual_v2", undefined],
    ["Italiano", "it", "male", "eleven_multilingual_v2", undefined],
    ["Português", "pt", "female", "eleven_multilingual_v2", undefined],
    ["Türkçe", "tr", "male", "eleven_multilingual_v2", undefined],
    ["Tiếng Việt", "vi", "female", "eleven_flash_v2_5", "vi"],
    ["Norsk", "no", "male", "eleven_flash_v2_5", "no"],
  ] as const;

  try {
    for (const [language, code, voice] of languages) {
      const project = await createProject(server, cookie, language);
      const lesson = await createLesson(server, project.id, cookie);
      await processLesson(server, project.id, lesson.id, cookie);
      const response = await requestLessonAudio(
        server,
        project.id,
        lesson.id,
        cookie,
        { version: "original", section: "miniStory", index: 0, voice },
      );
      assert.equal(response.statusCode, 200, `${code} ${voice}`);
    }

    assert.equal(audioProvider.calls.length, 0);
    assert.deepEqual(
      elevenLabsProvider.configurations.map((configuration) => ({
        model: configuration.model,
        voice: configuration.voice,
        languageCode: configuration.languageCode,
      })),
      languages.map(([, code, voice, model, languageCode]) => ({
        model,
        voice: `test-${code}-${voice}-voice`,
        languageCode,
      })),
    );
  } finally {
    await server.close();
  }
});

test("mini story in an unsupported language returns controlled 409 without provider fallback", async () => {
  const { audioProvider, elevenLabsProvider, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie, "Klingon");
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);

    const response = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "miniStory", index: 0, voice: "female" },
    );

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "LANGUAGE_STORY_AUDIO_UNAVAILABLE");
    assert.equal(audioProvider.calls.length, 0);
    assert.equal(elevenLabsProvider.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("missing selected German voice returns controlled 409 without voice or provider fallback", async () => {
  const dependencies = testServer();
  const cookie = sessionCookie(firstUser.id);
  const femaleVoice = process.env.ELEVENLABS_VOICE_ID_DE_FEMALE;
  const maleVoice = process.env.ELEVENLABS_VOICE_ID_DE_MALE;

  try {
    const project = await createProject(dependencies.server, cookie, "Alemán");
    const lesson = await createLesson(
      dependencies.server,
      project.id,
      cookie,
    );
    await processLesson(dependencies.server, project.id, lesson.id, cookie);

    delete process.env.ELEVENLABS_VOICE_ID_DE_FEMALE;
    const unavailableFemale = await requestLessonAudio(
      dependencies.server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "miniStory", index: 0, voice: "female" },
    );
    process.env.ELEVENLABS_VOICE_ID_DE_FEMALE = femaleVoice;
    delete process.env.ELEVENLABS_VOICE_ID_DE_MALE;
    const unavailableMale = await requestLessonAudio(
      dependencies.server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "miniStory", index: 0, voice: "male" },
    );

    assert.equal(unavailableFemale.statusCode, 409);
    assert.equal(
      unavailableFemale.json().error,
      "LANGUAGE_STORY_AUDIO_VOICE_UNAVAILABLE",
    );
    assert.equal(unavailableMale.statusCode, 409);
    assert.equal(
      unavailableMale.json().error,
      "LANGUAGE_STORY_AUDIO_VOICE_UNAVAILABLE",
    );
    assert.equal(dependencies.audioProvider.calls.length, 0);
    assert.equal(dependencies.elevenLabsProvider.calls.length, 0);
    assert.equal(dependencies.audioStore.assets.length, 0);
  } finally {
    if (femaleVoice) {
      process.env.ELEVENLABS_VOICE_ID_DE_FEMALE = femaleVoice;
    }
    if (maleVoice) {
      process.env.ELEVENLABS_VOICE_ID_DE_MALE = maleVoice;
    }
    await dependencies.server.close();
  }
});

test("ElevenLabs failure marks mini story audio failed without storing an object", async () => {
  const dependencies = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(dependencies.server, cookie, "German");
    const lesson = await createLesson(
      dependencies.server,
      project.id,
      cookie,
    );
    await processLesson(dependencies.server, project.id, lesson.id, cookie);
    dependencies.elevenLabsProvider.error = new Error("ElevenLabs unavailable");

    const response = await requestLessonAudio(
      dependencies.server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "miniStory", index: 0, voice: "male" },
    );

    assert.equal(response.statusCode, 502);
    assert.equal(dependencies.audioStore.assets[0]?.status, "failed");
    assert.equal(dependencies.audioStorage.puts.length, 0);
    assert.equal(dependencies.audioProvider.calls.length, 0);
    assert.equal(dependencies.elevenLabsProvider.calls.length, 1);
  } finally {
    await dependencies.server.close();
  }
});

test("first audio access stores private cache metadata and later accesses reuse it", async () => {
  const { audioStore, audioProvider, audioStorage, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const firstLesson = await createLesson(server, project.id, cookie);
    const secondLesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, firstLesson.id, cookie);
    await processLesson(server, project.id, secondLesson.id, cookie);
    const payload = { version: "original", section: "vocabulary", index: 0 };

    const first = await requestLessonAudio(
      server,
      project.id,
      firstLesson.id,
      cookie,
      payload,
    );
    const second = await requestLessonAudio(
      server,
      project.id,
      firstLesson.id,
      cookie,
      payload,
    );
    const anotherLesson = await requestLessonAudio(
      server,
      project.id,
      secondLesson.id,
      cookie,
      payload,
    );

    assert.equal(first.statusCode, 200);
    assert.equal(first.body, "ID3");
    assert.match(first.headers["content-type"] ?? "", /^audio\/mpeg/);
    assert.equal(second.statusCode, 200);
    assert.equal(anotherLesson.statusCode, 200);
    assert.equal(audioProvider.calls.length, 1);
    assert.equal(audioStorage.puts.length, 1);
    assert.equal(audioStorage.gets.length, 2);
    assert.equal(audioStore.assets.length, 1);
    assert.deepEqual(
      {
        userId: audioStore.assets[0]?.userId,
        language: audioStore.assets[0]?.language,
        normalizedText: audioStore.assets[0]?.normalizedText,
        originalText: audioStore.assets[0]?.originalText,
        provider: audioStore.assets[0]?.provider,
        model: audioStore.assets[0]?.model,
        voice: audioStore.assets[0]?.voice,
        audioFormat: audioStore.assets[0]?.audioFormat,
        status: audioStore.assets[0]?.status,
      },
      {
        userId: firstUser.id,
        language: "Alemán",
        normalizedText: "müde",
        originalText: "müde",
        provider: "openai",
        model: "gpt-4o-mini-tts",
        voice: "coral",
        audioFormat: "mp3",
        status: "ready",
      },
    );
    assert.match(
      audioStore.assets[0]?.storageKey ?? "",
      /^language-audio\/[a-f0-9]{64}\.mp3$/,
    );
    assert.doesNotMatch(audioStore.assets[0]?.storageKey ?? "", /müde/);
    const responses = `${first.body}${second.body}${anotherLesson.body}`;
    assert.doesNotMatch(
      responses,
      /R2_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|ENDPOINT|BUCKET_NAME|REGION)/,
    );
  } finally {
    await server.close();
  }
});

test("audio cache separates languages and supports original and simplified versions", async () => {
  const { store, audioProvider, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const germanProject = await createProject(server, cookie, "Alemán");
    const germanLesson = await createLesson(server, germanProject.id, cookie);
    await processLesson(server, germanProject.id, germanLesson.id, cookie);
    const storedGermanLesson = store.lessons.find(
      ({ id }) => id === germanLesson.id,
    );
    assert.ok(storedGermanLesson);
    storedGermanLesson.simplifiedStructuredContent = simplifiedLesson;
    storedGermanLesson.simplifiedAt = new Date();

    const polishProject = await createProject(server, cookie, "Polaco");
    const polishLesson = await createLesson(server, polishProject.id, cookie);
    await processLesson(server, polishProject.id, polishLesson.id, cookie);

    const original = await requestLessonAudio(
      server,
      germanProject.id,
      germanLesson.id,
      cookie,
      { version: "original", section: "phrases", index: 0 },
    );
    const simplified = await requestLessonAudio(
      server,
      germanProject.id,
      germanLesson.id,
      cookie,
      { version: "simplified", section: "phrases", index: 0 },
    );
    const otherLanguage = await requestLessonAudio(
      server,
      polishProject.id,
      polishLesson.id,
      cookie,
      { version: "original", section: "vocabulary", index: 0 },
    );
    const germanVocabulary = await requestLessonAudio(
      server,
      germanProject.id,
      germanLesson.id,
      cookie,
      { version: "original", section: "vocabulary", index: 0 },
    );

    assert.equal(original.statusCode, 200);
    assert.equal(simplified.statusCode, 200);
    assert.equal(otherLanguage.statusCode, 200);
    assert.equal(germanVocabulary.statusCode, 200);
    assert.deepEqual(audioProvider.calls, [
      { text: "Ich muss früh aufstehen.", language: "Alemán" },
      { text: "Ich stehe früh auf.", language: "Alemán" },
      { text: "müde", language: "Polaco" },
      { text: "müde", language: "Alemán" },
    ]);
  } finally {
    await server.close();
  }
});

test("concurrent audio requests make only one TTS call", async () => {
  const { audioProvider, server } = testServer();
  const cookie = sessionCookie(firstUser.id);
  let release = () => {};

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    await processLesson(server, project.id, lesson.id, cookie);
    audioProvider.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const payload = { version: "original", section: "vocabulary", index: 0 };
    const first = requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      payload,
    );

    for (
      let attempt = 0;
      attempt < 20 && audioProvider.calls.length === 0;
      attempt += 1
    ) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    const second = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      payload,
    );
    release();
    const completed = await first;

    assert.equal(completed.statusCode, 200);
    assert.equal(second.statusCode, 409);
    assert.equal(
      second.json().error,
      "LANGUAGE_AUDIO_GENERATION_PROCESSING",
    );
    assert.equal(audioProvider.calls.length, 1);
  } finally {
    release();
    await server.close();
  }
});

test("TTS and storage failures never leave an audio asset ready", async () => {
  const ttsDependencies = testServer();
  const storageDependencies = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const ttsProject = await createProject(ttsDependencies.server, cookie);
    const ttsLesson = await createLesson(
      ttsDependencies.server,
      ttsProject.id,
      cookie,
    );
    await processLesson(
      ttsDependencies.server,
      ttsProject.id,
      ttsLesson.id,
      cookie,
    );
    ttsDependencies.audioProvider.error = new Error("Provider unavailable");
    const failedTts = await requestLessonAudio(
      ttsDependencies.server,
      ttsProject.id,
      ttsLesson.id,
      cookie,
      { version: "original", section: "vocabulary", index: 0 },
    );

    const storageProject = await createProject(storageDependencies.server, cookie);
    const storageLesson = await createLesson(
      storageDependencies.server,
      storageProject.id,
      cookie,
    );
    await processLesson(
      storageDependencies.server,
      storageProject.id,
      storageLesson.id,
      cookie,
    );
    storageDependencies.audioStorage.putError = new Error("Storage unavailable");
    const failedStorage = await requestLessonAudio(
      storageDependencies.server,
      storageProject.id,
      storageLesson.id,
      cookie,
      { version: "original", section: "vocabulary", index: 0 },
    );

    assert.equal(failedTts.statusCode, 502);
    assert.equal(ttsDependencies.audioStorage.puts.length, 0);
    assert.equal(ttsDependencies.audioStore.assets[0]?.status, "failed");
    assert.equal(failedStorage.statusCode, 502);
    assert.equal(storageDependencies.audioStorage.puts.length, 1);
    assert.equal(storageDependencies.audioStore.assets[0]?.status, "failed");
  } finally {
    await ttsDependencies.server.close();
    await storageDependencies.server.close();
  }
});

test("language audio migration is additive and contains only private cache metadata", async () => {
  const migration = await readFile(
    new URL(
      "../drizzle/0010_create_language_audio_assets.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE "language_audio_assets"/);
  assert.match(migration, /language_audio_assets_cache_unique/);
  assert.match(migration, /"generation_started_at" timestamp with time zone/);
  assert.match(migration, /'generating', 'ready', 'failed'/);
  assert.doesNotMatch(migration, /(?:audio_data|bytea|R2_SECRET|OPENAI_API_KEY)/i);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i);
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
