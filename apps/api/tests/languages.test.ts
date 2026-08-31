import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import type {
  AssimilLanguageLessonProcessor,
  ProcessAssimilLanguageLessonInput,
} from "../src/languages/assimil-processor.js";
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
import {
  LANGUAGE_FREE_LESSON_TITLE_MAX_LENGTH,
  languageLessonDifficultySchema,
  languageLessonLearningStatusSchema,
  prepareFreeLanguageLessonSchema,
  structuredLanguageLessonSchema,
  updateLanguageLessonProgressSchema,
  type LanguageLessonDifficulty,
  type LanguageLessonLearningStatus,
  type LanguageLessonSource,
  type StructuredLanguageLesson,
  type AssimilLanguageLessonContent,
} from "../src/languages/contracts.js";
import type {
  AnalyzeFreeLanguageLessonInput,
  FreeLanguageLessonAnalyzer,
} from "../src/languages/free-analyzer.js";
import {
  LanguageLessonProcessingError,
  type LanguageLessonProcessor,
  type ProcessLanguageLessonInput,
  type SimplifyLanguageLessonInput,
} from "../src/languages/lesson-processor.js";
import {
  isA1LanguageLevel,
  languageLessonIsSplitEligible,
  type LanguageLessonSplitter,
  type SplitLanguageLessonInput,
  type SplitLanguageLessonResult,
} from "../src/languages/lesson-splitter.js";
import type {
  LanguageLessonVerySimplifier,
  VerySimplifyLanguageLessonInput,
} from "../src/languages/lesson-very-simplifier.js";
import type {
  ClaimLanguageLessonInput,
  ClaimLanguageLessonSimplificationInput,
  CompleteLanguageLessonProcessingInput,
  CompleteAssimilLanguageLessonProcessingInput,
  CompleteLanguageLessonSimplificationInput,
  CreateLanguageLessonSplitChildrenInput,
  CreateLanguageProjectInput,
  CreateNextLanguageLessonInput,
  FailLanguageLessonProcessingInput,
  FailLanguageLessonSimplificationInput,
  InspectLanguageLessonSplitInput,
  LanguageLesson,
  LanguageLessonSplitParts,
  LanguageProject,
  LanguageStore,
  PrepareFreeLanguageLessonInput,
  SaveFreeLanguageLessonAnalysisInput,
  UpdateLanguageLessonInput,
  UpdateLanguageLessonProgressInput,
} from "../src/languages/repository.js";
import { AssimilLanguageLessonNumberExistsError } from "../src/languages/repository.js";

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

