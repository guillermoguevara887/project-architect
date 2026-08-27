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
  LanguageLessonDifficulty,
  LanguageLessonLearningStatus,
  LanguageLessonSource,
  LanguageLessonStatus,
  StructuredLanguageLesson,
} from "../languages/contracts.js";
import type {
  ExerciseStatus,
  ExerciseWorkspaceType,
  StructuredExerciseGuide,
} from "../exercises/contracts.js";

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

export const exercises = pgTable(
  "exercises",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceName: text("source_name"),
    chapter: text("chapter"),
    exerciseNumber: text("exercise_number"),
    prompt: text("prompt").notNull(),
    status: text("status")
      .$type<ExerciseStatus>()
      .default("pending")
      .notNull(),
    guideContent: text("guide_content"),
    guideStructuredContent: jsonb("guide_structured_content")
      .$type<StructuredExerciseGuide>(),
    guideGenerationCount: integer("guide_generation_count")
      .default(0)
      .notNull(),
    suggestedSteps: jsonb("suggested_steps").$type<string[]>(),
    workspaceType: text("workspace_type").$type<ExerciseWorkspaceType>(),
    workspaceValue: text("workspace_value"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userCreatedAtIdx: index("exercises_user_created_at_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    statusCheck: check(
      "exercises_status_check",
      sql`${table.status} in ('pending', 'working', 'solved')`,
    ),
    workspaceTypeCheck: check(
      "exercises_workspace_type_check",
      sql`${table.workspaceType} is null or ${table.workspaceType} in ('colab', 'local', 'url')`,
    ),
    workspacePairCheck: check(
      "exercises_workspace_pair_check",
      sql`(${table.workspaceType} is null and ${table.workspaceValue} is null) or (${table.workspaceType} is not null and ${table.workspaceValue} is not null)`,
    ),
    suggestedStepsCheck: check(
      "exercises_suggested_steps_check",
      sql`${table.suggestedSteps} is null or jsonb_typeof(${table.suggestedSteps}) = 'array'`,
    ),
    guideStructuredContentCheck: check(
      "exercises_guide_structured_content_check",
      sql`${table.guideStructuredContent} is null or jsonb_typeof(${table.guideStructuredContent}) = 'object'`,
    ),
    guideGenerationCountCheck: check(
      "exercises_guide_generation_count_check",
      sql`${table.guideGenerationCount} between 0 and 2`,
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
    sourceLessonNumber: integer("source_lesson_number").notNull(),
    sourceContent: text("source_content").default("").notNull(),
    status: text("status")
      .$type<LanguageLessonStatus>()
      .default("draft")
      .notNull(),
    learningStatus: text("learning_status")
      .$type<LanguageLessonLearningStatus>()
      .default("pending")
      .notNull(),
    difficulty: text("difficulty").$type<LanguageLessonDifficulty>(),
    structuredContent: jsonb("structured_content").$type<StructuredLanguageLesson>(),
    simplifiedStructuredContent: jsonb("simplified_structured_content")
      .$type<StructuredLanguageLesson>(),
    simplificationStartedAt: timestamp("simplification_started_at", {
      withTimezone: true,
    }),
    simplifiedAt: timestamp("simplified_at", { withTimezone: true }),
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
    projectSourceLessonNumberUnique: uniqueIndex(
      "language_lessons_project_source_number_unique",
    ).on(
      table.languageProjectId,
      table.lessonSource,
      table.sourceLessonNumber,
    ),
    lessonNumberCheck: check(
      "language_lessons_number_check",
      sql`${table.lessonNumber} > 0`,
    ),
    lessonSourceCheck: check(
      "language_lessons_source_check",
      sql`${table.lessonSource} in ('assimil', 'language_framework', 'free')`,
    ),
    sourceLessonNumberCheck: check(
      "language_lessons_source_number_check",
      sql`${table.sourceLessonNumber} > 0`,
    ),
    statusCheck: check(
      "language_lessons_status_check",
      sql`${table.status} in ('draft', 'processing', 'ready', 'failed')`,
    ),
    learningStatusCheck: check(
      "language_lessons_learning_status_check",
      sql`${table.learningStatus} in ('pending', 'in_progress', 'completed')`,
    ),
    difficultyCheck: check(
      "language_lessons_difficulty_check",
      sql`${table.difficulty} is null or ${table.difficulty} in ('easy', 'normal', 'hard')`,
    ),
    readyContentCheck: check(
      "language_lessons_ready_content_check",
      sql`${table.status} <> 'ready' or (${table.structuredContent} is not null and ${table.processedAt} is not null)`,
    ),
    simplifiedContentCheck: check(
      "language_lessons_simplified_content_check",
      sql`(${table.simplifiedStructuredContent} is null and ${table.simplifiedAt} is null) or (${table.simplifiedStructuredContent} is not null and ${table.simplifiedAt} is not null)`,
    ),
  }),
);

export type LanguageAudioAssetStatus = "generating" | "ready" | "failed";

export const languageAudioAssets = pgTable(
  "language_audio_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    normalizedText: text("normalized_text").notNull(),
    originalText: text("original_text").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    voice: text("voice").notNull(),
    audioFormat: text("audio_format").notNull(),
    storageKey: text("storage_key").notNull(),
    status: text("status")
      .$type<LanguageAudioAssetStatus>()
      .default("generating")
      .notNull(),
    generationStartedAt: timestamp("generation_started_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    cacheUnique: uniqueIndex("language_audio_assets_cache_unique").on(
      table.userId,
      table.language,
      table.normalizedText,
      table.provider,
      table.model,
      table.voice,
      table.audioFormat,
    ),
    storageKeyUnique: uniqueIndex(
      "language_audio_assets_storage_key_unique",
    ).on(table.storageKey),
    userCreatedAtIdx: index(
      "language_audio_assets_user_created_at_idx",
    ).on(table.userId, table.createdAt.desc()),
    statusCheck: check(
      "language_audio_assets_status_check",
      sql`${table.status} in ('generating', 'ready', 'failed')`,
    ),
    generationStateCheck: check(
      "language_audio_assets_generation_state_check",
      sql`(${table.status} = 'generating' and ${table.generationStartedAt} is not null) or (${table.status} <> 'generating' and ${table.generationStartedAt} is null)`,
    ),
  }),
);
