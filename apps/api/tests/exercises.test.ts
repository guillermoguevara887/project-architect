import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";
import type {
  ExerciseStatus,
  StructuredExerciseGuide,
} from "../src/exercises/contracts.js";
import type {
  CreateExerciseInput,
  Exercise,
  ExerciseStore,
  UpdateExerciseInput,
  UpdateExerciseWorkspaceInput,
} from "../src/exercises/repository.js";
import {
  ExerciseTutorError,
  type ExerciseTutor,
  type ExerciseTutorInput,
} from "../src/exercises/tutor.js";

process.env.NODE_ENV = "test";
process.env.AUTH_COOKIE_SECRET =
  "test-only-cookie-secret-with-more-than-thirty-two-characters";

const firstUser: AuthUser = {
  id: "1ea48778-ef55-4a23-a550-0f31801a6413",
  username: "memoos-user",
  passwordHash: "unused",
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
};

const secondUser: AuthUser = {
  id: "f3a8af82-632c-4773-a57d-68ca21d10a8b",
  username: "other-user",
  passwordHash: "unused",
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
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

class MemoryExerciseStore implements ExerciseStore {
  readonly exercises: Exercise[] = [];
  private timestamp = Date.parse("2026-08-24T12:00:00.000Z");

  private now() {
    this.timestamp += 1_000;
    return new Date(this.timestamp);
  }

  private findOwned(exerciseId: string, userId: string) {
    return (
      this.exercises.find(
        (exercise) =>
          exercise.id === exerciseId && exercise.userId === userId,
      ) ?? null
    );
  }

  async listExercises(userId: string) {
    return this.exercises
      .filter((exercise) => exercise.userId === userId)
      .sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime(),
      );
  }

  async createExercise(input: CreateExerciseInput) {
    const now = this.now();
    const exercise: Exercise = {
      id: randomUUID(),
      ...input,
      status: "pending",
      guideContent: null,
      guideStructuredContent: null,
      guideGenerationCount: 0,
      suggestedSteps: null,
      workspaceType: null,
      workspaceValue: null,
      createdAt: now,
      updatedAt: now,
    };

    this.exercises.push(exercise);
    return exercise;
  }

  async findExerciseByIdForUser(exerciseId: string, userId: string) {
    return this.findOwned(exerciseId, userId);
  }

  async deleteExercise(exerciseId: string, userId: string) {
    const index = this.exercises.findIndex(
      (exercise) =>
        exercise.id === exerciseId && exercise.userId === userId,
    );

    if (index === -1) {
      return false;
    }

    this.exercises.splice(index, 1);
    return true;
  }

  async updateExercise(input: UpdateExerciseInput) {
    const exercise = this.findOwned(input.exerciseId, input.userId);

    if (!exercise) {
      return null;
    }

    if (input.title !== undefined) exercise.title = input.title;
    if (input.sourceName !== undefined) exercise.sourceName = input.sourceName;
    if (input.chapter !== undefined) exercise.chapter = input.chapter;
    if (input.exerciseNumber !== undefined) {
      exercise.exerciseNumber = input.exerciseNumber;
    }
    if (input.prompt !== undefined) exercise.prompt = input.prompt;
    exercise.updatedAt = this.now();
    return exercise;
  }

  async updateStatus(
    exerciseId: string,
    userId: string,
    status: ExerciseStatus,
  ) {
    const exercise = this.findOwned(exerciseId, userId);

    if (!exercise) {
      return null;
    }

    exercise.status = status;
    exercise.updatedAt = this.now();
    return exercise;
  }

  async updateWorkspace(input: UpdateExerciseWorkspaceInput) {
    const exercise = this.findOwned(input.exerciseId, input.userId);

    if (!exercise) {
      return null;
    }

    exercise.workspaceType = input.workspaceType;
    exercise.workspaceValue = input.workspaceValue;
    exercise.updatedAt = this.now();
    return exercise;
  }

  async saveStructuredGuide(
    exerciseId: string,
    userId: string,
    guide: StructuredExerciseGuide,
  ) {
    const exercise = this.findOwned(exerciseId, userId);

    if (!exercise) {
      return { status: "not_found" as const };
    }

    const effectiveCount = Math.max(
      exercise.guideGenerationCount,
      exercise.guideContent === null ? 0 : 1,
    );

    if (effectiveCount >= 2) {
      return { status: "limit_reached" as const, exercise };
    }

    exercise.guideStructuredContent = guide;
    exercise.guideGenerationCount = effectiveCount + 1;
    exercise.updatedAt = this.now();
    return { status: "saved" as const, exercise };
  }

  async saveSuggestedSteps(
    exerciseId: string,
    userId: string,
    suggestedSteps: string[],
  ) {
    const exercise = this.findOwned(exerciseId, userId);

    if (!exercise) {
      return null;
    }

    exercise.suggestedSteps = suggestedSteps;
    exercise.updatedAt = this.now();
    return exercise;
  }
}

