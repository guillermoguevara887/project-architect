import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import type {
  CreateLanguageProjectInput,
  CreateNextLanguageLessonInput,
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
};

const secondUser: AuthUser = {
  id: "bdf28936-4853-423d-b43e-020bb1b5ddcb",
  username: "other-user",
  passwordHash: "unused",
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
    const now = this.now();
    const lesson: LanguageLesson = {
      id: randomUUID(),
      languageProjectId: input.languageProjectId,
      lessonNumber,
      sourceContent: "",
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
      return null;
    }

    const lesson = this.lessons.find(
      (candidate) =>
        candidate.id === input.lessonId &&
        candidate.languageProjectId === input.languageProjectId,
    );

    if (!lesson) {
      return null;
    }

    lesson.sourceContent = input.sourceContent;
    lesson.updatedAt = this.now();
    return lesson;
  }
}

function sessionCookie(userId: string) {
  return createSessionCookie(userId).split(";", 1)[0];
}

function testServer(store = new MemoryLanguageStore()) {
  return {
    store,
    server: createServer(
      {},
      {
        authStore: new MemoryAuthStore(),
        languageStore: store,
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

test("Idiomas requires authentication and validates project fields", async () => {
  const { store, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const unauthenticatedList = await server.inject({
      method: "GET",
      url: "/languages/projects",
    });
    const unauthenticatedCreation = await server.inject({
      method: "POST",
      url: "/languages/projects",
      payload: { language: "Alemán", level: "Nivel 2" },
    });
    const invalidCreation = await server.inject({
      method: "POST",
      url: "/languages/projects",
      headers: { cookie },
      payload: { language: " ", level: "Nivel 2" },
    });

    assert.equal(unauthenticatedList.statusCode, 401);
    assert.equal(unauthenticatedCreation.statusCode, 401);
    assert.equal(invalidCreation.statusCode, 400);
    assert.equal(store.projects.length, 0);
  } finally {
    await server.close();
  }
});

test("a language project is trimmed, listed and visible only to its owner", async () => {
  const { store, server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const project = await createProject(server, ownerCookie);
    const ownerList = await server.inject({
      method: "GET",
      url: "/languages/projects",
      headers: { cookie: ownerCookie },
    });
    const ownerDetail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}`,
      headers: { cookie: ownerCookie },
    });
    const otherDetail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}`,
      headers: { cookie: otherCookie },
    });

    assert.equal(project.language, "Alemán");
    assert.equal(project.level, "Nivel 2");
    assert.equal(store.projects[0]?.userId, firstUser.id);
    assert.equal(ownerList.statusCode, 200);
    assert.equal(ownerList.json().projects[0].language, "Alemán");
    assert.equal(ownerDetail.statusCode, 200);
    assert.equal(otherDetail.statusCode, 404);
  } finally {
    await server.close();
  }
});

test("lessons are sequential and source material persists without trimming", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const project = await createProject(server, cookie);
    const firstCreation = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie },
    });
    const secondCreation = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie },
    });

    assert.equal(firstCreation.statusCode, 201);
    assert.equal(firstCreation.json().lesson.lessonNumber, 1);
    assert.equal(secondCreation.statusCode, 201);
    assert.equal(secondCreation.json().lesson.lessonNumber, 2);

    const listing = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie },
    });
    const lessons = listing.json().lessons as Array<{
      id: string;
      lessonNumber: number;
    }>;

    assert.equal(listing.statusCode, 200);
    assert.deepEqual(
      lessons.map((lesson) => lesson.lessonNumber),
      [1, 2],
    );

    const sourceContent = "  Guten Morgen.\nWie geht es dir?  ";
    const update = await server.inject({
      method: "PATCH",
      url: `/languages/projects/${project.id}/lessons/${lessons[0]?.id}`,
      headers: { cookie },
      payload: { sourceContent },
    });
    const detail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${lessons[0]?.id}`,
      headers: { cookie },
    });

    assert.equal(update.statusCode, 200);
    assert.equal(update.json().lesson.sourceContent, sourceContent);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().lesson.sourceContent, sourceContent);
  } finally {
    await server.close();
  }
});

test("a different user cannot read, create or update lessons", async () => {
  const { server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const project = await createProject(server, ownerCookie);
    const creation = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie: ownerCookie },
    });
    const lessonId = creation.json().lesson.id as string;

    const listing = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie: otherCookie },
    });
    const unauthorizedCreation = await server.inject({
      method: "POST",
      url: `/languages/projects/${project.id}/lessons`,
      headers: { cookie: otherCookie },
    });
    const detail = await server.inject({
      method: "GET",
      url: `/languages/projects/${project.id}/lessons/${lessonId}`,
      headers: { cookie: otherCookie },
    });
    const update = await server.inject({
      method: "PATCH",
      url: `/languages/projects/${project.id}/lessons/${lessonId}`,
      headers: { cookie: otherCookie },
      payload: { sourceContent: "Private material" },
    });

    assert.equal(listing.statusCode, 404);
    assert.equal(unauthorizedCreation.statusCode, 404);
    assert.equal(detail.statusCode, 404);
    assert.equal(update.statusCode, 404);
  } finally {
    await server.close();
  }
});

test("Idiomas migration is additive and protects lesson numbering", async () => {
  const migration = await readFile(
    new URL("../drizzle/0005_create_languages.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE "language_projects"/);
  assert.match(migration, /CREATE TABLE "language_lessons"/);
  assert.match(migration, /REFERENCES "users" \("id"\)/);
  assert.match(migration, /REFERENCES "language_projects" \("id"\)/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "language_lessons_project_number_unique"/,
  );
  assert.doesNotMatch(
    migration,
    /\b(?:DROP|TRUNCATE|ALTER)\b|\bDELETE\s+FROM\b/i,
  );
});
