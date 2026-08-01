import { asc, eq } from "drizzle-orm";
import type {
  DiscoveryAnswer,
  DiscoveryQuestion,
  DiscoverySession,
  Project,
} from "@project-architect/contracts";
import { getDb } from "../db/client.js";
import {
  discoveryAnswers,
  discoveryQuestions,
  discoverySessions,
  projects,
} from "../db/schema.js";
import type {
  DiscoveryQuestionOwnership,
  DiscoverySessionPatch,
  DiscoverySnapshot,
  DiscoveryStore,
  MaterializedDiscoveryQuestion,
} from "./service.js";

type ProjectRow = typeof projects.$inferSelect;
type DiscoverySessionRow = typeof discoverySessions.$inferSelect;
type DiscoveryQuestionRow = typeof discoveryQuestions.$inferSelect;
type DiscoveryAnswerRow = typeof discoveryAnswers.$inferSelect;

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    projectType: row.projectType,
    globalObjective: row.globalObjective,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSession(row: DiscoverySessionRow): DiscoverySession {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    currentStep: row.currentStep,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toAnswer(row: DiscoveryAnswerRow): DiscoveryAnswer {
  return {
    id: row.id,
    questionId: row.questionId,
    answer: row.answer,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toQuestion(
  row: DiscoveryQuestionRow,
  answer: DiscoveryAnswerRow | null,
): DiscoveryQuestion {
  return {
    id: row.id,
    discoverySessionId: row.discoverySessionId,
    questionKey: row.questionKey,
    questionText: row.questionText,
    category: row.category,
    sectionKey: row.sectionKey,
    sectionTitle: row.sectionTitle,
    questionType: row.questionType,
    options: row.options ?? null,
    position: row.position,
    sectionPosition: row.sectionPosition,
    isRequired: row.isRequired,
    createdAt: row.createdAt.toISOString(),
    answer: answer ? toAnswer(answer) : null,
  };
}

async function findProject(projectId: string): Promise<Project | null> {
  const db = getDb();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  return project ? toProject(project) : null;
}

async function ensureSession(
  projectId: string,
  questions: MaterializedDiscoveryQuestion[],
) {
  const db = getDb();

  await db.transaction(async (transaction) => {
    const [insertedSession] = await transaction
      .insert(discoverySessions)
      .values({
        projectId,
        status: "in_progress",
      })
      .onConflictDoNothing({
        target: discoverySessions.projectId,
      })
      .returning();

    const session =
      insertedSession ??
      (
        await transaction
          .select()
          .from(discoverySessions)
          .where(eq(discoverySessions.projectId, projectId))
          .limit(1)
      )[0];

    if (!session) {
      throw new Error("Discovery session could not be created or loaded.");
    }

    if (questions.length === 0) {
      return;
    }

    await transaction
      .insert(discoveryQuestions)
      .values(
        questions.map((question) => ({
          discoverySessionId: session.id,
          ...question,
        })),
      )
      .onConflictDoNothing({
        target: [
          discoveryQuestions.discoverySessionId,
          discoveryQuestions.questionKey,
        ],
      });
  });
}

async function getSnapshot(
  projectId: string,
): Promise<DiscoverySnapshot | null> {
  const db = getDb();
  const project = await findProject(projectId);

  if (!project) {
    return null;
  }

  const [sessionRow] = await db
    .select()
    .from(discoverySessions)
    .where(eq(discoverySessions.projectId, projectId))
    .limit(1);

  if (!sessionRow) {
    return null;
  }

  const rows = await db
    .select({
      question: discoveryQuestions,
      answer: discoveryAnswers,
    })
    .from(discoveryQuestions)
    .leftJoin(
      discoveryAnswers,
      eq(discoveryAnswers.questionId, discoveryQuestions.id),
    )
    .where(eq(discoveryQuestions.discoverySessionId, sessionRow.id))
    .orderBy(
      asc(discoveryQuestions.sectionPosition),
      asc(discoveryQuestions.position),
    );

  return {
    project,
    session: toSession(sessionRow),
    questions: rows.map((row) =>
      toQuestion(row.question, row.answer),
    ),
  };
}

async function findQuestion(
  questionId: string,
): Promise<DiscoveryQuestionOwnership | null> {
  const db = getDb();
  const [row] = await db
    .select({
      question: discoveryQuestions,
      projectId: discoverySessions.projectId,
      answer: discoveryAnswers,
    })
    .from(discoveryQuestions)
    .innerJoin(
      discoverySessions,
      eq(discoverySessions.id, discoveryQuestions.discoverySessionId),
    )
    .leftJoin(
      discoveryAnswers,
      eq(discoveryAnswers.questionId, discoveryQuestions.id),
    )
    .where(eq(discoveryQuestions.id, questionId))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    projectId: row.projectId,
    question: toQuestion(row.question, row.answer),
  };
}

async function upsertAnswer(
  questionId: string,
  answer: DiscoveryAnswer["answer"],
): Promise<DiscoveryAnswer> {
  const db = getDb();
  const [savedAnswer] = await db
    .insert(discoveryAnswers)
    .values({
      questionId,
      answer,
    })
    .onConflictDoUpdate({
      target: discoveryAnswers.questionId,
      set: {
        answer,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!savedAnswer) {
    throw new Error("Discovery answer could not be saved.");
  }

  return toAnswer(savedAnswer);
}

async function deleteAnswer(questionId: string) {
  const db = getDb();
  await db
    .delete(discoveryAnswers)
    .where(eq(discoveryAnswers.questionId, questionId));
}

async function updateSession(
  projectId: string,
  patch: DiscoverySessionPatch,
): Promise<DiscoverySession | null> {
  const db = getDb();
  const values: Partial<typeof discoverySessions.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (patch.status !== undefined) {
    values.status = patch.status;
  }

  if (patch.currentStep !== undefined) {
    values.currentStep = patch.currentStep;
  }

  if (patch.completedAt !== undefined) {
    values.completedAt = patch.completedAt
      ? new Date(patch.completedAt)
      : null;
  }

  const [session] = await db
    .update(discoverySessions)
    .set(values)
    .where(eq(discoverySessions.projectId, projectId))
    .returning();

  return session ? toSession(session) : null;
}

export const discoveryStore: DiscoveryStore = {
  findProject,
  ensureSession,
  getSnapshot,
  findQuestion,
  upsertAnswer,
  deleteAnswer,
  updateSession,
};