function guideFixture(generation = 1): StructuredExerciseGuide {
  return {
    sections: [
      {
        type: "explanation",
        title: `Objetivo ${generation}`,
        intro: "Distingue los datos almacenados de su interpretación.",
        items: [],
      },
      {
        type: "concepts",
        title: "Piezas mínimas",
        intro: null,
        items: [
          {
            label: "Storage",
            text: "Es la memoria subyacente que contiene los valores.",
          },
        ],
      },
      {
        type: "bullets",
        title: "Qué comprobar",
        intro: null,
        items: [
          {
            label: null,
            text: "Observa si dos vistas comparten almacenamiento.",
          },
        ],
      },
    ],
  };
}

class FakeExerciseTutor implements ExerciseTutor {
  readonly guideCalls: ExerciseTutorInput[] = [];
  readonly stepsCalls: ExerciseTutorInput[] = [];

  async generateGuide(input: ExerciseTutorInput) {
    this.guideCalls.push(input);
    return guideFixture(this.guideCalls.length);
  }

  async generateSteps(input: ExerciseTutorInput) {
    this.stepsCalls.push(input);
    return [`Paso generado ${this.stepsCalls.length}`, "Comprobar el resultado"];
  }
}

function sessionCookie(userId: string) {
  return createSessionCookie(userId).split(";", 1)[0];
}

function testServer(store = new MemoryExerciseStore()) {
  const tutor = new FakeExerciseTutor();

  return {
    store,
    tutor,
    server: createServer(
      {},
      {
        authStore: new MemoryAuthStore(),
        exerciseStore: store,
        exerciseTutor: tutor,
      },
    ),
  };
}

async function createExercise(
  server: ReturnType<typeof createServer>,
  cookie: string,
) {
  const response = await server.inject({
    method: "POST",
    url: "/exercises",
    headers: { cookie },
    payload: {
      title: "Operaciones con tensores",
      sourceName: "Deep Learning with PyTorch",
      chapter: "Capítulo 3",
      exerciseNumber: "3.4",
      prompt: "Crea un tensor, cambia un elemento y explica qué observas.",
    },
  });

  assert.equal(response.statusCode, 201);
  return response.json().exercise as Exercise;
}

test("Exercises require authentication and validate required fields", async () => {
  const { store, server } = testServer();

  try {
    const list = await server.inject({ method: "GET", url: "/exercises" });
    const unauthorizedCreation = await server.inject({
      method: "POST",
      url: "/exercises",
      payload: { title: "Exercise", prompt: "Do something" },
    });
    const invalidCreation = await server.inject({
      method: "POST",
      url: "/exercises",
      headers: { cookie: sessionCookie(firstUser.id) },
      payload: { title: " ", prompt: " " },
    });

    assert.equal(list.statusCode, 401);
    assert.equal(unauthorizedCreation.statusCode, 401);
    assert.equal(invalidCreation.statusCode, 400);
    assert.equal(store.exercises.length, 0);
  } finally {
    await server.close();
  }
});

