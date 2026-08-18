import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type {
  ArchitectProject,
  ArchitectProjectStore,
  CreateCompetitionInput,
} from "../src/architect-projects/repository.js";
import type { AuthStore, AuthUser } from "../src/auth/repository.js";
import { createSessionCookie } from "../src/auth/session.js";
import { createServer } from "../src/create-server.js";

process.env.NODE_ENV = "test";
process.env.AUTH_COOKIE_SECRET =
  "test-only-cookie-secret-with-more-than-thirty-two-characters";

const firstUser: AuthUser = {
  id: "1ea48778-ef55-4a23-a550-0f31801a6413",
  username: "architect",
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

class MemoryArchitectProjectStore implements ArchitectProjectStore {
  readonly projects: ArchitectProject[] = [];

  async listForUser(userId: string) {
    return this.projects
      .filter((project) => project.userId === userId)
      .sort(
        (first, second) =>
          second.createdAt.getTime() - first.createdAt.getTime(),
      );
  }

  async createCompetition(input: CreateCompetitionInput) {
    const now = new Date();
    const project: ArchitectProject = {
      id: randomUUID(),
      userId: input.userId,
      projectType: "competition",
      sourceText: input.sourceText,
      officialUrl: input.officialUrl,
      analysisStatus: "pending",
      structuredData: null,
      createdAt: now,
      updatedAt: now,
    };

    this.projects.push(project);
    return project;
  }

  async findByIdForUser(projectId: string, userId: string) {
    return (
      this.projects.find(
        (project) => project.id === projectId && project.userId === userId,
      ) ?? null
    );
  }
}

function sessionCookie(userId: string) {
  return createSessionCookie(userId).split(";", 1)[0];
}

function testServer(projectStore = new MemoryArchitectProjectStore()) {
  return {
    projectStore,
    server: createServer(
      {},
      {
        authStore: new MemoryAuthStore(),
        architectProjectStore: projectStore,
      },
    ),
  };
}

test("an unauthenticated user cannot list, create or read a competition", async () => {
  const { projectStore, server } = testServer();

  try {
    const creation = await server.inject({
      method: "POST",
      url: "/architect/projects",
      payload: { sourceText: "Competition information" },
    });
    const listing = await server.inject({
      method: "GET",
      url: "/architect/projects",
    });
    const lookup = await server.inject({
      method: "GET",
      url: `/architect/projects/${randomUUID()}`,
    });

    assert.equal(listing.statusCode, 401);
    assert.equal(creation.statusCode, 401);
    assert.equal(lookup.statusCode, 401);
    assert.equal(projectStore.projects.length, 0);
  } finally {
    await server.close();
  }
});

test("projects are listed newest first and only for the session user", async () => {
  const { projectStore, server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);
  const olderOwnerProject: ArchitectProject = {
    id: randomUUID(),
    userId: firstUser.id,
    projectType: "competition",
    sourceText: "Older owner competition",
    officialUrl: null,
    analysisStatus: "pending",
    structuredData: null,
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    updatedAt: new Date("2026-01-01T10:00:00.000Z"),
  };
  const otherUserProject: ArchitectProject = {
    ...olderOwnerProject,
    id: randomUUID(),
    userId: secondUser.id,
    sourceText: "Other user's competition",
    createdAt: new Date("2026-03-01T10:00:00.000Z"),
    updatedAt: new Date("2026-03-01T10:00:00.000Z"),
  };
  const newerOwnerProject: ArchitectProject = {
    ...olderOwnerProject,
    id: randomUUID(),
    projectType: "project",
    sourceText: "Newer owner project",
    createdAt: new Date("2026-02-01T10:00:00.000Z"),
    updatedAt: new Date("2026-02-01T10:00:00.000Z"),
  };

  projectStore.projects.push(
    olderOwnerProject,
    otherUserProject,
    newerOwnerProject,
  );

  try {
    const ownerListing = await server.inject({
      method: "GET",
      url: "/architect/projects",
      headers: { cookie: ownerCookie },
    });
    const otherListing = await server.inject({
      method: "GET",
      url: "/architect/projects",
      headers: { cookie: otherCookie },
    });

    assert.equal(ownerListing.statusCode, 200);
    assert.deepEqual(
      ownerListing
        .json()
        .projects.map((project: { id: string }) => project.id),
      [newerOwnerProject.id, olderOwnerProject.id],
    );
    assert.equal(ownerListing.json().projects[0].projectType, "project");
    assert.equal(ownerListing.json().projects[0].userId, undefined);
    assert.deepEqual(
      otherListing
        .json()
        .projects.map((project: { id: string }) => project.id),
      [otherUserProject.id],
    );
  } finally {
    await server.close();
  }
});

test("competition input requires text and accepts only optional HTTP URLs", async () => {
  const { server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const emptyText = await server.inject({
      method: "POST",
      url: "/architect/projects",
      headers: { cookie },
      payload: { sourceText: "   " },
    });
    const invalidUrl = await server.inject({
      method: "POST",
      url: "/architect/projects",
      headers: { cookie },
      payload: {
        sourceText: "Competition information",
        officialUrl: "ftp://example.com/competition",
      },
    });
    const noUrl = await server.inject({
      method: "POST",
      url: "/architect/projects",
      headers: { cookie },
      payload: { sourceText: "Competition without a URL" },
    });

    assert.equal(emptyText.statusCode, 400);
    assert.equal(emptyText.json().error, "SOURCE_TEXT_REQUIRED");
    assert.equal(invalidUrl.statusCode, 400);
    assert.equal(invalidUrl.json().error, "INVALID_OFFICIAL_URL");
    assert.equal(noUrl.statusCode, 201);
    assert.equal(noUrl.json().project.officialUrl, null);
  } finally {
    await server.close();
  }
});

test("a competition is created with the session user and pending values", async () => {
  const { projectStore, server } = testServer();
  const cookie = sessionCookie(firstUser.id);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/architect/projects",
      headers: { cookie },
      payload: {
        sourceText: "  Build an accessible public-service prototype.  ",
        officialUrl: "https://example.com/competition",
        userId: secondUser.id,
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(projectStore.projects.length, 1);
    assert.equal(projectStore.projects[0]?.userId, firstUser.id);
    assert.equal(projectStore.projects[0]?.projectType, "competition");
    assert.equal(
      projectStore.projects[0]?.sourceText,
      "Build an accessible public-service prototype.",
    );
    assert.equal(
      projectStore.projects[0]?.officialUrl,
      "https://example.com/competition",
    );
    assert.equal(projectStore.projects[0]?.analysisStatus, "pending");
    assert.equal(projectStore.projects[0]?.structuredData, null);
  } finally {
    await server.close();
  }
});

test("a competition can be reloaded only by its owning user", async () => {
  const { server } = testServer();
  const ownerCookie = sessionCookie(firstUser.id);
  const otherCookie = sessionCookie(secondUser.id);

  try {
    const creation = await server.inject({
      method: "POST",
      url: "/architect/projects",
      headers: { cookie: ownerCookie },
      payload: { sourceText: "Reloadable competition" },
    });
    const projectId = creation.json().project.id as string;

    const ownerLookup = await server.inject({
      method: "GET",
      url: `/architect/projects/${projectId}`,
      headers: { cookie: ownerCookie },
    });
    const otherLookup = await server.inject({
      method: "GET",
      url: `/architect/projects/${projectId}`,
      headers: { cookie: otherCookie },
    });

    assert.equal(ownerLookup.statusCode, 200);
    assert.equal(ownerLookup.json().project.id, projectId);
    assert.equal(ownerLookup.json().project.sourceText, "Reloadable competition");
    assert.equal(otherLookup.statusCode, 404);
  } finally {
    await server.close();
  }
});

test("the API health route remains available", async () => {
  const { server } = testServer();

  try {
    const response = await server.inject({ method: "GET", url: "/health" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: "ok",
      service: "memoos-api",
    });
  } finally {
    await server.close();
  }
});
