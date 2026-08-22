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
import type {
  LanguageLessonSource,
  LanguageLessonStatus,
  StructuredLanguageLesson,
} from "../languages/contracts.js";

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

export type ArchitectProjectType = "project" | "competition";

export type ArchitectAnalysisStatus = "pending" | "completed" | "failed";

export const architectProjects = pgTable(
  "architect_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    projectType: text("project_type").$type<ArchitectProjectType>().notNull(),
    sourceText: text("source_text"),
    officialUrl: text("official_url"),
    analysisStatus: text("analysis_status")
      .$type<ArchitectAnalysisStatus>()
      .default("pending")
      .notNull(),
    structuredData: jsonb("structured_data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userCreatedAtIdx: index("architect_projects_user_created_at_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    projectTypeCheck: check(
      "architect_projects_project_type_check",
      sql`${table.projectType} in ('project', 'competition')`,
    ),
    analysisStatusCheck: check(
      "architect_projects_analysis_status_check",
      sql`${table.analysisStatus} in ('pending', 'completed', 'failed')`,
    ),
    completedDataCheck: check(
      "architect_projects_completed_data_check",
      sql`${table.analysisStatus} <> 'completed' or ${table.structuredData} is not null`,
    ),
  }),
);

export type JourneySourceType =
  | "url"
  | "article"
  | "paper"
  | "pdf"
  | "book"
  | "video"
  | "personal_note"
  | "other";

export const journeyIdeas = pgTable(
  "journey_ideas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    sourceType: text("source_type").$type<JourneySourceType>().notNull(),
    sourceReference: text("source_reference").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userCreatedAtIdx: index("journey_ideas_user_created_at_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    sourceTypeCheck: check(
      "journey_ideas_source_type_check",
      sql`${table.sourceType} in ('url', 'article', 'paper', 'pdf', 'book', 'video', 'personal_note', 'other')`,
    ),
  }),
);

export const journeyFeedEntries = pgTable(
  "journey_feed_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ideaId: uuid("idea_id")
      .notNull()
      .references(() => journeyIdeas.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    ideaCreatedAtIdx: index("journey_feed_entries_idea_created_at_idx").on(
      table.ideaId,
      table.createdAt.desc(),
    ),
  }),
);

export const languageProjects = pgTable(
  "language_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    language: text("language").notNull(),
    level: text("level").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userCreatedAtIdx: index("language_projects_user_created_at_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
  }),
);

export const languageLessons = pgTable(
  "language_lessons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    languageProjectId: uuid("language_project_id")
      .notNull()
      .references(() => languageProjects.id, { onDelete: "cascade" }),
    lessonNumber: integer("lesson_number").notNull(),
    lessonSource: text("lesson_source")
      .$type<LanguageLessonSource>()
      .default("free")
      .notNull(),
    sourceContent: text("source_content").default("").notNull(),
    status: text("status")
      .$type<LanguageLessonStatus>()
      .default("draft")
      .notNull(),
    structuredContent: jsonb("structured_content").$type<StructuredLanguageLesson>(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    projectLessonNumberUnique: uniqueIndex(
      "language_lessons_project_number_unique",
    ).on(table.languageProjectId, table.lessonNumber),
    lessonNumberCheck: check(
      "language_lessons_number_check",
      sql`${table.lessonNumber} > 0`,
    ),
    lessonSourceCheck: check(
      "language_lessons_source_check",
      sql`${table.lessonSource} in ('assimil', 'language_framework', 'free')`,
    ),
    statusCheck: check(
      "language_lessons_status_check",
      sql`${table.status} in ('draft', 'processing', 'ready', 'failed')`,
    ),
    readyContentCheck: check(
      "language_lessons_ready_content_check",
      sql`${table.status} <> 'ready' or (${table.structuredContent} is not null and ${table.processedAt} is not null)`,
    ),
  }),
);