test("creation, listing, reading and updates stay isolated by user", async () => {
  const { store, server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const exercise = await createExercise(server, ownerCookie);
    const ownerList = await server.inject({
      method: "GET",
      url: "/exercises",
      headers: { cookie: ownerCookie },
    });
    const otherList = await server.inject({
      method: "GET",
      url: "/exercises",
      headers: { cookie: otherCookie },
    });
    const ownerDetail = await server.inject({
      method: "GET",
      url: `/exercises/${exercise.id}`,
      headers: { cookie: ownerCookie },
    });
    const otherDetail = await server.inject({
      method: "GET",
      url: `/exercises/${exercise.id}`,
      headers: { cookie: otherCookie },
    });
    const update = await server.inject({
      method: "PATCH",
      url: `/exercises/${exercise.id}`,
      headers: { cookie: ownerCookie },
      payload: {
        title: "Tensores actualizados",
        chapter: "   ",
        prompt: "Inspecciona primero el shape del tensor.",
      },
    });
    const foreignUpdate = await server.inject({
      method: "PATCH",
      url: `/exercises/${exercise.id}`,
      headers: { cookie: otherCookie },
      payload: { title: "No permitido" },
    });

    assert.equal(store.exercises[0]?.userId, firstUser.id);
    assert.equal(exercise.status, "pending");
    assert.equal(exercise.guideGenerationCount, 0);
    assert.equal(exercise.guideStructuredContent, null);
    assert.equal(ownerList.statusCode, 200);
    assert.equal(ownerList.json().exercises.length, 1);
    assert.equal(otherList.statusCode, 200);
    assert.deepEqual(otherList.json().exercises, []);
    assert.equal(ownerDetail.statusCode, 200);
    assert.equal(otherDetail.statusCode, 404);
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().exercise.title, "Tensores actualizados");
    assert.equal(update.json().exercise.chapter, null);
    assert.equal(foreignUpdate.statusCode, 404);
  } finally {
    await server.close();
  }
});

test("exercise deletion requires authentication and stays isolated by user", async () => {
  const { store, server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const exercise = await createExercise(server, ownerCookie);
    const stored = store.exercises[0];
    assert.ok(stored);
    stored.status = "working";
    stored.guideContent = "Guía legacy completa.";
    stored.guideStructuredContent = guideFixture();
    stored.guideGenerationCount = 2;
    stored.suggestedSteps = ["Revisar el enunciado", "Probar la solución"];
    stored.workspaceType = "local";
    stored.workspaceValue = "C:\\Users\\memoos\\exercise.py";

    const unauthorized = await server.inject({
      method: "DELETE",
      url: `/exercises/${exercise.id}`,
    });
    const foreignDeletion = await server.inject({
      method: "DELETE",
      url: `/exercises/${exercise.id}`,
      headers: { cookie: otherCookie },
    });
    const missingDeletion = await server.inject({
      method: "DELETE",
      url: `/exercises/${randomUUID()}`,
      headers: { cookie: ownerCookie },
    });

    assert.equal(unauthorized.statusCode, 401);
    assert.equal(foreignDeletion.statusCode, 404);
    assert.equal(foreignDeletion.json().error, "EXERCISE_NOT_FOUND");
    assert.equal(missingDeletion.statusCode, 404);
    assert.equal(missingDeletion.json().error, "EXERCISE_NOT_FOUND");
    assert.equal(store.exercises.length, 1);

    const deletion = await server.inject({
      method: "DELETE",
      url: `/exercises/${exercise.id}`,
      headers: { cookie: ownerCookie },
    });
    const deletedDetail = await server.inject({
      method: "GET",
      url: `/exercises/${exercise.id}`,
      headers: { cookie: ownerCookie },
    });
    const ownerList = await server.inject({
      method: "GET",
      url: "/exercises",
      headers: { cookie: ownerCookie },
    });

    assert.equal(deletion.statusCode, 204);
    assert.equal(deletion.body, "");
    assert.equal(deletedDetail.statusCode, 404);
    assert.equal(deletedDetail.json().error, "EXERCISE_NOT_FOUND");
    assert.deepEqual(ownerList.json().exercises, []);
    assert.equal(store.exercises.length, 0);
  } finally {
    await server.close();
  }
});

