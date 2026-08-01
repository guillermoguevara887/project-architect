import assert from "node:assert/strict";
import test from "node:test";
import {
  DiscoveryAnswerValueSchema,
  DiscoveryStatusSchema,
  ProjectIdParamsSchema,
  ProjectsListResponseSchema,
  SaveDiscoveryAnswerRequestSchema,
} from "../src/index.js";

test("accepts every supported discovery answer shape", () => {
  const values = [
    "respuesta",
    42,
    true,
    ["opción A", "opción B"],
  ];

  for (const value of values) {
    assert.deepEqual(DiscoveryAnswerValueSchema.parse(value), value);
  }

  assert.equal(
    SaveDiscoveryAnswerRequestSchema.parse({ answer: null }).answer,
    null,
  );
});

test("rejects unsupported discovery answer objects", () => {
  assert.equal(
    DiscoveryAnswerValueSchema.safeParse({ arbitrary: "value" }).success,
    false,
  );
});

test("validates discovery statuses and project identifiers", () => {
  assert.equal(DiscoveryStatusSchema.parse("ready_for_review"), "ready_for_review");
  assert.equal(
    ProjectIdParamsSchema.safeParse({
      projectId: "not-a-uuid",
    }).success,
    false,
  );
});

test("project list responses require a discovery summary", () => {
  const parsed = ProjectsListResponseSchema.parse({
    projects: [
      {
        id: "89e5c65d-4a2f-4a99-af97-6db09ff9bd3e",
        name: "Proyecto",
        projectType: "research",
        globalObjective: "Investigar un fenómeno.",
        createdAt: "2026-07-27T12:00:00.000Z",
        updatedAt: "2026-07-27T12:00:00.000Z",
        discovery: {
          status: "in_progress",
          percentage: 40,
          currentStep: 2,
        },
      },
    ],
  });

  assert.equal(parsed.projects[0]?.discovery.percentage, 40);
});
