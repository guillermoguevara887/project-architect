import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const projectTypeEnum = pgEnum("project_type", [
  "research",
  "competition",
]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    projectType: projectTypeEnum("project_type").notNull(),
    globalObjective: text("global_objective").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    createdAtIdx: index("projects_created_at_idx").on(table.createdAt.desc()),
  }),
);

export const discoveryStatusEnum = pgEnum("discovery_status", [
  "not_started",
  "in_progress",
  "ready_for_review",
  "completed",
]);

export const discoveryQuestionTypeEnum = pgEnum("discovery_question_type", [
  "short_text",
  "long_text",
  "number",
  "date",
  "single_select",
  "multi_select",
  "yes_no",
]);

export const discoverySessions = pgTable(
  "discovery_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: discoveryStatusEnum("status").default("in_progress").notNull(),
    currentStep: integer("current_step").default(0).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    projectUnique: uniqueIndex("discovery_sessions_project_id_unique").on(
      table.projectId,
    ),
    statusIdx: index("discovery_sessions_status_idx").on(table.status),
    currentStepCheck: check(
      "discovery_sessions_current_step_check",
      sql`${table.currentStep} >= 0`,
    ),
  }),
);

export const discoveryQuestions = pgTable(
  "discovery_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    discoverySessionId: uuid("discovery_session_id")
      .notNull()
      .references(() => discoverySessions.id, { onDelete: "cascade" }),
    questionKey: text("question_key").notNull(),
    questionText: text("question_text").notNull(),
    category: text("category").notNull(),
    sectionKey: text("section_key").notNull(),
    sectionTitle: text("section_title").notNull(),
    questionType: discoveryQuestionTypeEnum("question_type").notNull(),
    options: jsonb("options").$type<string[] | null>(),
    position: integer("position").notNull(),
    sectionPosition: integer("section_position").notNull(),
    isRequired: boolean("is_required").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    sessionQuestionUnique: uniqueIndex(
      "discovery_questions_session_key_unique",
    ).on(table.discoverySessionId, table.questionKey),
    sessionPositionIdx: index(
      "discovery_questions_session_position_idx",
    ).on(table.discoverySessionId, table.sectionPosition, table.position),
    positionCheck: check(
      "discovery_questions_position_check",
      sql`${table.position} >= 0`,
    ),
    sectionPositionCheck: check(
      "discovery_questions_section_position_check",
      sql`${table.sectionPosition} >= 0`,
    ),
  }),
);

export const discoveryAnswers = pgTable(
  "discovery_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    questionId: uuid("question_id")
      .notNull()
      .references(() => discoveryQuestions.id, { onDelete: "cascade" }),
    answer: jsonb("answer").$type<string | number | boolean | string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    questionUnique: uniqueIndex("discovery_answers_question_id_unique").on(
      table.questionId,
    ),
  }),
);