test("exercise status accepts only pending, working and solved", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const exercise = await createExercise(server, cookie);

    for (const status of ["working", "solved", "pending"]) {
      const update = await server.inject({
        method: "PATCH",
        url: `/exercises/${exercise.id}/status`,
        headers: { cookie },
        payload: { status },
      });

      assert.equal(update.statusCode, 200);
      assert.equal(update.json().exercise.status, status);
    }

    const invalid = await server.inject({
      method: "PATCH",
      url: `/exercises/${exercise.id}/status`,
      headers: { cookie },
      payload: { status: "paused" },
    });
    const foreignUpdate = await server.inject({
      method: "PATCH",
      url: `/exercises/${exercise.id}/status`,
      headers: { cookie: sessionCookie(secondUser.id) },
      payload: { status: "solved" },
    });

    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "INVALID_EXERCISE_STATUS");
    assert.equal(foreignUpdate.statusCode, 404);
  } finally {
    await server.close();
  }
});

test("Colab and local workspaces persist without server-side access", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const exercise = await createExercise(server, cookie);
    const colab = await server.inject({
      method: "PUT",
      url: `/exercises/${exercise.id}/workspace`,
      headers: { cookie },
      payload: {
        workspaceType: "colab",
        workspaceValue: "https://colab.research.google.com/drive/notebook-id",
      },
    });
    const local = await server.inject({
      method: "PUT",
      url: `/exercises/${exercise.id}/workspace`,
      headers: { cookie },
      payload: {
        workspaceType: "local",
        workspaceValue: "C:\\Users\\memoos\\chapter3\\exercise4.py",
      },
    });
    const invalidColab = await server.inject({
      method: "PUT",
      url: `/exercises/${exercise.id}/workspace`,
      headers: { cookie },
      payload: {
        workspaceType: "colab",
        workspaceValue: "https://example.com/not-a-colab",
      },
    });
    const foreignWorkspace = await server.inject({
      method: "PUT",
      url: `/exercises/${exercise.id}/workspace`,
      headers: { cookie: sessionCookie(secondUser.id) },
      payload: {
        workspaceType: "local",
        workspaceValue: "/Users/other/private.ipynb",
      },
    });

    assert.equal(colab.statusCode, 200);
    assert.equal(colab.json().exercise.workspaceType, "colab");
    assert.equal(local.statusCode, 200);
    assert.equal(
      local.json().exercise.workspaceValue,
      "C:\\Users\\memoos\\chapter3\\exercise4.py",
    );
    assert.equal(invalidColab.statusCode, 400);
    assert.equal(foreignWorkspace.statusCode, 404);
  } finally {
    await server.close();
  }
});