const assimilLesson: AssimilLanguageLessonContent = {
  kind: "assimil_v1",
  comprehension: [
    {
      line: "Ich bin müde.",
      translation: "Estoy cansado.",
      note: null,
    },
  ],
  notes: [
    { title: "bin", explanation: "Primera persona de sein." },
    { title: "müde", explanation: "Describe cansancio." },
    { title: "Orden", explanation: "El adjetivo aparece tras el verbo." },
  ],
  patterns: [
    {
      pattern: "Ich bin …",
      explanation: "Sirve para describir un estado.",
      examples: ["Ich bin bereit."],
    },
  ],
  keyPhrases: [
    { text: "Ich bin müde.", meaning: "Estoy cansado." },
    { text: "Ich bin bereit.", meaning: "Estoy listo." },
    { text: "Bis morgen.", meaning: "Hasta mañana." },
  ],
  practice: {
    instructions: "Completa las frases.",
    items: [
      { prompt: "Ich ___ müde.", answer: "bin" },
      { prompt: "Bis ___.", answer: "morgen" },
    ],
  },
  review: null,
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

const splitResult: SplitLanguageLessonResult = {
  partA: structuredLesson,
  partB: regeneratedLesson,
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
  failSplitAfterPartA = false;
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

  private splitParts(parentId: string): LanguageLessonSplitParts | null {
    const children = this.lessons.filter(
      ({ splitParentLessonId }) => splitParentLessonId === parentId,
    );
    if (children.length !== 2) return null;

    const partA = children.find(({ splitPart }) => splitPart === "A");
    const partB = children.find(({ splitPart }) => splitPart === "B");
    return partA && partB ? { A: partA, B: partB } : null;
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
    let sourceLessonNumber: number;

    if (input.lessonSource === "assimil") {
      if (input.sourceLessonNumber === undefined) {
        throw new Error("Assimil lessons require a source lesson number.");
      }
      if (
        this.lessons.some(
          (lesson) =>
            lesson.languageProjectId === input.languageProjectId &&
            lesson.lessonSource === "assimil" &&
            lesson.sourceLessonNumber === input.sourceLessonNumber &&
            lesson.splitParentLessonId === null,
        )
      ) {
        throw new AssimilLanguageLessonNumberExistsError(
          input.sourceLessonNumber,
        );
      }
      sourceLessonNumber = input.sourceLessonNumber;
    } else {
      sourceLessonNumber =
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
    }
    const now = this.now();
    const lesson: LanguageLesson = {
      id: randomUUID(),
      languageProjectId: input.languageProjectId,
      lessonNumber,
      lessonSource: input.lessonSource,
      sourceLessonNumber,
      splitParentLessonId: null,
      splitPart: null,
      sourceContent: "",
      freeTitle: null,
      freeAnalysis: null,
      status: "draft",
      learningStatus: "pending",
      difficulty: null,
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

  async inspectLessonSplit(input: InspectLanguageLessonSplitInput) {
    const project = this.projects.find(
      ({ id, userId }) =>
        id === input.languageProjectId && userId === input.userId,
    );
    const parent = this.lessons.find(
      ({ id, languageProjectId }) =>
        id === input.lessonId &&
        languageProjectId === input.languageProjectId,
    );

    if (!project || !parent) return { kind: "not_found" as const };
    if (!languageLessonIsSplitEligible(project.level, parent)) {
      return { kind: "not_eligible" as const };
    }

    const children = this.lessons.filter(
      ({ splitParentLessonId }) => splitParentLessonId === parent.id,
    );
    if (children.length === 0) {
      return { kind: "eligible" as const, project, parent };
    }

    const parts = this.splitParts(parent.id);
    return parts
      ? { kind: "existing" as const, project, parent, parts }
      : { kind: "inconsistent" as const };
  }

  async createLessonSplitChildren(
    input: CreateLanguageLessonSplitChildrenInput,
  ) {
    const inspection = await this.inspectLessonSplit(input);
    if (
      inspection.kind === "not_found" ||
      inspection.kind === "not_eligible" ||
      inspection.kind === "inconsistent"
    ) {
      return inspection;
    }
    if (inspection.kind === "existing") {
      return {
        kind: "existing" as const,
        parent: inspection.parent,
        parts: inspection.parts,
      };
    }

    const parent = inspection.parent;
    const lessonNumber =
      Math.max(
        0,
        ...this.lessons
          .filter(
            ({ languageProjectId }) =>
              languageProjectId === input.languageProjectId,
          )
          .map((lesson) => lesson.lessonNumber),
      ) + 1;
    const originalLength = this.lessons.length;
    const createPart = (
      splitPart: "A" | "B",
      partLessonNumber: number,
      structuredContent: StructuredLanguageLesson,
    ): LanguageLesson => {
      const now = this.now();
      return {
        id: randomUUID(),
        languageProjectId: parent.languageProjectId,
        lessonNumber: partLessonNumber,
        lessonSource: "language_framework",
        sourceLessonNumber: parent.sourceLessonNumber,
        splitParentLessonId: parent.id,
        splitPart,
        sourceContent: "",
        freeTitle: null,
        freeAnalysis: null,
        status: "ready",
        learningStatus: "pending",
        difficulty: null,
        structuredContent,
        simplifiedStructuredContent: null,
        simplificationStartedAt: null,
        simplifiedAt: null,
        processedAt: now,
        createdAt: now,
        updatedAt: now,
      };
    };

    try {
      const partA = createPart("A", lessonNumber, input.partA);
      this.lessons.push(partA);
      if (this.failSplitAfterPartA) {
        throw new Error("Simulated part B insertion failure.");
      }
      const partB = createPart("B", lessonNumber + 1, input.partB);
      this.lessons.push(partB);
      return {
        kind: "created" as const,
        parent,
        parts: { A: partA, B: partB },
      };
    } catch (error) {
      this.lessons.splice(originalLength);
      throw error;
    }
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

    if (
      lesson.lessonSource !== "language_framework" ||
      lesson.splitParentLessonId !== null ||
      lesson.splitPart !== null
    ) {
      return { kind: "not_eligible" as const };
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

  async claimAssimilLessonForProcessing(input: ClaimLanguageLessonInput) {
    const project = this.projects.find(
      (candidate) =>
        candidate.id === input.languageProjectId &&
        candidate.userId === input.userId,
    );
    if (!project) return { kind: "not_found" as const };

    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );
    if (!lesson) return { kind: "not_found" as const };
    if (
      lesson.lessonSource !== "assimil" ||
      lesson.splitParentLessonId !== null ||
      lesson.splitPart !== null ||
      lesson.sourceLessonNumber < 1 ||
      lesson.sourceLessonNumber > 9_999
    ) {
      return { kind: "not_eligible" as const };
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

  async completeAssimilLessonProcessing(
    input: CompleteAssimilLanguageLessonProcessingInput,
  ) {
    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );
    if (
      !this.ownsProject(input.languageProjectId, input.userId) ||
      !lesson ||
      lesson.lessonSource !== "assimil" ||
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

  async failAssimilLessonProcessing(input: FailLanguageLessonProcessingInput) {
    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );
    if (
      !this.ownsProject(input.languageProjectId, input.userId) ||
      !lesson ||
      lesson.lessonSource !== "assimil" ||
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

  async updateLessonLearningProgress(input: UpdateLanguageLessonProgressInput) {
    if (!this.ownsProject(input.languageProjectId, input.userId)) {
      return null;
    }

    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );
    if (!lesson) return null;

    if (input.learningStatus !== undefined) {
      lesson.learningStatus = input.learningStatus;
    }
    if (input.difficulty !== undefined) {
      lesson.difficulty = input.difficulty;
    }
    lesson.updatedAt = this.now();
    return lesson;
  }

  async prepareFreeLesson(input: PrepareFreeLanguageLessonInput) {
    if (!this.ownsProject(input.languageProjectId, input.userId)) {
      return { kind: "not_found" as const };
    }

    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );

    if (!lesson) return { kind: "not_found" as const };
    if (lesson.lessonSource !== "free") {
      return { kind: "wrong_source" as const };
    }
    if (
      lesson.freeTitle !== null ||
      (lesson.status !== "draft" && lesson.status !== "failed")
    ) {
      return { kind: "not_editable" as const };
    }

    const preparedAt = this.now();
    lesson.freeTitle = input.title;
    lesson.sourceContent = input.sourceContent;
    lesson.status = "ready";
    lesson.structuredContent = null;
    lesson.simplifiedStructuredContent = null;
    lesson.simplificationStartedAt = null;
    lesson.simplifiedAt = null;
    lesson.processedAt = preparedAt;
    lesson.updatedAt = preparedAt;
    return { kind: "prepared" as const, lesson };
  }

  async saveFreeLessonAnalysis(input: SaveFreeLanguageLessonAnalysisInput) {
    if (!this.ownsProject(input.languageProjectId, input.userId)) {
      return { kind: "not_found" as const };
    }
    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );
    if (!lesson) return { kind: "not_found" as const };
    if (
      lesson.lessonSource !== "free" ||
      lesson.freeTitle === null ||
      lesson.status !== "ready" ||
      !lesson.sourceContent.trim()
    ) {
      return { kind: "not_eligible" as const };
    }
    if (lesson.freeAnalysis !== null) {
      return { kind: "existing" as const, lesson };
    }
    lesson.freeAnalysis = input.analysis;
    lesson.updatedAt = this.now();
    return { kind: "saved" as const, lesson };
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

    if (lesson.splitParentLessonId !== null || lesson.splitPart !== null) {
      return { kind: "not_eligible" as const };
    }

    if (lesson.status !== "ready" || !lesson.structuredContent) {
      return { kind: "not_ready" as const };
    }

    if (!structuredLanguageLessonSchema.safeParse(lesson.structuredContent).success) {
      return { kind: "not_eligible" as const };
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

  async claimLessonForVerySimplification(
    input: ClaimLanguageLessonSimplificationInput,
  ) {
    const project = this.projects.find(
      (candidate) =>
        candidate.id === input.languageProjectId &&
        candidate.userId === input.userId,
    );
    if (!project) return { kind: "not_found" as const };

    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );
    if (!lesson) return { kind: "not_found" as const };

    if (
      !isA1LanguageLevel(project.level) ||
      lesson.lessonSource !== "language_framework" ||
      lesson.splitParentLessonId === null ||
      (lesson.splitPart !== "A" && lesson.splitPart !== "B") ||
      lesson.status !== "ready" ||
      !structuredLanguageLessonSchema.safeParse(lesson.structuredContent).success
    ) {
      return { kind: "not_eligible" as const };
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
      return { kind: "not_found" as const };
    }

    const index = this.lessons.findIndex(
      (lesson) =>
        lesson.id === lessonId && lesson.languageProjectId === projectId,
    );

    if (index === -1) {
      return { kind: "not_found" as const };
    }

    if (this.lessons[index]?.splitParentLessonId !== null) {
      return { kind: "split_child" as const };
    }

    const childIds = new Set(
      this.lessons
        .filter(({ splitParentLessonId }) => splitParentLessonId === lessonId)
        .map(({ id }) => id),
    );
    this.lessons.splice(
      0,
      this.lessons.length,
      ...this.lessons.filter(
        ({ id }) => id !== lessonId && !childIds.has(id),
      ),
    );
    return { kind: "deleted" as const };
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

class FakeAssimilLanguageLessonProcessor
  implements AssimilLanguageLessonProcessor
{
  readonly calls: ProcessAssimilLanguageLessonInput[] = [];
  result = assimilLesson;
  error: Error | null = null;

  async process(input: ProcessAssimilLanguageLessonInput) {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.result;
  }
}

class FakeLanguageLessonSplitter implements LanguageLessonSplitter {
  readonly calls: SplitLanguageLessonInput[] = [];
  result = splitResult;
  error: Error | null = null;

  async split(input: SplitLanguageLessonInput) {
    this.calls.push(input);
    if (this.error) throw this.error;
    return this.result;
  }
}

class FakeLanguageLessonVerySimplifier
  implements LanguageLessonVerySimplifier
{
  readonly calls: VerySimplifyLanguageLessonInput[] = [];
  result = structuredLesson;
  error: Error | null = null;
  wait: Promise<void> | null = null;

  async simplifyVery(input: VerySimplifyLanguageLessonInput) {
    this.calls.push(input);
    if (this.wait) await this.wait;
    if (this.error) throw this.error;
    return this.result;
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

class FakeFreeLanguageLessonAnalyzer implements FreeLanguageLessonAnalyzer {
  readonly calls: AnalyzeFreeLanguageLessonInput[] = [];
  result = {
    items: [
      {
        phrase: "Ich warte am Bahnhof.",
        pattern: "auf + Akkusativ warten",
        explanation: "Se usa para indicar que esperas algo o a alguien.",
      },
    ],
  };
  error: Error | null = null;

  async analyze(input: AnalyzeFreeLanguageLessonInput) {
    this.calls.push(input);
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
  freeAnalyzer = new FakeFreeLanguageLessonAnalyzer(),
  splitter = new FakeLanguageLessonSplitter(),
  verySimplifier = new FakeLanguageLessonVerySimplifier(),
  assimilProcessor = new FakeAssimilLanguageLessonProcessor(),
) {
  return {
    store,
    processor,
    splitter,
    verySimplifier,
    audioStore,
    audioProvider,
    audioStorage,
    elevenLabsProvider,
    freeAnalyzer,
    assimilProcessor,
    server: createServer(
      {},
      {
        authStore: new MemoryAuthStore(),
        languageStore: store,
        languageLessonProcessor: processor,
        languageLessonSplitter: splitter,
        languageLessonVerySimplifier: verySimplifier,
        freeLanguageLessonAnalyzer: freeAnalyzer,
        assimilLanguageLessonProcessor: assimilProcessor,
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
  lessonSource: LanguageLessonSource = "language_framework",
  sourceLessonNumber = 1,
) {
  const response = await server.inject({
    method: "POST",
    url: `/languages/projects/${projectId}/lessons`,
    headers: { cookie },
    payload: {
      lessonSource,
      ...(lessonSource === "assimil" ? { sourceLessonNumber } : {}),
    },
  });

  assert.equal(response.statusCode, 201);
  return response.json().lesson as {
    id: string;
    lessonNumber: number;
    lessonSource: LanguageLessonSource;
    sourceLessonNumber: number;
    learningStatus: LanguageLessonLearningStatus;
    difficulty: LanguageLessonDifficulty | null;
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

async function processAssimilLesson(
  server: ReturnType<typeof createServer>,
  projectId: string,
  lessonId: string,
  cookie: string,
  sourceContent = "Ich bin müde. Ich bin bereit. Bis morgen.",
) {
  return server.inject({
    method: "POST",
    url: `/languages/projects/${projectId}/lessons/${lessonId}/assimil/process`,
    headers: { cookie },
    payload: { sourceContent },
  });
}

async function splitLesson(
  server: ReturnType<typeof createServer>,
  projectId: string,
  lessonId: string,
  cookie?: string,
  payload?: unknown,
) {
  return server.inject({
    method: "POST",
    url: `/languages/projects/${projectId}/lessons/${lessonId}/split`,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload !== undefined ? { payload } : {}),
  });
}

async function prepareFreeLesson(
  server: ReturnType<typeof createServer>,
  projectId: string,
  lessonId: string,
  cookie: string,
  payload: unknown = {
    title: "Am Bahnhof",
    sourceContent: "  Ich warte am Bahnhof.\nDer Zug kommt gleich.  ",
  },
) {
  return server.inject({
    method: "POST",
    url: `/languages/projects/${projectId}/lessons/${lessonId}/free/prepare`,
    headers: { cookie },
    payload,
  });
}

async function analyzeFreeLesson(
  server: ReturnType<typeof createServer>,
  projectId: string,
  lessonId: string,
  cookie?: string,
  payload?: unknown,
) {
  return server.inject({
    method: "POST",
    url: `/languages/projects/${projectId}/lessons/${lessonId}/free/analyze`,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload !== undefined ? { payload } : {}),
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

async function verySimplifyLesson(
  server: ReturnType<typeof createServer>,
  projectId: string,
  lessonId: string,
  cookie?: string,
  payload?: unknown,
) {
  return server.inject({
    method: "POST",
    url: `/languages/projects/${projectId}/lessons/${lessonId}/simplify/very`,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(payload !== undefined ? { payload } : {}),
  });
}

async function createReadyFrameworkSplitFixture(
  context: ReturnType<typeof testServer>,
  cookie: string,
  level = "A1 Beginner",
) {
  const project = await createProject(
    context.server,
    cookie,
    "Alemán",
    level,
  );
  const parent = await createLesson(
    context.server,
    project.id,
    cookie,
    "language_framework",
  );
  const storedParent = context.store.lessons.find(({ id }) => id === parent.id)!;
  storedParent.status = "ready";
  storedParent.structuredContent = structuredLesson;
  storedParent.processedAt = new Date();
  const split = await splitLesson(
    context.server,
    project.id,
    parent.id,
    cookie,
  );
  assert.equal(split.statusCode, 200);

  return {
    project,
    parent: storedParent,
    parts: split.json().parts as Record<"A" | "B", LanguageLesson>,
  };
}

async function updateLessonProgress(
  server: ReturnType<typeof createServer>,
  projectId: string,
  lessonId: string,
  cookie: string,
  payload: {
    learningStatus?: LanguageLessonLearningStatus;
    difficulty?: LanguageLessonDifficulty | null;
  },
) {
  return server.inject({
    method: "PATCH",
    url: `/languages/projects/${projectId}/lessons/${lessonId}/progress`,
    headers: { cookie },
    payload,
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

test("language lesson progress contracts are strict and support partial updates", () => {
  for (const value of ["pending", "in_progress", "completed"]) {
    assert.equal(languageLessonLearningStatusSchema.safeParse(value).success, true);
  }
  assert.equal(languageLessonLearningStatusSchema.safeParse("ready").success, false);

  for (const value of ["easy", "normal", "hard"]) {
    assert.equal(languageLessonDifficultySchema.safeParse(value).success, true);
    assert.equal(
      updateLanguageLessonProgressSchema.safeParse({ difficulty: value }).success,
      true,
    );
  }
  assert.equal(
    updateLanguageLessonProgressSchema.safeParse({ difficulty: null }).success,
    true,
  );
  assert.equal(
    updateLanguageLessonProgressSchema.safeParse({ difficulty: "extreme" }).success,
    false,
  );
  assert.equal(updateLanguageLessonProgressSchema.safeParse({}).success, false);
  assert.equal(
    updateLanguageLessonProgressSchema.safeParse({
      learningStatus: "pending",
      unexpected: true,
    }).success,
    false,
  );
});

test("lesson progress defaults and public summary are pending and unrated", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie);
    assert.equal(lesson.learningStatus, "pending");
    assert.equal(lesson.difficulty, null);

    const listing = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie },
    });
    assert.equal(listing.statusCode, 200);
    assert.equal(listing.json().lessons[0].learningStatus, "pending");
    assert.equal(listing.json().lessons[0].difficulty, null);

    const detail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${lesson.id}`,
      headers: { cookie },
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().lesson.learningStatus, "pending");
    assert.equal(detail.json().lesson.difficulty, null);
  } finally {
    await server.close();
  }
});

test("lesson progress endpoint requires auth, ownership and an existing lesson", async () => {
  const { server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const project = await createProject(server, ownerCookie);
    const lesson = await createLesson(server, project.id, ownerCookie);
    const url = `/languages/projects/${project.id}/lessons/${lesson.id}/progress`;

    const unauthenticated = await server.inject({
      method: "PATCH",
      url,
      payload: { learningStatus: "in_progress" },
    });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(unauthenticated.json().error, "UNAUTHORIZED");

    const forbidden = await updateLessonProgress(
      server,
      project.id,
      lesson.id,
      otherCookie,
      { learningStatus: "in_progress" },
    );
    assert.equal(forbidden.statusCode, 404);
    assert.equal(forbidden.json().error, "LANGUAGE_LESSON_NOT_FOUND");

    const missing = await updateLessonProgress(
      server,
      project.id,
      randomUUID(),
      ownerCookie,
      { learningStatus: "in_progress" },
    );
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, "LANGUAGE_LESSON_NOT_FOUND");
  } finally {
    await server.close();
  }
});

test("lesson progress updates either field or both without changing lesson content", async () => {
  const { store, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie, "assimil");
    await processAssimilLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      "Ich bin müde. Ich bin bereit. Bis morgen.",
    );
    const before = structuredClone(
      store.lessons.find(({ id }) => id === lesson.id),
    );
    assert.ok(before);

    const statusOnly = await updateLessonProgress(
      server,
      project.id,
      lesson.id,
      cookie,
      { learningStatus: "in_progress" },
    );
    assert.equal(statusOnly.statusCode, 200);
    assert.equal(statusOnly.json().lesson.learningStatus, "in_progress");
    assert.equal(statusOnly.json().lesson.difficulty, null);

    const difficultyOnly = await updateLessonProgress(
      server,
      project.id,
      lesson.id,
      cookie,
      { difficulty: "hard" },
    );
    assert.equal(difficultyOnly.statusCode, 200);
    assert.equal(difficultyOnly.json().lesson.difficulty, "hard");

    const both = await updateLessonProgress(
      server,
      project.id,
      lesson.id,
      cookie,
      { learningStatus: "completed", difficulty: "normal" },
    );
    assert.equal(both.statusCode, 200);
    assert.equal(both.json().lesson.learningStatus, "completed");
    assert.equal(both.json().lesson.difficulty, "normal");

    const stored = store.lessons.find(({ id }) => id === lesson.id);
    assert.ok(stored);
    assert.equal(stored.status, before.status);
    assert.equal(stored.sourceContent, before.sourceContent);
    assert.deepEqual(stored.structuredContent, before.structuredContent);
    assert.equal(stored.lessonSource, "assimil");
    assert.equal(stored.sourceLessonNumber, before.sourceLessonNumber);

    const invalid = await server.inject({
      method: "PATCH",
      url: `/languages/projects/${project.id}/lessons/${lesson.id}/progress`,
      headers: { cookie },
      payload: {},
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "INVALID_LANGUAGE_LESSON_PROGRESS");
  } finally {
    await server.close();
  }
});

test("free lesson preparation contract is strict and preserves source text", () => {
  const exactText = "  Primera línea.\n\nSegunda línea.  ";
  const valid = prepareFreeLanguageLessonSchema.parse({
    title: "  Am Bahnhof  ",
    sourceContent: exactText,
  });

  assert.equal(LANGUAGE_FREE_LESSON_TITLE_MAX_LENGTH, 160);
  assert.equal(valid.title, "Am Bahnhof");
  assert.equal(valid.sourceContent, exactText);
  assert.equal(
    prepareFreeLanguageLessonSchema.safeParse({
      title: " ",
      sourceContent: "Texto",
    }).success,
    false,
  );
  assert.equal(
    prepareFreeLanguageLessonSchema.safeParse({
      title: "a".repeat(161),
      sourceContent: "Texto",
    }).success,
    false,
  );
  assert.equal(
    prepareFreeLanguageLessonSchema.safeParse({
      title: "Título",
      sourceContent: " \n ",
    }).success,
    false,
  );
  assert.equal(
    prepareFreeLanguageLessonSchema.safeParse({
      title: "Título",
      sourceContent: "a".repeat(100_001),
    }).success,
    false,
  );
  assert.equal(
    prepareFreeLanguageLessonSchema.safeParse({
      title: "Título",
      sourceContent: "Texto",
      provider: "elevenlabs",
    }).success,
    false,
  );
});

test("free lesson preparation requires auth, ownership and a free lesson", async () => {
  const { server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const project = await createProject(server, ownerCookie);
    const freeLesson = await createLesson(server, project.id, ownerCookie, "free");
    const frameworkLesson = await createLesson(
      server,
      project.id,
      ownerCookie,
      "language_framework",
    );

    const unauthenticated = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons/${freeLesson.id}/free/prepare`,
      payload: { title: "Título", sourceContent: "Texto" },
    });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(unauthenticated.json().error, "UNAUTHORIZED");

    const forbidden = await prepareFreeLesson(
      server,
      project.id,
      freeLesson.id,
      otherCookie,
    );
    assert.equal(forbidden.statusCode, 404);
    assert.equal(forbidden.json().error, "LANGUAGE_LESSON_NOT_FOUND");

    const missing = await prepareFreeLesson(
      server,
      project.id,
      randomUUID(),
      ownerCookie,
    );
    assert.equal(missing.statusCode, 404);

    const wrongSource = await prepareFreeLesson(
      server,
      project.id,
      frameworkLesson.id,
      ownerCookie,
    );
    assert.equal(wrongSource.statusCode, 409);
    assert.equal(wrongSource.json().error, "LANGUAGE_LESSON_NOT_FREE");
  } finally {
    await server.close();
  }
});

test("preparing a free lesson stores exact text and becomes ready without OpenAI", async () => {
  const { processor, server, store } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const exactText = "  Ich warte am Bahnhof.\n\nDer Zug kommt gleich.  ";

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie, "free");
    const response = await prepareFreeLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      { title: "  Am Bahnhof  ", sourceContent: exactText },
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().lesson.freeTitle, "Am Bahnhof");
    assert.equal(response.json().lesson.sourceContent, exactText);
    assert.equal(response.json().lesson.status, "ready");
    assert.equal(response.json().lesson.structuredContent, null);
    assert.equal(response.json().lesson.simplifiedStructuredContent, null);
    assert.ok(response.json().lesson.processedAt);
    assert.equal(processor.calls.length, 0);

    const stored = store.lessons.find(({ id }) => id === lesson.id);
    assert.ok(stored);
    assert.equal(stored.sourceContent, exactText);
    assert.equal(stored.structuredContent, null);

    const duplicate = await prepareFreeLesson(
      server,
      project.id,
      lesson.id,
      cookie,
    );
    assert.equal(duplicate.statusCode, 409);
    assert.equal(
      duplicate.json().error,
      "LANGUAGE_FREE_LESSON_NOT_EDITABLE",
    );
  } finally {
    await server.close();
  }
});

test("new and legacy free lessons keep distinct public representations", async () => {
  const { store, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const prepared = await createLesson(server, project.id, cookie, "free");
    const legacy = await createLesson(server, project.id, cookie, "free");
    const framework = await createLesson(
      server,
      project.id,
      cookie,
      "language_framework",
    );
    const assimil = await createLesson(
      server,
      project.id,
      cookie,
      "assimil",
    );
    await prepareFreeLesson(server, project.id, prepared.id, cookie);
    await processLesson(server, project.id, framework.id, cookie, "Framework source");
    for (const legacyLessonId of [legacy.id, assimil.id]) {
      const storedLegacy = store.lessons.find(({ id }) => id === legacyLessonId);
      assert.ok(storedLegacy);
      storedLegacy.sourceContent = "Historical structured source";
      storedLegacy.status = "ready";
      storedLegacy.structuredContent = structuredLesson;
      storedLegacy.processedAt = new Date();
    }

    const preparedDetail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${prepared.id}`,
      headers: { cookie },
    });
    const legacyDetail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${legacy.id}`,
      headers: { cookie },
    });
    const frameworkDetail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${framework.id}`,
      headers: { cookie },
    });
    const assimilDetail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${assimil.id}`,
      headers: { cookie },
    });
    const listing = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie },
    });

    assert.equal(preparedDetail.json().lesson.freeTitle, "Am Bahnhof");
    assert.equal(preparedDetail.json().lesson.freeAnalysis, null);
    assert.equal(preparedDetail.json().lesson.splitParentLessonId, null);
    assert.equal(preparedDetail.json().lesson.splitPart, null);
    assert.match(preparedDetail.json().lesson.sourceContent, /Bahnhof/);
    assert.equal(preparedDetail.json().lesson.structuredContent, null);
    assert.equal(legacyDetail.json().lesson.freeTitle, null);
    assert.equal(legacyDetail.json().lesson.freeAnalysis, null);
    assert.equal(legacyDetail.json().lesson.splitParentLessonId, null);
    assert.equal(legacyDetail.json().lesson.splitPart, null);
    assert.deepEqual(legacyDetail.json().lesson.structuredContent, structuredLesson);
    assert.equal(frameworkDetail.json().lesson.freeTitle, null);
    assert.equal(frameworkDetail.json().lesson.freeAnalysis, null);
    assert.equal(frameworkDetail.json().lesson.splitParentLessonId, null);
    assert.equal(frameworkDetail.json().lesson.splitPart, null);
    assert.deepEqual(
      frameworkDetail.json().lesson.structuredContent,
      structuredLesson,
    );
    assert.equal(assimilDetail.json().lesson.freeTitle, null);
    assert.equal(assimilDetail.json().lesson.freeAnalysis, null);
    assert.equal(assimilDetail.json().lesson.splitParentLessonId, null);
    assert.equal(assimilDetail.json().lesson.splitPart, null);
    assert.deepEqual(
      assimilDetail.json().lesson.structuredContent,
      structuredLesson,
    );
    assert.equal(listing.json().lessons[0].freeTitle, "Am Bahnhof");
    assert.equal(listing.json().lessons[1].freeTitle, null);
    for (const lesson of listing.json().lessons) {
      assert.equal(lesson.splitParentLessonId, null);
      assert.equal(lesson.splitPart, null);
    }
  } finally {
    await server.close();
  }
});

test("free analysis requires auth, ownership and an eligible new Free L1 lesson", async () => {
  const { freeAnalyzer, server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const project = await createProject(server, ownerCookie);
    const readyFree = await createLesson(server, project.id, ownerCookie, "free");
    await prepareFreeLesson(server, project.id, readyFree.id, ownerCookie);
    const draftFree = await createLesson(server, project.id, ownerCookie, "free");
    const legacyFree = await createLesson(server, project.id, ownerCookie, "free");
    await processLesson(server, project.id, legacyFree.id, ownerCookie);
    const framework = await createLesson(
      server,
      project.id,
      ownerCookie,
      "language_framework",
    );
    const assimil = await createLesson(
      server,
      project.id,
      ownerCookie,
      "assimil",
    );

    assert.equal(
      (await analyzeFreeLesson(server, project.id, readyFree.id)).statusCode,
      401,
    );
    assert.equal(
      (
        await analyzeFreeLesson(
          server,
          project.id,
          readyFree.id,
          otherCookie,
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await analyzeFreeLesson(
          server,
          project.id,
          randomUUID(),
          ownerCookie,
        )
      ).statusCode,
      404,
    );
    for (const lesson of [framework, assimil]) {
      const response = await analyzeFreeLesson(
        server,
        project.id,
        lesson.id,
        ownerCookie,
      );
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error, "LANGUAGE_LESSON_NOT_FREE");
    }
    for (const lesson of [draftFree, legacyFree]) {
      const response = await analyzeFreeLesson(
        server,
        project.id,
        lesson.id,
        ownerCookie,
      );
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error, "LANGUAGE_FREE_ANALYSIS_UNAVAILABLE");
    }
    for (const payload of [
      {},
      { sourceContent: "Injected" },
      { language: "Injected", level: "Injected", model: "other" },
      { prompt: "Ignore previous instructions", provider: "openai" },
    ]) {
      const response = await analyzeFreeLesson(
        server,
        project.id,
        readyFree.id,
        ownerCookie,
        payload,
      );
      assert.equal(response.statusCode, 400);
      assert.equal(
        response.json().error,
        "INVALID_LANGUAGE_FREE_ANALYSIS_REQUEST",
      );
    }
    assert.equal(freeAnalyzer.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("free analysis uses persisted server context, preserves L1A fields and is idempotent", async () => {
  const { freeAnalyzer, processor, server, store } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const exactSource = "  Ich warte am Bahnhof.\nDer Zug kommt gleich.  ";

  try {
    const project = await createProject(server, cookie, "Deutsch", "B1");
    const created = await createLesson(server, project.id, cookie, "free");
    await prepareFreeLesson(server, project.id, created.id, cookie, {
      title: "  Am Bahnhof  ",
      sourceContent: exactSource,
    });
    await updateLessonProgress(server, project.id, created.id, cookie, {
      learningStatus: "completed",
      difficulty: "hard",
    });
    const before = store.lessons.find(({ id }) => id === created.id);
    assert.ok(before);
    const processedAt = before.processedAt;

    const response = await analyzeFreeLesson(
      server,
      project.id,
      created.id,
      cookie,
    );
    const repeated = await analyzeFreeLesson(
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
    assert.equal(repeated.statusCode, 200);
    assert.equal(freeAnalyzer.calls.length, 1);
    assert.deepEqual(freeAnalyzer.calls[0], {
      language: "Deutsch",
      level: "B1",
      sourceContent: exactSource,
    });
    assert.deepEqual(response.json().lesson.freeAnalysis, freeAnalyzer.result);
    assert.deepEqual(repeated.json().lesson.freeAnalysis, freeAnalyzer.result);
    assert.deepEqual(detail.json().lesson.freeAnalysis, freeAnalyzer.result);
    assert.equal(processor.calls.length, 0);

    const after = store.lessons.find(({ id }) => id === created.id);
    assert.ok(after);
    assert.equal(after.freeTitle, "Am Bahnhof");
    assert.equal(after.sourceContent, exactSource);
    assert.equal(after.structuredContent, null);
    assert.equal(after.status, "ready");
    assert.equal(after.learningStatus, "completed");
    assert.equal(after.difficulty, "hard");
    assert.equal(after.processedAt, processedAt);
  } finally {
    await server.close();
  }
});

test("free analysis failure leaves the ready lesson usable and retryable", async () => {
  const { freeAnalyzer, server, store } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(server, project.id, cookie, "free");
    await prepareFreeLesson(server, project.id, lesson.id, cookie);
    freeAnalyzer.error = new Error("Provider unavailable");

    const response = await analyzeFreeLesson(
      server,
      project.id,
      lesson.id,
      cookie,
    );

    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error, "LANGUAGE_FREE_ANALYSIS_FAILED");
    const stored = store.lessons.find(({ id }) => id === lesson.id);
    assert.ok(stored);
    assert.equal(stored.status, "ready");
    assert.equal(stored.freeAnalysis, null);
    assert.match(stored.sourceContent, /Bahnhof/);
  } finally {
    await server.close();
  }
});

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
      assert.equal(created.learningStatus, "pending");
      assert.equal(created.difficulty, null);

      const detail = await server.inject({
        method: "GET",
        url: `/languages/projects/${project.id}/lessons/${created.id}`,
        headers: { cookie },
      });

      assert.equal(detail.statusCode, 200);
      assert.equal(detail.json().lesson.lessonSource, lessonSource);
      assert.equal(detail.json().lesson.sourceLessonNumber, 1);
    }

    const compatibleCreationResponse = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie },
    });
    assert.equal(compatibleCreationResponse.statusCode, 201);
    const compatibleCreation = compatibleCreationResponse.json().lesson;
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
    let assimilNumber = 0;

    for (const lessonSource of lessonSources) {
      if (lessonSource === "assimil") assimilNumber += 1;
      created.push(
        await createLesson(
          server,
          project.id,
          cookie,
          lessonSource,
          lessonSource === "assimil" ? assimilNumber : 1,
        ),
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

test("Assimil creation requires a unique manual real number and preserves technical order", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const invalidPayloads = [
      { lessonSource: "assimil" },
      { lessonSource: "assimil", sourceLessonNumber: 0 },
      { lessonSource: "assimil", sourceLessonNumber: 10_000 },
      { lessonSource: "assimil", sourceLessonNumber: 1.5 },
      { lessonSource: "assimil", sourceLessonNumber: "15" },
      { lessonSource: "language_framework", sourceLessonNumber: 15 },
      { lessonSource: "free", sourceLessonNumber: 15 },
    ];

    for (const payload of invalidPayloads) {
      const response = await server.inject({
        method: "POST",
        url: `/languages/projects/${project.id}/lessons`,
        headers: { cookie },
        payload,
      });
      assert.equal(response.statusCode, 400);
    }

    const assimil15 = await createLesson(
      server,
      project.id,
      cookie,
      "assimil",
      15,
    );
    const framework = await createLesson(
      server,
      project.id,
      cookie,
      "language_framework",
    );
    const assimil16 = await createLesson(
      server,
      project.id,
      cookie,
      "assimil",
      16,
    );
    const free = await createLesson(server, project.id, cookie, "free");

    assert.deepEqual(
      [assimil15, framework, assimil16, free].map(
        ({ lessonNumber, sourceLessonNumber }) => ({
          lessonNumber,
          sourceLessonNumber,
        }),
      ),
      [
        { lessonNumber: 1, sourceLessonNumber: 15 },
        { lessonNumber: 2, sourceLessonNumber: 1 },
        { lessonNumber: 3, sourceLessonNumber: 16 },
        { lessonNumber: 4, sourceLessonNumber: 1 },
      ],
    );

    const duplicate = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie },
      payload: { lessonSource: "assimil", sourceLessonNumber: 15 },
    });
    assert.equal(duplicate.statusCode, 409);
    assert.deepEqual(duplicate.json(), {
      error: "LANGUAGE_ASSIMIL_LESSON_NUMBER_EXISTS",
      message: "Ya existe la lección Assimil 15 en este idioma.",
    });

    const otherProject = await createProject(server, cookie, "Francés", "A1");
    const sameNumberElsewhere = await createLesson(
      server,
      otherProject.id,
      cookie,
      "assimil",
      15,
    );
    assert.equal(sameNumberElsewhere.sourceLessonNumber, 15);
  } finally {
    await server.close();
  }
});

