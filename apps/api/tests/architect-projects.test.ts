import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type {
  ArchitectProject,
  ArchitectProjectStore,
  CreateCompetitionInput,
  CreateProjectInput,
  CreateProjectLinkInput,
  ProjectLink,
  ProjectStatus,
  UpdateProjectInput,
} from "../src/architect-projects/repository.js";
import {
  ProjectTextImproverError,
  type ProjectTextImprover,
} from "../src/architect-projects/text-improver.js";
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

function projectRecord(
  input: CreateProjectInput,
  overrides: Partial<ArchitectProject> = {},
): ArchitectProject {
  const now = new Date();
  return {
    id: randomUUID(),
    userId: input.userId,
    projectType: "project",
    sourceText: input.sourceText,
    officialUrl: null,
    analysisStatus: "pending",
    structuredData: null,
    name: input.name,
    objective: input.objective,
    status: input.status,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class MemoryArchitectProjectStore implements ArchitectProjectStore {
  readonly projects: ArchitectProject[] = [];
  readonly links: ProjectLink[] = [];

  async listForUser(userId: string, status?: ProjectStatus) {
    return this.projects
      .filter(
        (project) =>
          project.userId === userId && (!status || project.status === status),
      )
      .sort(
        (first, second) =>
          second.updatedAt.getTime() - first.updatedAt.getTime(),
      );
  }

  async createProject(input: CreateProjectInput) {
    const project = projectRecord(input);
    this.projects.push(project);
    return project;
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
      name: null,
      objective: null,
      status: null,
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

  async updateForUser(
    projectId: string,
    userId: string,
    input: UpdateProjectInput,
  ) {
    const index = this.projects.findIndex(
      (project) => project.id === projectId && project.userId === userId,
    );
    if (index < 0) return null;

    const updated = {
      ...this.projects[index]!,
      name: input.name,
      sourceText: input.sourceText,
      objective: input.objective,
      status: input.status,
      updatedAt: new Date(),
    };
    this.projects[index] = updated;
    return updated;
  }

  async listLinksForProject(projectId: string, userId: string) {
    const project = await this.findByIdForUser(projectId, userId);
    return project
      ? this.links.filter((link) => link.projectId === projectId)
      : [];
  }

  async createLink(input: CreateProjectLinkInput) {
    const project = await this.findByIdForUser(input.projectId, input.userId);
    if (!project) return null;

    const link: ProjectLink = {
      id: randomUUID(),
      projectId: input.projectId,
      name: input.name,
      url: input.url,
      createdAt: new Date(),
    };
    this.links.push(link);
    const projectIndex = this.projects.findIndex(
      (storedProject) => storedProject.id === input.projectId,
    );
    if (projectIndex >= 0) {
      this.projects[projectIndex] = {
        ...this.projects[projectIndex]!,
        updatedAt: new Date(),
      };
    }
    return link;
  }

  async deleteLink(projectId: string, linkId: string, userId: string) {
    const project = await this.findByIdForUser(projectId, userId);
    if (!project) return false;
    const index = this.links.findIndex(
      (link) => link.id === linkId && link.projectId === projectId,
    );
    if (index < 0) return false;
    this.links.splice(index, 1);
    const projectIndex = this.projects.findIndex(
      (storedProject) => storedProject.id === projectId,
    );
    if (projectIndex >= 0) {
      this.projects[projectIndex] = {
        ...this.projects[projectIndex]!,
        updatedAt: new Date(),
      };
    }
    return true;
  }
}

class StubTextImprover implements ProjectTextImprover {
  readonly inputs: string[] = [];

  constructor(
    private readonly result: string | ProjectTextImproverError =
      "Texto claro y profesional.",
  ) {}

  async improve(text: string) {
    this.inputs.push(text);
    if (this.result instanceof ProjectTextImproverError) throw this.result;
    return this.result;
  }
}

function sessionCookie(userId: string) {
  return createSessionCookie(userId).split(";", 1)[0];
}

function testServer(
  projectStore = new MemoryArchitectProjectStore(),
  textImprover = new StubTextImprover(),
) {
  return {
    projectStore,
    textImprover,
    server: createServer(
      {},
      {
        authStore: new MemoryAuthStore(),
        architectProjectStore: projectStore,
        projectTextImprover: textImprover,
      },
    ),
  };
}

const validProject = {
  name: "Automatización de recibos",
  sourceText: "Aplicación para registrar gastos desde una fotografía.",
  objective: "Guardar un gasto estructurado desde un recibo.",
  status: "in_progress" as const,
};

test("authentication is required for project and tool operations", async () => {
  const { server } = testServer();
  const projectId = randomUUID();
  const linkId = randomUUID();

  try {
    const responses = await Promise.all([
      server.inject({ method: "GET", url: "/architect/projects" }),
      server.inject({ method: "POST", url: "/architect/projects", payload: validProject }),
      server.inject({ method: "GET", url: `/architect/projects/${projectId}` }),
      server.inject({ method: "PATCH", url: `/architect/projects/${projectId}`, payload: validProject }),
      server.inject({ method: "POST", url: `/architect/projects/${projectId}/links`, payload: { name: "GitHub", url: "https://github.com/example/project" } }),
      server.inject({ method: "DELETE", url: `/architect/projects/${projectId}/links/${linkId}` }),
      server.inject({ method: "POST", url: "/architect/projects/improve-text", payload: { text: "hola" } }),
    ]);
    assert.ok(responses.every((response) => response.statusCode === 401));
  } finally {
    await server.close();
  }
});

test("a project is created for the session user with normalized fields", async () => {
  const { projectStore, server } = testServer();

  try {
    const response = await server.inject({
      method: "POST",
      url: "/architect/projects",
      headers: { cookie: sessionCookie(firstUser.id) },
      payload: {
        ...validProject,
        name: `  ${validProject.name}  `,
        userId: secondUser.id,
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(projectStore.projects[0]?.userId, firstUser.id);
    assert.equal(projectStore.projects[0]?.name, validProject.name);
    assert.equal(response.json().project.status, "in_progress");
    assert.equal(response.json().project.userId, undefined);
    assert.deepEqual(response.json().project.links, []);
  } finally {
    await server.close();
  }
});

test("projects list newest updates first, filters states, and isolates owners", async () => {
  const { projectStore, server } = testServer();
  projectStore.projects.push(
    projectRecord(
      { userId: firstUser.id, ...validProject, status: "idea" },
      { updatedAt: new Date("2026-01-01T10:00:00.000Z") },
    ),
    projectRecord(
      { userId: secondUser.id, ...validProject, status: "completed" },
      { updatedAt: new Date("2026-04-01T10:00:00.000Z") },
    ),
    projectRecord(
      { userId: firstUser.id, ...validProject, status: "completed" },
      { updatedAt: new Date("2026-03-01T10:00:00.000Z") },
    ),
  );

  try {
    const all = await server.inject({
      method: "GET",
      url: "/architect/projects",
      headers: { cookie: sessionCookie(firstUser.id) },
    });
    const completed = await server.inject({
      method: "GET",
      url: "/architect/projects?status=completed",
      headers: { cookie: sessionCookie(firstUser.id) },
    });

    assert.equal(all.statusCode, 200);
    assert.deepEqual(
      all.json().projects.map((project: { status: string }) => project.status),
      ["completed", "idea"],
    );
    assert.equal(completed.json().projects.length, 1);
    assert.equal(completed.json().projects[0].status, "completed");
  } finally {
    await server.close();
  }
});

test("project detail and updates are available only to the owner", async () => {
  const { projectStore, server } = testServer();
  const project = projectRecord({ userId: firstUser.id, ...validProject });
  projectStore.projects.push(project);

  try {
    const ownerDetail = await server.inject({
      method: "GET",
      url: `/architect/projects/${project.id}`,
      headers: { cookie: sessionCookie(firstUser.id) },
    });
    const foreignDetail = await server.inject({
      method: "GET",
      url: `/architect/projects/${project.id}`,
      headers: { cookie: sessionCookie(secondUser.id) },
    });
    const foreignUpdate = await server.inject({
      method: "PATCH",
      url: `/architect/projects/${project.id}`,
      headers: { cookie: sessionCookie(secondUser.id) },
      payload: { ...validProject, name: "Intrusión" },
    });
    const ownerUpdate = await server.inject({
      method: "PATCH",
      url: `/architect/projects/${project.id}`,
      headers: { cookie: sessionCookie(firstUser.id) },
      payload: { ...validProject, name: "Proyecto actualizado", status: "completed" },
    });

    assert.equal(ownerDetail.statusCode, 200);
    assert.equal(foreignDetail.statusCode, 404);
    assert.equal(foreignUpdate.statusCode, 404);
    assert.equal(ownerUpdate.statusCode, 200);
    assert.equal(ownerUpdate.json().project.name, "Proyecto actualizado");
    assert.equal(ownerUpdate.json().project.status, "completed");
  } finally {
    await server.close();
  }
});

test("tools can be created and deleted only through their owning project", async () => {
  const { projectStore, server } = testServer();
  const project = projectRecord({ userId: firstUser.id, ...validProject });
  projectStore.projects.push(project);

  try {
    const foreignCreate = await server.inject({
      method: "POST",
      url: `/architect/projects/${project.id}/links`,
      headers: { cookie: sessionCookie(secondUser.id) },
      payload: { name: "GitHub", url: "https://github.com/example/project" },
    });
    const creation = await server.inject({
      method: "POST",
      url: `/architect/projects/${project.id}/links`,
      headers: { cookie: sessionCookie(firstUser.id) },
      payload: { name: "GitHub", url: "https://github.com/example/project" },
    });
    const linkId = creation.json().link.id as string;
    const foreignDelete = await server.inject({
      method: "DELETE",
      url: `/architect/projects/${project.id}/links/${linkId}`,
      headers: { cookie: sessionCookie(secondUser.id) },
    });
    const ownerDelete = await server.inject({
      method: "DELETE",
      url: `/architect/projects/${project.id}/links/${linkId}`,
      headers: { cookie: sessionCookie(firstUser.id) },
    });

    assert.equal(foreignCreate.statusCode, 404);
    assert.equal(creation.statusCode, 201);
    assert.equal(creation.json().link.name, "GitHub");
    assert.equal(foreignDelete.statusCode, 404);
    assert.equal(ownerDelete.statusCode, 204);
    assert.equal(projectStore.links.length, 0);
  } finally {
    await server.close();
  }
});

test("text improvement sends only the requested field text to the injected provider", async () => {
  const improver = new StubTextImprover("Una versión mejorada.");
  const { server } = testServer(new MemoryArchitectProjectStore(), improver);

  try {
    const response = await server.inject({
      method: "POST",
      url: "/architect/projects/improve-text",
      headers: { cookie: sessionCookie(firstUser.id) },
      payload: { text: "  una idea repetida repetida  ", ignored: "no enviar" },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(improver.inputs, ["una idea repetida repetida"]);
    assert.deepEqual(response.json(), { improvedText: "Una versión mejorada." });
  } finally {
    await server.close();
  }
});

test("text improvement validates input and maps configuration and provider errors", async () => {
  const cookie = sessionCookie(firstUser.id);
  const missing = testServer(
    new MemoryArchitectProjectStore(),
    new StubTextImprover(new ProjectTextImproverError("not_configured")),
  );
  const provider = testServer(
    new MemoryArchitectProjectStore(),
    new StubTextImprover(new ProjectTextImproverError("provider_error")),
  );

  try {
    const empty = await missing.server.inject({
      method: "POST",
      url: "/architect/projects/improve-text",
      headers: { cookie },
      payload: { text: "   " },
    });
    const invalidPayload = await missing.server.inject({
      method: "POST",
      url: "/architect/projects/improve-text",
      headers: { cookie },
      payload: { text: 42 },
    });
    const tooLong = await missing.server.inject({
      method: "POST",
      url: "/architect/projects/improve-text",
      headers: { cookie },
      payload: { text: "a".repeat(10_001) },
    });
    const notConfigured = await missing.server.inject({
      method: "POST",
      url: "/architect/projects/improve-text",
      headers: { cookie },
      payload: { text: "Texto" },
    });
    const unavailable = await provider.server.inject({
      method: "POST",
      url: "/architect/projects/improve-text",
      headers: { cookie },
      payload: { text: "Texto" },
    });

    assert.equal(empty.statusCode, 400);
    assert.equal(invalidPayload.statusCode, 400);
    assert.equal(invalidPayload.json().error, "PROJECT_TEXT_REQUIRED");
    assert.equal(tooLong.statusCode, 400);
    assert.equal(tooLong.json().error, "PROJECT_TEXT_TOO_LONG");
    assert.equal(notConfigured.statusCode, 503);
    assert.equal(notConfigured.json().error, "AI_NOT_CONFIGURED");
    assert.equal(unavailable.statusCode, 502);
    assert.equal(unavailable.json().error, "AI_UNAVAILABLE");
  } finally {
    await missing.server.close();
    await provider.server.close();
  }
});

test("legacy competitions remain readable without rewriting historical rows", async () => {
  const { server } = testServer();

  try {
    const response = await server.inject({
      method: "POST",
      url: "/architect/projects",
      headers: { cookie: sessionCookie(firstUser.id) },
      payload: {
        sourceText: "Concurso heredado\nMás información",
        officialUrl: "https://example.com/competition",
      },
    });

    assert.equal(response.statusCode, 201);
    assert.equal(response.json().project.name, "Concurso heredado");
    assert.equal(response.json().project.status, "idea");
    assert.equal(response.json().project.officialUrl, "https://example.com/competition");
  } finally {
    await server.close();
  }
});

test("pre-0018 rows have safe feed fields and normalized status filters", async () => {
  const { projectStore, server } = testServer();
  const historicalCompetition = projectRecord(
    { userId: firstUser.id, ...validProject, status: "idea" },
    {
      projectType: "competition",
      name: null,
      sourceText: "Concurso histórico\nResumen conservado",
      objective: null,
      status: null,
      officialUrl: "https://example.com/historical",
      updatedAt: new Date("2026-03-01T10:00:00.000Z"),
    },
  );
  const historicalCompleted = projectRecord(
    { userId: firstUser.id, ...validProject, status: "idea" },
    {
      name: null,
      sourceText: "Proyecto analizado",
      objective: null,
      status: null,
      analysisStatus: "completed",
      structuredData: { preserved: true },
      updatedAt: new Date("2026-02-01T10:00:00.000Z"),
    },
  );
  const historicalBlank = projectRecord(
    { userId: firstUser.id, ...validProject, status: "idea" },
    {
      name: null,
      sourceText: null,
      objective: null,
      status: null,
      updatedAt: new Date("2026-01-01T10:00:00.000Z"),
    },
  );
  projectStore.projects.push(
    historicalCompetition,
    historicalCompleted,
    historicalBlank,
  );
  const cookie = sessionCookie(firstUser.id);

  try {
    const all = await server.inject({
      method: "GET",
      url: "/architect/projects",
      headers: { cookie },
    });
    const ideas = await server.inject({
      method: "GET",
      url: "/architect/projects?status=idea",
      headers: { cookie },
    });
    const completed = await server.inject({
      method: "GET",
      url: "/architect/projects?status=completed",
      headers: { cookie },
    });

    assert.equal(all.statusCode, 200);
    assert.deepEqual(
      all.json().projects.map(
        (project: {
          name: string;
          description: string;
          objective: string;
          status: string;
        }) => ({
          name: project.name,
          description: project.description,
          objective: project.objective,
          status: project.status,
        }),
      ),
      [
        {
          name: "Concurso histórico",
          description: "Concurso histórico\nResumen conservado",
          objective: "",
          status: "idea",
        },
        {
          name: "Proyecto analizado",
          description: "Proyecto analizado",
          objective: "",
          status: "completed",
        },
        {
          name: "Proyecto sin nombre",
          description: "",
          objective: "",
          status: "idea",
        },
      ],
    );
    assert.deepEqual(
      ideas.json().projects.map((project: { id: string }) => project.id),
      [historicalCompetition.id, historicalBlank.id],
    );
    assert.deepEqual(
      completed.json().projects.map((project: { id: string }) => project.id),
      [historicalCompleted.id],
    );
  } finally {
    await server.close();
  }
});

test("the Proyectos migration is additive and preserves historical columns", async () => {
  const migration = await readFile(
    new URL("../drizzle/0018_transform_architect_projects_to_projects.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /ADD COLUMN "name" text/);
  assert.match(migration, /CREATE TABLE "project_links"/);
  assert.doesNotMatch(migration, /(?:^|;)\s*(?:DROP|DELETE|TRUNCATE)\b/im);
});