test("guide and steps generation persist and regenerate only for the owner", async () => {
  const { tutor, server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const exercise = await createExercise(server, ownerCookie);
    const guide = await server.inject({
      method: "POST",
      url: `/exercises/${exercise.id}/guide`,
      headers: { cookie: ownerCookie },
    });
    const guideRegeneration = await server.inject({
      method: "POST",
      url: `/exercises/${exercise.id}/guide`,
      headers: { cookie: ownerCookie },
    });
    const blockedGuide = await server.inject({
      method: "POST",
      url: `/exercises/${exercise.id}/guide`,
      headers: { cookie: ownerCookie },
    });
    const steps = await server.inject({
      method: "POST",
      url: `/exercises/${exercise.id}/steps`,
      headers: { cookie: ownerCookie },
    });
    const stepsRegeneration = await server.inject({
      method: "POST",
      url: `/exercises/${exercise.id}/steps`,
      headers: { cookie: ownerCookie },
    });
    const foreignGuide = await server.inject({
      method: "POST",
      url: `/exercises/${exercise.id}/guide`,
      headers: { cookie: otherCookie },
    });
    const reload = await server.inject({
      method: "GET",
      url: `/exercises/${exercise.id}`,
      headers: { cookie: ownerCookie },
    });

    assert.equal(guide.statusCode, 200);
    assert.equal(guide.json().exercise.guideContent, null);
    assert.equal(guide.json().exercise.guideGenerationCount, 1);
    assert.equal(
      guide.json().exercise.guideStructuredContent.sections[0].title,
      "Objetivo 1",
    );
    assert.equal(guideRegeneration.statusCode, 200);
    assert.equal(
      guideRegeneration.json().exercise.guideStructuredContent.sections[0]
        .title,
      "Objetivo 2",
    );
    assert.equal(guideRegeneration.json().exercise.guideGenerationCount, 2);
    assert.equal(blockedGuide.statusCode, 409);
    assert.equal(blockedGuide.json().error, "EXERCISE_GUIDE_LIMIT_REACHED");
    assert.equal(blockedGuide.json().exercise.guideGenerationCount, 2);
    assert.equal(steps.statusCode, 200);
    assert.deepEqual(steps.json().exercise.suggestedSteps, [
      "Paso generado 1",
      "Comprobar el resultado",
    ]);
    assert.equal(stepsRegeneration.statusCode, 200);
    assert.deepEqual(reload.json().exercise.suggestedSteps, [
      "Paso generado 2",
      "Comprobar el resultado",
    ]);
    assert.equal(reload.json().exercise.guideGenerationCount, 2);
    assert.equal(
      reload.json().exercise.guideStructuredContent.sections[0].title,
      "Objetivo 2",
    );
    assert.equal(foreignGuide.statusCode, 404);
    assert.equal(tutor.guideCalls.length, 2);
    assert.equal(tutor.stepsCalls.length, 2);
    assert.equal(tutor.guideCalls[0]?.title, "Operaciones con tensores");
  } finally {
    await server.close();
  }
});

test("a legacy guide remains visible and permits exactly one structured regeneration", async () => {
  const { store, tutor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const exercise = await createExercise(server, cookie);
    const stored = store.exercises[0];
    assert.ok(stored);
    stored.guideContent =
      "## Qué te pide\n\n**Storage**\nMemoria donde viven los valores.";

    const legacy = await server.inject({
      method: "GET",
      url: `/exercises/${exercise.id}`,
      headers: { cookie },
    });
    const regeneration = await server.inject({
      method: "POST",
      url: `/exercises/${exercise.id}/guide`,
      headers: { cookie },
    });
    const blocked = await server.inject({
      method: "POST",
      url: `/exercises/${exercise.id}/guide`,
      headers: { cookie },
    });

    assert.equal(legacy.statusCode, 200);
    assert.equal(legacy.json().exercise.guideContent, stored.guideContent);
    assert.equal(legacy.json().exercise.guideStructuredContent, null);
    assert.equal(legacy.json().exercise.guideGenerationCount, 1);
    assert.equal(regeneration.statusCode, 200);
    assert.equal(
      regeneration.json().exercise.guideContent,
      stored.guideContent,
    );
    assert.equal(regeneration.json().exercise.guideGenerationCount, 2);
    assert.equal(
      regeneration.json().exercise.guideStructuredContent.sections.length,
      3,
    );
    assert.equal(blocked.statusCode, 409);
    assert.equal(tutor.guideCalls.length, 1);
    assert.equal(stored.guideGenerationCount, 2);
  } finally {
    await server.close();
  }
});