test("Assimil endpoint uses server context, stores exact source and returns the independent public contract", async () => {
  const { assimilProcessor, processor, server, store } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const exactSource = "  Ich bin müde. Ich bin bereit. Bis morgen.  \n";

  try {
    const project = await createProject(server, cookie, "Alemán", "A1");
    const lesson = await createLesson(
      server,
      project.id,
      cookie,
      "assimil",
      15,
    );
    const storedBefore = store.lessons.find(({ id }) => id === lesson.id);
    assert.ok(storedBefore);
    storedBefore.learningStatus = "in_progress";
    storedBefore.difficulty = "hard";

    const response = await processAssimilLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      exactSource,
    );
    assert.equal(response.statusCode, 200);
    assert.equal(processor.calls.length, 0);
    assert.deepEqual(assimilProcessor.calls, [
      {
        language: "Alemán",
        level: "A1",
        sourceLessonNumber: 15,
        sourceContent: exactSource,
      },
    ]);

    const publicLesson = response.json().lesson;
    assert.equal(publicLesson.sourceContent, exactSource);
    assert.equal(publicLesson.structuredContent, null);
    assert.deepEqual(publicLesson.assimilContent, assimilLesson);
    assert.equal(publicLesson.assimilPhase, "impregnation");
    assert.equal(publicLesson.assimilReviewLesson, false);
    assert.equal(publicLesson.learningStatus, "in_progress");
    assert.equal(publicLesson.difficulty, "hard");

    const stored = store.lessons.find(({ id }) => id === lesson.id);
    assert.ok(stored);
    assert.equal(stored.status, "ready");
    assert.equal(stored.sourceContent, exactSource);
    assert.deepEqual(stored.structuredContent, assimilLesson);
    assert.ok(stored.processedAt);

    const reloaded = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${lesson.id}`,
      headers: { cookie },
    });
    assert.deepEqual(reloaded.json().lesson.assimilContent, assimilLesson);
    assert.equal(reloaded.json().lesson.sourceContent, exactSource);

    const readyRetry = await processAssimilLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      exactSource,
    );
    assert.equal(readyRetry.statusCode, 409);
    assert.equal(readyRetry.json().error, "LANGUAGE_LESSON_ALREADY_PROCESSED");
    assert.equal(assimilProcessor.calls.length, 1);

    assimilProcessor.result = {
      ...assimilLesson,
      review: { points: ["Repasar sein", "Repasar saludos"] },
    };
    const reviewLesson = await createLesson(
      server,
      project.id,
      cookie,
      "assimil",
      14,
    );
    const reviewResponse = await processAssimilLesson(
      server,
      project.id,
      reviewLesson.id,
      cookie,
    );
    assert.equal(reviewResponse.statusCode, 200);
    assert.equal(reviewResponse.json().lesson.assimilReviewLesson, true);
    assert.equal(reviewResponse.json().lesson.assimilPhase, "impregnation");
  } finally {
    await server.close();
  }
});

test("Assimil processing validates auth, ownership, strict input and eligibility before OpenAI", async () => {
  const { assimilProcessor, server, store } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const project = await createProject(server, ownerCookie);
    const assimil = await createLesson(
      server,
      project.id,
      ownerCookie,
      "assimil",
      7,
    );
    const framework = await createLesson(
      server,
      project.id,
      ownerCookie,
      "language_framework",
    );
    const free = await createLesson(server, project.id, ownerCookie, "free");

    const requests = [
      await server.inject({
        method: "POST",
        url: `/languages/projects/${project.id}/lessons/${assimil.id}/assimil/process`,
        payload: { sourceContent: "Guten Morgen. Ich bin müde. Bis morgen." },
      }),
      await server.inject({
        method: "POST",
        url: `/languages/projects/${project.id}/lessons/${assimil.id}/assimil/process`,
        headers: { cookie: otherCookie },
        payload: { sourceContent: "Guten Morgen. Ich bin müde. Bis morgen." },
      }),
      await processAssimilLesson(
        server,
        project.id,
        randomUUID(),
        ownerCookie,
        "Guten Morgen. Ich bin müde. Bis morgen.",
      ),
      await server.inject({
        method: "POST",
        url: `/languages/projects/${project.id}/lessons/${assimil.id}/assimil/process`,
        headers: { cookie: ownerCookie },
        payload: {
          sourceContent: "Guten Morgen. Ich bin müde. Bis morgen.",
          extra: true,
        },
      }),
      await processAssimilLesson(
        server,
        project.id,
        framework.id,
        ownerCookie,
        "Guten Morgen. Ich bin müde. Bis morgen.",
      ),
      await processAssimilLesson(
        server,
        project.id,
        free.id,
        ownerCookie,
        "Guten Morgen. Ich bin müde. Bis morgen.",
      ),
    ];

    assert.deepEqual(
      requests.map(({ statusCode }) => statusCode),
      [401, 404, 404, 400, 409, 409],
    );
    assert.equal(assimilProcessor.calls.length, 0);

    const storedAssimil = store.lessons.find(({ id }) => id === assimil.id);
    assert.ok(storedAssimil);
    storedAssimil.splitParentLessonId = randomUUID();
    storedAssimil.splitPart = "A";
    assert.equal(
      (
        await processAssimilLesson(
          server,
          project.id,
          assimil.id,
          ownerCookie,
          "Guten Morgen. Ich bin müde. Bis morgen.",
        )
      ).statusCode,
      409,
    );
    storedAssimil.splitParentLessonId = null;
    storedAssimil.splitPart = null;
    storedAssimil.status = "processing";
    assert.equal(
      (
        await processAssimilLesson(
          server,
          project.id,
          assimil.id,
          ownerCookie,
          "Guten Morgen. Ich bin müde. Bis morgen.",
        )
      ).json().error,
      "LANGUAGE_LESSON_PROCESSING",
    );
  } finally {
    await server.close();
  }
});

test("Assimil processing failure keeps exact source and progress and remains retryable", async () => {
  const { assimilProcessor, server, store } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const exactSource = "\nGuten Morgen. Ich bin müde. Ich bin bereit. Bis morgen.\n";

  try {
    const project = await createProject(server, cookie);
    const lesson = await createLesson(
      server,
      project.id,
      cookie,
      "assimil",
      51,
    );
    const stored = store.lessons.find(({ id }) => id === lesson.id);
    assert.ok(stored);
    stored.learningStatus = "completed";
    stored.difficulty = "normal";
    assimilProcessor.error = new LanguageLessonProcessingError("provider_error");

    const failed = await processAssimilLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      exactSource,
    );
    assert.equal(failed.statusCode, 502);
    assert.equal(stored.status, "failed");
    assert.equal(stored.sourceContent, exactSource);
    assert.equal(stored.structuredContent, null);
    assert.equal(stored.processedAt, null);
    assert.equal(stored.learningStatus, "completed");
    assert.equal(stored.difficulty, "normal");

    assimilProcessor.error = null;
    const retried = await processAssimilLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      exactSource,
    );
    assert.equal(retried.statusCode, 200);
    assert.equal(stored.status, "ready");
    assert.equal(assimilProcessor.calls.length, 2);
  } finally {
    await server.close();
  }
});

test("generic processing is Framework-only and never calls its processor for Assimil or Free", async () => {
  const { processor, server, store } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const assimil = await createLesson(
      server,
      project.id,
      cookie,
      "assimil",
      15,
    );
    const free = await createLesson(server, project.id, cookie, "free");
    const framework = await createLesson(
      server,
      project.id,
      cookie,
      "language_framework",
    );

    for (const lesson of [assimil, free]) {
      const response = await processLesson(
        server,
        project.id,
        lesson.id,
        cookie,
        "Do not persist this source",
      );
      assert.equal(response.statusCode, 409);
      assert.equal(
        response.json().error,
        "LANGUAGE_LESSON_PROCESSING_UNAVAILABLE",
      );
      assert.equal(
        store.lessons.find(({ id }) => id === lesson.id)?.sourceContent,
        "",
      );
    }
    assert.equal(processor.calls.length, 0);

    assert.equal(
      (
        await processLesson(
          server,
          project.id,
          framework.id,
          cookie,
          "Guten Morgen. Ich bin müde. Bis morgen.",
        )
      ).statusCode,
      200,
    );
    assert.equal(processor.calls.length, 1);
  } finally {
    await server.close();
  }
});

test("new Assimil v1 rejects general simplification and audio while legacy Assimil audio stays compatible", async () => {
  const { processor, audioProvider, server, store } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const current = await createLesson(
      server,
      project.id,
      cookie,
      "assimil",
      15,
    );
    assert.equal(
      (
        await processAssimilLesson(
          server,
          project.id,
          current.id,
          cookie,
        )
      ).statusCode,
      200,
    );

    const simplification = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons/${current.id}/simplify`,
      headers: { cookie },
      payload: {},
    });
    assert.equal(simplification.statusCode, 409);
    assert.equal(
      simplification.json().error,
      "LANGUAGE_LESSON_SIMPLIFICATION_UNAVAILABLE",
    );
    assert.equal(processor.simplificationCalls.length, 0);

    const currentAudio = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons/${current.id}/audio`,
      headers: { cookie },
      payload: { version: "original", section: "vocabulary", index: 0 },
    });
    assert.equal(currentAudio.statusCode, 409);
    assert.deepEqual(currentAudio.json(), {
      error: "LANGUAGE_ASSIMIL_AUDIO_UNAVAILABLE",
      message: "El audio de esta lección Assimil todavía no está disponible.",
    });
    assert.equal(audioProvider.calls.length, 0);

    const legacy = await createLesson(
      server,
      project.id,
      cookie,
      "assimil",
      16,
    );
    const storedLegacy = store.lessons.find(({ id }) => id === legacy.id);
    assert.ok(storedLegacy);
    storedLegacy.status = "ready";
    storedLegacy.structuredContent = structuredLesson;
    storedLegacy.processedAt = new Date();

    const legacyAudio = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons/${legacy.id}/audio`,
      headers: { cookie },
      payload: { version: "original", section: "vocabulary", index: 0 },
    });
    assert.equal(legacyAudio.statusCode, 200);
    assert.equal(audioProvider.calls.length, 1);
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

