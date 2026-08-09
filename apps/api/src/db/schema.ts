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

type StoredDiscoveryAnswerValue = string | number | boolean | string[];

type StoredDiscoveryQuestionPriority =
  | "essential"
  | "recommended"
  | "optional";

type StoredDiscoveryQuestionCondition = {
  dependsOnQuestionKey: string;
  operator: "equals" | "not_equals" | "includes" | "not_includes";
  value: string | number | boolean;
};

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

export type DiscoveryQuestionResponseConfig = {
  version: 2;
  options: string[] | null;
  helpText: string | null;
  placeholder: string | null;
  priority: StoredDiscoveryQuestionPriority;
  condition: StoredDiscoveryQuestionCondition | null;
  allowOther: boolean;
  otherOptionLabel: string | null;
  minValue: number | null;
  maxValue: number | null;
};

export type StoredDiscoveryAnswer =
  | StoredDiscoveryAnswerValue
  | {
      value: StoredDiscoveryAnswerValue;
      otherText: string;
    };

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
    options: jsonb("options").$type<
      string[] | DiscoveryQuestionResponseConfig | null
    >(),
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
    answer: jsonb("answer").$type<StoredDiscoveryAnswer>().notNull(),
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

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    usernameUnique: uniqueIndex("users_username_unique").on(table.username),
  }),
);