test("provider and invalid structured output failures preserve guide content and count", async () => {
  const store = new MemoryExerciseStore();
  const failureCodes = ["provider_error", "invalid_response"] as const;
  let failureIndex = 0;
  const failingTutor: ExerciseTutor = {
    async generateGuide() {
      const code = failureCodes[failureIndex] ?? "invalid_response";
      failureIndex += 1;
      throw new ExerciseTutorError(code);
    },
    async generateSteps() {
      return ["No se usa en esta prueba"];
    },
  };
  const server = createServer(
    {},
    {
      authStore: new MemoryAuthStore(),
      exerciseStore: store,
      exerciseTutor: failingTutor,
    },
  );
  const cookie = sessionCookie(firstUser.id);

  try {
    const exercise = await createExercise(server, cookie);
    const stored = store.exercises[0];
    assert.ok(stored);
    const existingGuide = guideFixture(7);
    stored.guideStructuredContent = existingGuide;
    stored.guideGenerationCount = 1;

    for (const expectedCode of failureCodes) {
      const response = await server.inject({
        method: "POST",
        url: `/exercises/${exercise.id}/guide`,
        headers: { cookie },
      });

      assert.equal(response.statusCode, 503, expectedCode);
      assert.equal(response.json().error, "EXERCISE_AI_UNAVAILABLE");
      assert.equal(stored.guideGenerationCount, 1);
      assert.deepEqual(stored.guideStructuredContent, existingGuide);
      assert.equal(stored.guideContent, null);
    }
  } finally {
    await server.close();
  }
});

test("simultaneous regenerations cannot exceed the backend guide limit", async () => {
  const { store, tutor, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const exercise = await createExercise(server, cookie);
    const first = await server.inject({
      method: "POST",
      url: `/exercises/${exercise.id}/guide`,
      headers: { cookie },
    });
    assert.equal(first.statusCode, 200);

    const concurrent = await Promise.all([
      server.inject({
        method: "POST",
        url: `/exercises/${exercise.id}/guide`,
        headers: { cookie },
      }),
      server.inject({
        method: "POST",
        url: `/exercises/${exercise.id}/guide`,
        headers: { cookie },
      }),
    ]);

    assert.deepEqual(
      concurrent.map((response) => response.statusCode).sort(),
      [200, 409],
    );
    assert.equal(store.exercises[0]?.guideGenerationCount, 2);
    assert.equal(tutor.guideCalls.length, 3);
    assert.ok(store.exercises[0]?.guideStructuredContent);
  } finally {
    await server.close();
  }
});

test("Exercises migration is additive, isolated by user and non-destructive", async () => {
  const migration = await readFile(
    new URL("../drizzle/0011_create_exercises.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE "exercises"/);
  assert.match(migration, /"user_id" uuid NOT NULL REFERENCES "users" \("id"\)/);
  assert.match(migration, /"suggested_steps" jsonb/);
  assert.match(migration, /'pending', 'working', 'solved'/);
  assert.match(migration, /'colab', 'local', 'url'/);
  assert.doesNotMatch(
    migration,
    /\b(?:DROP|TRUNCATE|ALTER)\b|\bDELETE\s+FROM\b/i,
  );
});

test("structured guide migration is additive and preserves guide_content", async () => {
  const migration = await readFile(
    new URL(
      "../drizzle/0012_structure_exercise_guides.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /ADD COLUMN "guide_structured_content" jsonb/);
  assert.match(
    migration,
    /ADD COLUMN "guide_generation_count" integer DEFAULT 0 NOT NULL/,
  );
  assert.match(migration, /jsonb_typeof\("guide_structured_content"\)/);
  assert.match(migration, /"guide_generation_count" BETWEEN 0 AND 2/);
  assert.doesNotMatch(
    migration,
    /\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b|ALTER\s+COLUMN\s+"guide_content"/i,
  );
});