test("lesson split requires authentication, ownership, an existing parent and no browser body", async () => {
  const { splitter, server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const project = await createProject(server, ownerCookie, "Alemán", "A1");
    const lesson = await createLesson(
      server,
      project.id,
      ownerCookie,
      "language_framework",
    );
    await processLesson(server, project.id, lesson.id, ownerCookie);

    assert.equal(
      (await splitLesson(server, project.id, lesson.id)).statusCode,
      401,
    );
    assert.equal(
      (await splitLesson(server, project.id, lesson.id, otherCookie)).statusCode,
      404,
    );
    assert.equal(
      (
        await splitLesson(
          server,
          project.id,
          "11000000-0000-4000-8000-000000000001",
          ownerCookie,
        )
      ).statusCode,
      404,
    );

    const injected = await splitLesson(
      server,
      project.id,
      lesson.id,
      ownerCookie,
      {
        language: "Japanese",
        level: "A1",
        structuredContent: regeneratedLesson,
        splitPart: "B",
      },
    );
    assert.equal(injected.statusCode, 400);
    assert.equal(injected.json().error, "INVALID_LANGUAGE_LESSON_SPLIT_REQUEST");
    assert.equal(splitter.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("lesson split accepts only ready A1 framework roots", async () => {
  const { store, splitter, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const a1 = await createProject(server, cookie, "Alemán", "A1 Beginner");
    const free = await createLesson(server, a1.id, cookie, "free");
    const assimil = await createLesson(server, a1.id, cookie, "assimil");
    const draft = await createLesson(server, a1.id, cookie, "language_framework");
    const child = await createLesson(server, a1.id, cookie, "language_framework");
    await processLesson(server, a1.id, free.id, cookie);
    await processLesson(server, a1.id, assimil.id, cookie);
    await processLesson(server, a1.id, child.id, cookie);

    for (const lesson of [free, assimil, draft]) {
      const response = await splitLesson(server, a1.id, lesson.id, cookie);
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error, "LANGUAGE_LESSON_SPLIT_UNAVAILABLE");
    }

    const storedChild = store.lessons.find(({ id }) => id === child.id);
    assert.ok(storedChild);
    storedChild.splitParentLessonId = randomUUID();
    storedChild.splitPart = "A";
    assert.equal(
      (await splitLesson(server, a1.id, child.id, cookie)).statusCode,
      409,
    );
    storedChild.splitPart = "B";
    assert.equal(
      (await splitLesson(server, a1.id, child.id, cookie)).statusCode,
      409,
    );

    const a2 = await createProject(server, cookie, "Alemán", "A2");
    const a2Lesson = await createLesson(
      server,
      a2.id,
      cookie,
      "language_framework",
    );
    await processLesson(server, a2.id, a2Lesson.id, cookie);
    assert.equal(
      (await splitLesson(server, a2.id, a2Lesson.id, cookie)).statusCode,
      409,
    );

    for (const status of ["processing", "failed"] as const) {
      const statusProject = await createProject(server, cookie, "Alemán", "A1");
      const statusLesson = await createLesson(
        server,
        statusProject.id,
        cookie,
        "language_framework",
      );
      const stored = store.lessons.find(({ id }) => id === statusLesson.id);
      assert.ok(stored);
      stored.status = status;
      stored.structuredContent = structuredLesson;
      assert.equal(
        (
          await splitLesson(
            server,
            statusProject.id,
            statusLesson.id,
            cookie,
          )
        ).statusCode,
        409,
      );
    }

    assert.equal(splitter.calls.length, 0);
  } finally {
    await server.close();
  }
});

test("A1 framework split uses server data once and persists two ready technical lessons", async () => {
  const { store, splitter, server } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const sourceContent = "Contenido privado del Marco A1";

  try {
    const project = await createProject(server, cookie, "Alemán", "a1 inicial");
    const parent = await createLesson(
      server,
      project.id,
      cookie,
      "language_framework",
    );
    await processLesson(
      server,
      project.id,
      parent.id,
      cookie,
      sourceContent,
    );
    await createLesson(server, project.id, cookie, "free");
    const storedParent = store.lessons.find(({ id }) => id === parent.id);
    assert.ok(storedParent);
    storedParent.simplifiedStructuredContent = simplifiedLesson;
    storedParent.simplificationStartedAt = null;
    storedParent.simplifiedAt = new Date("2026-08-20T12:00:00.000Z");
    storedParent.learningStatus = "in_progress";
    storedParent.difficulty = "hard";
    const parentBefore = structuredClone(storedParent);

    const response = await splitLesson(
      server,
      project.id,
      parent.id,
      cookie,
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(splitter.calls, [
      {
        language: "Alemán",
        level: "a1 inicial",
        structuredContent: structuredLesson,
      },
    ]);
    const parts = response.json().parts as Record<"A" | "B", LanguageLesson>;
    assert.equal(response.json().parent.id, parent.id);
    assert.deepEqual(
      [parts.A.splitPart, parts.B.splitPart],
      ["A", "B"],
    );
    assert.deepEqual(
      [parts.A.lessonNumber, parts.B.lessonNumber],
      [3, 4],
    );
    assert.ok(Number.isInteger(parts.A.lessonNumber));
    assert.ok(Number.isInteger(parts.B.lessonNumber));
    for (const part of [parts.A, parts.B]) {
      assert.equal(part.lessonSource, "language_framework");
      assert.equal(part.sourceLessonNumber, parent.sourceLessonNumber);
      assert.equal(part.splitParentLessonId, parent.id);
      assert.equal(part.status, "ready");
      assert.equal(part.learningStatus, "pending");
      assert.equal(part.difficulty, null);
      assert.equal(part.simplifiedStructuredContent, null);
      assert.equal(part.simplifiedAt, null);
    }
    const storedParts = store.lessons.filter(
      ({ splitParentLessonId }) => splitParentLessonId === parent.id,
    );
    assert.equal(storedParts.length, 2);
    assert.deepEqual(
      storedParts.map(({ sourceContent }) => sourceContent),
      ["", ""],
    );
    assert.deepEqual(
      storedParts.map(({ freeTitle, freeAnalysis }) => ({
        freeTitle,
        freeAnalysis,
      })),
      [
        { freeTitle: null, freeAnalysis: null },
        { freeTitle: null, freeAnalysis: null },
      ],
    );
    assert.deepEqual(
      store.lessons.find(({ id }) => id === parent.id),
      parentBefore,
    );
  } finally {
    await server.close();
  }
});

test("a completed split is idempotent and never invokes OpenAI again", async () => {
  const { splitter, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie, "Alemán", "A1");
    const parent = await createLesson(
      server,
      project.id,
      cookie,
      "language_framework",
    );
    await processLesson(server, project.id, parent.id, cookie);
    const first = await splitLesson(server, project.id, parent.id, cookie);
    const second = await splitLesson(server, project.id, parent.id, cookie);

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(splitter.calls.length, 1);
    assert.deepEqual(
      {
        A: second.json().parts.A.id,
        B: second.json().parts.B.id,
      },
      {
        A: first.json().parts.A.id,
        B: first.json().parts.B.id,
      },
    );
  } finally {
    await server.close();
  }
});

test("a lone A or B child reports an invariant conflict without repair or OpenAI", async () => {
  for (const splitPart of ["A", "B"] as const) {
    const { store, splitter, server } = testServer();
    const cookie = sessionCookie(firstUser.id);

    try {
      const project = await createProject(server, cookie, "Alemán", "A1");
      const parent = await createLesson(
        server,
        project.id,
        cookie,
        "language_framework",
      );
      await processLesson(server, project.id, parent.id, cookie);
      const storedParent = store.lessons.find(({ id }) => id === parent.id);
      assert.ok(storedParent);
      const now = new Date();
      store.lessons.push({
        ...structuredClone(storedParent),
        id: randomUUID(),
        lessonNumber: 2,
        splitParentLessonId: parent.id,
        splitPart,
        sourceContent: "",
        learningStatus: "pending",
        difficulty: null,
        simplifiedStructuredContent: null,
        simplificationStartedAt: null,
        simplifiedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const response = await splitLesson(
        server,
        project.id,
        parent.id,
        cookie,
      );
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error, "LANGUAGE_LESSON_SPLIT_INCONSISTENT");
      assert.equal(splitter.calls.length, 0);
      assert.equal(
        store.lessons.filter(
          ({ splitParentLessonId }) => splitParentLessonId === parent.id,
        ).length,
        1,
      );
    } finally {
      await server.close();
    }
  }
});

test("part B insertion failure rolls back part A and preserves the parent", async () => {
  const store = new MemoryLanguageStore();
  store.failSplitAfterPartA = true;
  const { splitter, server } = testServer(store);
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie, "Alemán", "A1");
    const parent = await createLesson(
      server,
      project.id,
      cookie,
      "language_framework",
    );
    await processLesson(server, project.id, parent.id, cookie);
    const parentBefore = structuredClone(
      store.lessons.find(({ id }) => id === parent.id),
    );
    const response = await splitLesson(
      server,
      project.id,
      parent.id,
      cookie,
    );

    assert.equal(response.statusCode, 502);
    assert.equal(response.json().error, "LANGUAGE_LESSON_SPLIT_FAILED");
    assert.equal(splitter.calls.length, 1);
    assert.equal(
      store.lessons.filter(
        ({ splitParentLessonId }) => splitParentLessonId === parent.id,
      ).length,
      0,
    );
    assert.deepEqual(
      store.lessons.find(({ id }) => id === parent.id),
      parentBefore,
    );
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

test("split children cannot be deleted directly and parent deletion cascades in one request", async () => {
  const { store, server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const project = await createProject(
      server,
      ownerCookie,
      "Alemán",
      "A1 Beginner",
    );
    const parent = await createLesson(
      server,
      project.id,
      ownerCookie,
      "language_framework",
    );
    await processLesson(server, project.id, parent.id, ownerCookie);
    const split = await splitLesson(
      server,
      project.id,
      parent.id,
      ownerCookie,
    );
    assert.equal(split.statusCode, 200);
    const parts = split.json().parts as Record<"A" | "B", LanguageLesson>;

    const unauthenticated = await server.inject({
      method: "DELETE",
      url: `/languages/projects/${project.id}/lessons/${parts.A.id}`,
    });
    const wrongOwner = await server.inject({
      method: "DELETE",
      url: `/languages/projects/${project.id}/lessons/${parts.A.id}`,
      headers: { cookie: otherCookie },
    });
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(wrongOwner.statusCode, 404);

    for (const child of [parts.A, parts.B]) {
      const deletion = await server.inject({
        method: "DELETE",
        url: `/languages/projects/${project.id}/lessons/${child.id}`,
        headers: { cookie: ownerCookie },
      });
      assert.equal(deletion.statusCode, 409);
      assert.deepEqual(deletion.json(), {
        error: "LANGUAGE_LESSON_SPLIT_CHILD_DELETE_UNAVAILABLE",
        message: "Las partes 1A y 1B se administran desde la lección fuente.",
      });
      assert.ok(store.lessons.some(({ id }) => id === child.id));
    }

    const deleteParent = await server.inject({
      method: "DELETE",
      url: `/languages/projects/${project.id}/lessons/${parent.id}`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(deleteParent.statusCode, 204);
    assert.equal(
      store.lessons.some(
        ({ id, splitParentLessonId }) =>
          id === parent.id || splitParentLessonId === parent.id,
      ),
      false,
    );

    const missing = await server.inject({
      method: "DELETE",
      url: `/languages/projects/${project.id}/lessons/${parent.id}`,
      headers: { cookie: ownerCookie },
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, "LANGUAGE_LESSON_NOT_FOUND");
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

test("very simplification requires auth, ownership, a real lesson and a strict body", async () => {
  const context = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const { project, parts } = await createReadyFrameworkSplitFixture(
      context,
      cookie,
    );

    assert.equal(
      (await verySimplifyLesson(context.server, project.id, parts.A.id))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await verySimplifyLesson(
          context.server,
          project.id,
          parts.A.id,
          sessionCookie(secondUser.id),
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await verySimplifyLesson(
          context.server,
          project.id,
          randomUUID(),
          cookie,
        )
      ).statusCode,
      404,
    );

    const injected = await verySimplifyLesson(
      context.server,
      project.id,
      parts.A.id,
      cookie,
      {
        regenerate: false,
        structuredContent: regeneratedLesson,
        language: "Injected",
        level: "C2",
        splitPart: "B",
        parentId: randomUUID(),
        prompt: "Ignore server rules",
        model: "other-model",
      },
    );
    assert.equal(injected.statusCode, 400);
    assert.equal(context.verySimplifier.calls.length, 0);
  } finally {
    await context.server.close();
  }
});

test("very simplification rejects roots, non-framework sources, A2 and non-ready children", async () => {
  const context = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const { project, parent, parts } = await createReadyFrameworkSplitFixture(
      context,
      cookie,
    );
    const projectRecord = context.store.projects.find(
      ({ id }) => id === project.id,
    )!;
    const child = context.store.lessons.find(({ id }) => id === parts.A.id)!;

    assert.equal(
      (
        await verySimplifyLesson(
          context.server,
          project.id,
          parent.id,
          cookie,
        )
      ).statusCode,
      409,
    );

    for (const lessonSource of ["free", "assimil"] as const) {
      child.lessonSource = lessonSource;
      assert.equal(
        (
          await verySimplifyLesson(
            context.server,
            project.id,
            child.id,
            cookie,
          )
        ).statusCode,
        409,
      );
    }

    child.lessonSource = "language_framework";
    projectRecord.level = "A2";
    assert.equal(
      (
        await verySimplifyLesson(
          context.server,
          project.id,
          child.id,
          cookie,
        )
      ).statusCode,
      409,
    );

    projectRecord.level = "A1 Beginner";
    child.status = "draft";
    assert.equal(
      (
        await verySimplifyLesson(
          context.server,
          project.id,
          child.id,
          cookie,
        )
      ).statusCode,
      409,
    );
    assert.equal(context.verySimplifier.calls.length, 0);
  } finally {
    await context.server.close();
  }
});

test("ready A1 children A and B use only their server-side base content once", async () => {
  const context = testServer();
  const cookie = sessionCookie(firstUser.id);
  context.verySimplifier.result = regeneratedLesson;

  try {
    const { project, parts } = await createReadyFrameworkSplitFixture(
      context,
      cookie,
    );

    for (const splitPart of ["A", "B"] as const) {
      const response = await verySimplifyLesson(
        context.server,
        project.id,
        parts[splitPart].id,
        cookie,
      );
      assert.equal(response.statusCode, 200);
      assert.deepEqual(
        response.json().lesson.simplifiedStructuredContent,
        regeneratedLesson,
      );
    }

    assert.deepEqual(context.verySimplifier.calls, [
      {
        language: "Alemán",
        level: "A1 Beginner",
        splitPart: "A",
        structuredContent: structuredLesson,
      },
      {
        language: "Alemán",
        level: "A1 Beginner",
        splitPart: "B",
        structuredContent: regeneratedLesson,
      },
    ]);
  } finally {
    await context.server.close();
  }
});

test("very simplification is idempotent and regeneration replaces only the child simplification", async () => {
  const context = testServer();
  const cookie = sessionCookie(firstUser.id);
  context.verySimplifier.result = simplifiedLesson;

  try {
    const { project, parts } = await createReadyFrameworkSplitFixture(
      context,
      cookie,
    );
    const child = context.store.lessons.find(({ id }) => id === parts.A.id)!;
    const baseBefore = structuredClone(child.structuredContent);

    const first = await verySimplifyLesson(
      context.server,
      project.id,
      child.id,
      cookie,
    );
    const repeated = await verySimplifyLesson(
      context.server,
      project.id,
      child.id,
      cookie,
    );
    assert.equal(first.statusCode, 200);
    assert.equal(repeated.statusCode, 200);
    assert.equal(context.verySimplifier.calls.length, 1);
    assert.deepEqual(
      repeated.json().lesson.simplifiedStructuredContent,
      simplifiedLesson,
    );

    context.verySimplifier.result = regeneratedLesson;
    const regenerated = await verySimplifyLesson(
      context.server,
      project.id,
      child.id,
      cookie,
      { regenerate: true },
    );
    assert.equal(regenerated.statusCode, 200);
    assert.equal(context.verySimplifier.calls.length, 2);
    assert.deepEqual(child.structuredContent, baseBefore);
    assert.deepEqual(child.simplifiedStructuredContent, regeneratedLesson);
    assert.equal(child.status, "ready");
    assert.equal(child.simplificationStartedAt, null);
  } finally {
    await context.server.close();
  }
});

test("very simplification failures preserve Base and any previous version and clear the lease", async () => {
  const context = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const { project, parts } = await createReadyFrameworkSplitFixture(
      context,
      cookie,
    );
    const child = context.store.lessons.find(({ id }) => id === parts.A.id)!;
    const baseBefore = structuredClone(child.structuredContent);

    context.verySimplifier.error = new LanguageLessonProcessingError(
      "provider_error",
    );
    const initialFailure = await verySimplifyLesson(
      context.server,
      project.id,
      child.id,
      cookie,
    );
    assert.equal(initialFailure.statusCode, 502);
    assert.deepEqual(child.structuredContent, baseBefore);
    assert.equal(child.simplifiedStructuredContent, null);
    assert.equal(child.simplificationStartedAt, null);
    assert.equal(child.status, "ready");

    context.verySimplifier.error = null;
    context.verySimplifier.result = simplifiedLesson;
    await verySimplifyLesson(
      context.server,
      project.id,
      child.id,
      cookie,
    );
    const previous = structuredClone(child.simplifiedStructuredContent);
    const previousSimplifiedAt = child.simplifiedAt?.getTime();

    context.verySimplifier.error = new LanguageLessonProcessingError(
      "provider_error",
    );
    const regenerationFailure = await verySimplifyLesson(
      context.server,
      project.id,
      child.id,
      cookie,
      { regenerate: true },
    );
    assert.equal(regenerationFailure.statusCode, 502);
    assert.deepEqual(child.structuredContent, baseBefore);
    assert.deepEqual(child.simplifiedStructuredContent, previous);
    assert.equal(child.simplifiedAt?.getTime(), previousSimplifiedAt);
    assert.equal(child.simplificationStartedAt, null);
    assert.equal(child.status, "ready");
  } finally {
    await context.server.close();
  }
});

test("an active very simplification lease rejects a duplicate request", async () => {
  const context = testServer();
  const cookie = sessionCookie(firstUser.id);
  let release!: () => void;
  context.verySimplifier.wait = new Promise<void>((resolve) => {
    release = resolve;
  });

  try {
    const { project, parts } = await createReadyFrameworkSplitFixture(
      context,
      cookie,
    );
    const first = verySimplifyLesson(
      context.server,
      project.id,
      parts.A.id,
      cookie,
    );
    for (
      let attempt = 0;
      attempt < 20 && context.verySimplifier.calls.length === 0;
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const duplicate = await verySimplifyLesson(
      context.server,
      project.id,
      parts.A.id,
      cookie,
    );
    assert.equal(duplicate.statusCode, 409);
    assert.equal(
      duplicate.json().error,
      "LANGUAGE_LESSON_SIMPLIFICATION_PROCESSING",
    );
    assert.equal(context.verySimplifier.calls.length, 1);
    release();
    assert.equal((await first).statusCode, 200);
  } finally {
    release?.();
    await context.server.close();
  }
});

test("the general simplify endpoint rejects A/B children without calling the root simplifier", async () => {
  const context = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const { project, parent, parts } = await createReadyFrameworkSplitFixture(
      context,
      cookie,
    );

    for (const child of [parts.A, parts.B]) {
      const response = await simplifyLesson(
        context.server,
        project.id,
        child.id,
        cookie,
      );
      assert.equal(response.statusCode, 409);
      assert.equal(
        response.json().error,
        "LANGUAGE_LESSON_SIMPLIFICATION_UNAVAILABLE",
      );
    }
    assert.equal(context.processor.simplificationCalls.length, 0);

    const root = await simplifyLesson(
      context.server,
      project.id,
      parent.id,
      cookie,
    );
    assert.equal(root.statusCode, 200);
    assert.equal(context.processor.simplificationCalls.length, 1);
  } finally {
    await context.server.close();
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

test("prepared free lesson audio resolves only persisted text through ElevenLabs and reuses cache", async () => {
  const {
    audioStore,
    audioProvider,
    audioStorage,
    elevenLabsProvider,
    server,
  } = testServer();
  const cookie = sessionCookie(firstUser.id);
  const exactText = "  Primero.\n\nSegundo con espacios finales.  ";

  try {
    const project = await createProject(server, cookie, "Deutsch");
    const lesson = await createLesson(server, project.id, cookie, "free");
    const prepared = await prepareFreeLesson(
      server,
      project.id,
      lesson.id,
      cookie,
      { title: "  Mein eigener Text  ", sourceContent: exactText },
    );
    assert.equal(prepared.statusCode, 200);

    const female = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "freeText", index: 0, voice: "female" },
    );
    const cachedFemale = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "freeText", index: 0, voice: "female" },
    );
    const male = await requestLessonAudio(
      server,
      project.id,
      lesson.id,
      cookie,
      { version: "original", section: "freeText", index: 0, voice: "male" },
    );

    assert.equal(female.statusCode, 200);
    assert.equal(cachedFemale.statusCode, 200);
    assert.equal(male.statusCode, 200);
    assert.equal(audioProvider.calls.length, 0);
    assert.deepEqual(elevenLabsProvider.calls, [
      { text: exactText, language: "Deutsch" },
      { text: exactText, language: "Deutsch" },
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
    assert.equal(audioStorage.gets.length, 1);
    assert.ok(
      audioStore.assets.every(({ storageKey }) =>
        /^language-audio\/[a-f0-9]{64}\.mp3$/.test(storageKey),
      ),
    );
  } finally {
    await server.close();
  }
});

test("free lesson audio rejects browser text, invalid targets and unavailable configuration", async () => {
  const invalid = testServer();
  const unsupported = testServer();
  const missingVoice = testServer();
  const cookie = sessionCookie(firstUser.id);
  const femaleVoice = process.env.ELEVENLABS_VOICE_ID_DE_FEMALE;

  try {
    const invalidProject = await createProject(invalid.server, cookie, "Alemán");
    const invalidLesson = await createLesson(
      invalid.server,
      invalidProject.id,
      cookie,
      "free",
    );
    await prepareFreeLesson(
      invalid.server,
      invalidProject.id,
      invalidLesson.id,
      cookie,
    );
    const invalidPayloads = [
      { version: "original", section: "freeText", index: 0 },
      {
        version: "original",
        section: "freeText",
        index: 0,
        voice: "female",
        text: "Texto elegido por el navegador",
      },
      {
        version: "original",
        section: "freeText",
        index: 0,
        voice: "female",
        provider: "elevenlabs",
      },
      {
        version: "original",
        section: "freeText",
        index: 0,
        voice: "arbitrary-voice-id",
      },
      { version: "original", section: "freeText", index: 1, voice: "female" },
      { version: "simplified", section: "freeText", index: 0, voice: "female" },
    ];
    for (const payload of invalidPayloads) {
      const response = await requestLessonAudio(
        invalid.server,
        invalidProject.id,
        invalidLesson.id,
        cookie,
        payload,
      );
      assert.equal(response.statusCode, 400);
    }

    const unsupportedProject = await createProject(
      unsupported.server,
      cookie,
      "Klingon",
    );
    const unsupportedLesson = await createLesson(
      unsupported.server,
      unsupportedProject.id,
      cookie,
      "free",
    );
    await prepareFreeLesson(
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
      { version: "original", section: "freeText", index: 0, voice: "female" },
    );

    const missingProject = await createProject(
      missingVoice.server,
      cookie,
      "Alemán",
    );
    const missingLesson = await createLesson(
      missingVoice.server,
      missingProject.id,
      cookie,
      "free",
    );
    await prepareFreeLesson(
      missingVoice.server,
      missingProject.id,
      missingLesson.id,
      cookie,
    );
    delete process.env.ELEVENLABS_VOICE_ID_DE_FEMALE;
    const voiceUnavailable = await requestLessonAudio(
      missingVoice.server,
      missingProject.id,
      missingLesson.id,
      cookie,
      { version: "original", section: "freeText", index: 0, voice: "female" },
    );

    assert.equal(unavailable.statusCode, 409);
    assert.equal(unavailable.json().error, "LANGUAGE_FREE_AUDIO_UNAVAILABLE");
    assert.equal(voiceUnavailable.statusCode, 409);
    assert.equal(
      voiceUnavailable.json().error,
      "LANGUAGE_FREE_AUDIO_VOICE_UNAVAILABLE",
    );
    for (const dependencies of [invalid, unsupported, missingVoice]) {
      assert.equal(dependencies.audioProvider.calls.length, 0);
      assert.equal(dependencies.elevenLabsProvider.calls.length, 0);
      assert.equal(dependencies.audioStore.assets.length, 0);
    }
  } finally {
    if (femaleVoice) {
      process.env.ELEVENLABS_VOICE_ID_DE_FEMALE = femaleVoice;
    }
    await invalid.server.close();
    await unsupported.server.close();
    await missingVoice.server.close();
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

test("lesson progress migration defaults historical lessons and constrains metadata", async () => {
  const migration = await readFile(
    new URL(
      "../drizzle/0013_add_language_lesson_progress.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /ALTER TABLE "language_lessons"/);
  assert.match(migration, /"learning_status" text DEFAULT 'pending' NOT NULL/);
  assert.match(migration, /"difficulty" text/);
  assert.match(migration, /language_lessons_learning_status_check/);
  assert.match(migration, /'pending', 'in_progress', 'completed'/);
  assert.match(migration, /language_lessons_difficulty_check/);
  assert.match(migration, /"difficulty" IS NULL/);
  assert.match(migration, /'easy', 'normal', 'hard'/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(migration, /\bUPDATE\s+"language_lessons"/i);
});

test("free lesson title migration is additive and preserves historical structured lessons", async () => {
  const migration = await readFile(
    new URL(
      "../drizzle/0015_add_language_free_lesson_title.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /ALTER TABLE "language_lessons"/);
  assert.match(migration, /ADD COLUMN "free_title" text/);
  assert.match(migration, /language_lessons_free_title_check/);
  assert.match(migration, /length\(btrim\("free_title"\)\) BETWEEN 1 AND 160/);
  assert.match(migration, /"structured_content" IS NOT NULL/);
  assert.match(migration, /"lesson_source" = 'free'/);
  assert.match(migration, /length\(btrim\("source_content"\)\) > 0/);
  assert.doesNotMatch(migration, /\b(?:TRUNCATE|DELETE\s+FROM|UPDATE)\b/i);
  assert.doesNotMatch(migration, /CREATE TABLE/i);
});

test("free analysis migration adds only nullable JSONB without backfill", async () => {
  const migration = await readFile(
    new URL(
      "../drizzle/0016_add_language_free_analysis.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /ALTER TABLE "language_lessons"/);
  assert.match(migration, /ADD COLUMN "free_analysis" jsonb/);
  assert.doesNotMatch(migration, /NOT NULL|DEFAULT|CREATE TABLE/i);
  assert.doesNotMatch(
    migration,
    /\b(?:UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/i,
  );
  assert.doesNotMatch(
    migration,
    /free_title|source_content|structured_content|status|learning_status|difficulty|language_audio_assets/i,
  );
});

test("lesson split migration adds only nullable relationships and partial uniqueness", async () => {
  const migration = await readFile(
    new URL(
      "../drizzle/0017_add_language_lesson_split_relationship.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /ADD COLUMN "split_parent_lesson_id" uuid/);
  assert.match(migration, /ADD COLUMN "split_part" text/);
  assert.match(migration, /language_lessons_split_parent_fkey/);
  assert.match(migration, /REFERENCES "language_lessons" \("id"\)/);
  assert.match(migration, /ON DELETE CASCADE/);
  assert.match(migration, /language_lessons_split_pair_check/);
  assert.match(migration, /"split_part" IS NOT NULL/);
  assert.match(migration, /"split_part" IN \('A', 'B'\)/);
  assert.match(migration, /language_lessons_split_self_check/);
  assert.match(migration, /language_lessons_split_framework_only_check/);
  assert.match(migration, /"lesson_source" = 'language_framework'/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "language_lessons_project_source_number_unique"[\s\S]*WHERE "split_parent_lesson_id" IS NULL/,
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "language_lessons_split_parent_part_unique"[\s\S]*WHERE "split_parent_lesson_id" IS NOT NULL/,
  );
  assert.doesNotMatch(
    migration,
    /\b(?:UPDATE|DELETE\s+FROM|INSERT|TRUNCATE|CREATE\s+TABLE)\b/i,
  );
  assert.doesNotMatch(
    migration,
    /free_title|free_analysis|source_content|structured_content|simplified_structured_content|learning_status|difficulty|language_audio_assets|users|exercises/i,
  );
});
