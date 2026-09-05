import assert from "node:assert/strict";
import { after, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { closeDbConnection } from "../../src/db/client.js";
import {
  bootstrapLegacyMigrationHistory,
  checksumMigrationSql,
  getMigrationStatus,
  loadMigrationFiles,
  migratePending,
  type MigrationFile,
} from "../../src/db/migrations.js";
import { createPostgresMigrationDatabase } from "../../src/db/postgres-migration-database.js";
import type { AssimilLanguageLessonContent } from "../../src/languages/contracts.js";
import {
  AssimilLanguageLessonNumberExistsError,
  languageStore,
} from "../../src/languages/repository.js";
import { curriculumDocumentStore } from "../../src/languages/documents/repository.js";

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

if (!databaseUrl || process.env.MIGRATION_TEST_ALLOW_LOCAL !== "1") {
  throw new Error(
    "PostgreSQL migration integration tests require the explicit local test environment.",
  );
}

const parsedDatabaseUrl = new URL(databaseUrl);
const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
const migrationDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "drizzle",
);

if (
  !allowedHosts.has(parsedDatabaseUrl.hostname) ||
  parsedDatabaseUrl.pathname !== "/memoos_migration_admin"
) {
  throw new Error(
    "Refusing to run migration integration tests outside the disposable local database.",
  );
}

const admin = postgres(databaseUrl, { max: 1 });
let databaseCounter = 0;

after(async () => {
  await admin.end({ timeout: 5 });
});

function migration(id: string, sql: string) {
  return {
    id,
    sql,
    checksum: checksumMigrationSql(sql),
  } satisfies MigrationFile;
}

async function createIsolatedDatabase(label: string) {
  databaseCounter += 1;
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const name = `memoos_it_${process.pid}_${databaseCounter}_${safeLabel}`;

  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error("Unsafe integration database name.");
  }

  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.pathname = `/${name}`;
  return isolatedUrl.toString();
}

async function withSql<T>(
  isolatedUrl: string,
  operation: (sql: postgres.Sql) => Promise<T>,
) {
  const sql = postgres(isolatedUrl, { max: 1 });

  try {
    return await operation(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test("real PostgreSQL applies whole SQL files in order and never repeats them", async () => {
  const isolatedUrl = await createIsolatedDatabase("ordered");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const first = migration(
    "0000_first.sql",
    `
      CREATE TABLE ordered_first (id integer PRIMARY KEY);
      CREATE FUNCTION semicolon_probe() RETURNS integer
      LANGUAGE plpgsql
      AS $$
      BEGIN
        PERFORM 1;
        PERFORM 2;
        RETURN 3;
      END;
      $$;
    `,
  );
  const second = migration(
    "0001_second.sql",
    "CREATE TABLE ordered_second (id integer PRIMARY KEY);",
  );

  try {
    const applied = await migratePending(database, [second, first]);
    assert.deepEqual(applied, [first.id, second.id]);
    assert.deepEqual(await migratePending(database, [first, second]), []);

    const report = await getMigrationStatus(database, [first, second]);
    assert.deepEqual(
      report.migrations.map(({ id, state }) => ({ id, state })),
      [
        { id: first.id, state: "applied" },
        { id: second.id, state: "applied" },
      ],
    );

    const functionResult = await withSql(isolatedUrl, (sql) =>
      sql<Array<{ value: number }>>`
        SELECT semicolon_probe() AS value
      `,
    );
    assert.equal(functionResult[0]?.value, 3);
  } finally {
    await database.close();
  }
});

test("real PostgreSQL rolls back failed migration SQL and its history row", async () => {
  const isolatedUrl = await createIsolatedDatabase("rollback");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const failing = migration(
    "0000_failing.sql",
    `
      CREATE TABLE rollback_probe (id integer PRIMARY KEY);
      SELECT 1 / 0;
    `,
  );

  try {
    await assert.rejects(migratePending(database, [failing]), /division by zero/i);

    const state = await withSql(isolatedUrl, async (sql) => {
      const [table] = await sql<Array<{ name: string | null }>>`
        SELECT to_regclass('public.rollback_probe')::text AS name
      `;
      const history = await sql<Array<{ count: number }>>`
        SELECT count(*)::integer AS count FROM schema_migrations
      `;
      return { table: table?.name, historyCount: history[0]?.count };
    });

    assert.equal(state.table, null);
    assert.equal(state.historyCount, 0);
  } finally {
    await database.close();
  }
});

test("real PostgreSQL rejects a changed checksum", async () => {
  const isolatedUrl = await createIsolatedDatabase("checksum");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const original = migration(
    "0000_checksum.sql",
    "CREATE TABLE checksum_probe (id integer PRIMARY KEY);",
  );
  const modified = migration(
    original.id,
    "CREATE TABLE checksum_probe (id bigint PRIMARY KEY);",
  );

  try {
    await migratePending(database, [original]);
    await assert.rejects(
      migratePending(database, [modified]),
      /Checksum mismatch.*0000_checksum\.sql/,
    );
  } finally {
    await database.close();
  }
});

test("the PostgreSQL advisory lock serializes two real migrators", async () => {
  const isolatedUrl = await createIsolatedDatabase("lock");
  const firstDatabase = createPostgresMigrationDatabase(isolatedUrl);
  const secondDatabase = createPostgresMigrationDatabase(isolatedUrl);
  const file = migration(
    "0000_lock.sql",
    `
      SELECT pg_sleep(0.25);
      CREATE TABLE lock_probe (id integer PRIMARY KEY);
    `,
  );

  try {
    const results = await Promise.all([
      migratePending(firstDatabase, [file]),
      migratePending(secondDatabase, [file]),
    ]);

    assert.equal(results.filter((result) => result.length === 1).length, 1);
    assert.equal(results.filter((result) => result.length === 0).length, 1);
  } finally {
    await firstDatabase.close();
    await secondDatabase.close();
  }
});

test("legacy PostgreSQL history requires bootstrap before pending SQL runs", async () => {
  const isolatedUrl = await createIsolatedDatabase("bootstrap");
  const first = migration(
    "0000_legacy.sql",
    "CREATE TABLE legacy_probe (id integer PRIMARY KEY);",
  );
  const second = migration(
    "0001_pending.sql",
    "CREATE TABLE pending_probe (id integer PRIMARY KEY);",
  );

  await withSql(isolatedUrl, async (sql) => {
    await sql.unsafe(first.sql);
    await sql`
      CREATE TABLE schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamp with time zone DEFAULT now() NOT NULL
      )
    `;
    await sql`
      INSERT INTO schema_migrations (id) VALUES (${first.id})
    `;
  });

  const database = createPostgresMigrationDatabase(isolatedUrl);

  try {
    const legacyStatus = await getMigrationStatus(database, [first, second]);
    assert.equal(legacyStatus.historyMode, "legacy");
    assert.deepEqual(
      legacyStatus.migrations.map((entry) => entry.state),
      ["unverified", "pending"],
    );
    await assert.rejects(
      migratePending(database, [first, second]),
      /Legacy migration history detected/,
    );

    assert.deepEqual(
      await bootstrapLegacyMigrationHistory(database, [first, second]),
      [first.id],
    );
    assert.deepEqual(await migratePending(database, [first, second]), [second.id]);

    const state = await withSql(isolatedUrl, async (sql) => {
      const history = await sql<
        Array<{ id: string; checksum: string; nullable: string }>
      >`
        SELECT migrations.id,
               migrations.checksum,
               columns.is_nullable AS nullable
        FROM schema_migrations AS migrations
        JOIN information_schema.columns AS columns
          ON columns.table_schema = current_schema()
         AND columns.table_name = 'schema_migrations'
         AND columns.column_name = 'checksum'
        ORDER BY migrations.id
      `;
      const [pendingTable] = await sql<Array<{ name: string | null }>>`
        SELECT to_regclass('public.pending_probe')::text AS name
      `;
      return { history, pendingTable: pendingTable?.name };
    });

    assert.deepEqual(
      state.history.map(({ id, checksum, nullable }) => ({
        id,
        checksumMatches:
          checksum === (id === first.id ? first.checksum : second.checksum),
        nullable,
      })),
      [
        { id: first.id, checksumMatches: true, nullable: "NO" },
        { id: second.id, checksumMatches: true, nullable: "NO" },
      ],
    );
    assert.equal(state.pendingTable, "pending_probe");
  } finally {
    await database.close();
  }
});

test("the real MemoOS migration chain safely upgrades existing language lessons", async () => {
  const isolatedUrl = await createIsolatedDatabase("language_phase_3_source");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const sourceMigrationId = "0007_add_language_lesson_source.sql";
  const sourceMigrationIndex = migrations.findIndex(
    ({ id }) => id === sourceMigrationId,
  );
  const userId = "5d17bcbe-7cb8-4a5f-93ba-42c0f97b2e5f";
  const projectId = "090820ae-5278-4e4c-b272-35de08cabd8a";
  const lessonId = "ff3c792f-f9cf-44cb-9223-1f6c6e9e509f";

  try {
    assert.notEqual(sourceMigrationIndex, -1);
    const migrationsBeforeSource = migrations.slice(0, sourceMigrationIndex);
    const migrationsThroughSource = migrations.slice(0, sourceMigrationIndex + 1);
    assert.deepEqual(
      await migratePending(database, migrationsBeforeSource),
      migrationsBeforeSource.map((migrationFile) => migrationFile.id),
    );

    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'migration-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO language_projects (id, user_id, language, level)
        VALUES (${projectId}, ${userId}, 'Alemán', 'Nivel 2')
      `;
      await sql`
        INSERT INTO language_lessons (
          id,
          language_project_id,
          lesson_number,
          source_content
        )
        VALUES (${lessonId}, ${projectId}, 1, 'Bestehendes Material')
      `;
    });

    assert.deepEqual(await migratePending(database, migrationsThroughSource), [
      sourceMigrationId,
    ]);

    const state = await withSql(isolatedUrl, async (sql) => {
      const [lesson] = await sql<
        Array<{
          status: string;
          lessonSource: string;
          sourceContent: string;
          structuredContent: unknown;
          processedAt: Date | null;
        }>
      >`
        SELECT status,
               lesson_source AS "lessonSource",
               source_content AS "sourceContent",
               structured_content AS "structuredContent",
               processed_at AS "processedAt"
        FROM language_lessons
        WHERE id = ${lessonId}
      `;
      const [history] = await sql<Array<{ count: number }>>`
        SELECT count(*)::integer AS count FROM schema_migrations
      `;
      const constraints = await sql<Array<{ name: string }>>`
        SELECT conname AS name
        FROM pg_constraint
        WHERE conrelid = 'language_lessons'::regclass
          AND conname IN (
            'language_lessons_status_check',
            'language_lessons_ready_content_check',
            'language_lessons_source_check'
          )
        ORDER BY conname
      `;

      await assert.rejects(
        sql`
          UPDATE language_lessons
          SET status = 'ready'
          WHERE id = ${lessonId}
        `,
        /language_lessons_ready_content_check/i,
      );

      return { lesson, history, constraints };
    });

    assert.deepEqual(state.lesson, {
      status: "draft",
      lessonSource: "free",
      sourceContent: "Bestehendes Material",
      structuredContent: null,
      processedAt: null,
    });
    assert.equal(state.history?.count, migrationsThroughSource.length);
    assert.deepEqual(
      state.constraints.map(({ name }) => name),
      [
        "language_lessons_ready_content_check",
        "language_lessons_source_check",
        "language_lessons_status_check",
      ],
    );

    const report = await getMigrationStatus(database, migrationsThroughSource);
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state: status }) => status === "applied"));
  } finally {
    await database.close();
  }
});

test("Assimil repository persists manual numbering, exact source and independent JSON content", async () => {
  const isolatedUrl = await createIsolatedDatabase("assimil_repository");
  const migrationDatabase = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const userId = "d4a76f2a-4ad6-4f46-9861-68abdfbd7412";
  const projectId = "63eff9cf-9565-4e7f-a53e-2eced0c1ea93";
  const exactSource = "  Guten Morgen.\nIch bin müde. Bis morgen.  ";
  const content: AssimilLanguageLessonContent = {
    kind: "assimil_v1",
    comprehension: [
      { line: "Guten Morgen.", translation: "Buenos días.", note: null },
    ],
    notes: [
      { title: "Gruß", explanation: "Saludo de mañana." },
      { title: "sein", explanation: "Bin es la primera persona." },
      { title: "müde", explanation: "Expresa cansancio." },
    ],
    patterns: [
      {
        pattern: "Ich bin …",
        explanation: "Describe un estado.",
        examples: ["Ich bin müde."],
      },
    ],
    keyPhrases: [
      { text: "Guten Morgen.", meaning: "Buenos días." },
      { text: "Ich bin müde.", meaning: "Estoy cansado." },
      { text: "Bis morgen.", meaning: "Hasta mañana." },
    ],
    practice: {
      instructions: "Completa.",
      items: [
        { prompt: "Ich ___ müde.", answer: "bin" },
        { prompt: "Bis ___.", answer: "morgen" },
      ],
    },
    review: null,
  };

  try {
    await migratePending(migrationDatabase, migrations);
    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'assimil-repository-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO language_projects (id, user_id, language, level)
        VALUES (${projectId}, ${userId}, 'Deutsch', 'A1')
      `;
    });

    process.env.DATABASE_URL = isolatedUrl;
    const assimil15 = await languageStore.createNextLesson({
      languageProjectId: projectId,
      userId,
      lessonSource: "assimil",
      sourceLessonNumber: 15,
    });
    const framework = await languageStore.createNextLesson({
      languageProjectId: projectId,
      userId,
      lessonSource: "language_framework",
    });
    const assimil2 = await languageStore.createNextLesson({
      languageProjectId: projectId,
      userId,
      lessonSource: "assimil",
      sourceLessonNumber: 2,
    });
    const free = await languageStore.createNextLesson({
      languageProjectId: projectId,
      userId,
      lessonSource: "free",
    });
    assert.ok(assimil15 && framework && assimil2 && free);
    assert.deepEqual(
      [assimil15, framework, assimil2, free].map(
        ({ lessonNumber, sourceLessonNumber }) => ({
          lessonNumber,
          sourceLessonNumber,
        }),
      ),
      [
        { lessonNumber: 1, sourceLessonNumber: 15 },
        { lessonNumber: 2, sourceLessonNumber: 1 },
        { lessonNumber: 3, sourceLessonNumber: 2 },
        { lessonNumber: 4, sourceLessonNumber: 1 },
      ],
    );

    await assert.rejects(
      languageStore.createNextLesson({
        languageProjectId: projectId,
        userId,
        lessonSource: "assimil",
        sourceLessonNumber: 15,
      }),
      AssimilLanguageLessonNumberExistsError,
    );

    const claim = await languageStore.claimAssimilLessonForProcessing({
      languageProjectId: projectId,
      lessonId: assimil15.id,
      userId,
      sourceContent: exactSource,
    });
    assert.equal(claim.kind, "claimed");
    if (claim.kind !== "claimed") assert.fail("Expected Assimil claim.");
    assert.equal(claim.lesson.sourceContent, exactSource);

    const completed = await languageStore.completeAssimilLessonProcessing({
      languageProjectId: projectId,
      lessonId: assimil15.id,
      userId,
      processingStartedAt: claim.lesson.updatedAt,
      structuredContent: content,
    });
    assert.ok(completed);
    assert.equal(completed.sourceContent, exactSource);
    assert.deepEqual(completed.structuredContent, content);
    assert.equal(completed.lessonNumber, 1);
    assert.equal(completed.sourceLessonNumber, 15);
    assert.equal(completed.status, "ready");

    const reloaded = await languageStore.findLessonByIdForUser(
      assimil15.id,
      projectId,
      userId,
    );
    assert.ok(reloaded);
    assert.equal(reloaded.sourceContent, exactSource);
    assert.deepEqual(reloaded.structuredContent, content);
  } finally {
    await closeDbConnection();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await migrationDatabase.close();
  }
});

test("source lesson numbers are backfilled independently without changing general order", async () => {
  const isolatedUrl = await createIsolatedDatabase("language_phase_3_source_number");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const sourceNumberMigrationId =
    "0008_add_language_lesson_source_number.sql";
  const sourceNumberMigrationIndex = migrations.findIndex(
    ({ id }) => id === sourceNumberMigrationId,
  );
  const userId = "6e28cdcf-8dc9-4b70-a6cb-870d219acd60";
  const projectId = "1a1931bf-6389-46a0-bddd-28d88b22e7e2";
  const seededLessons = [
    {
      id: "10000000-0000-4000-8000-000000000001",
      lessonNumber: 1,
      lessonSource: "assimil",
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      lessonNumber: 2,
      lessonSource: "language_framework",
    },
    {
      id: "10000000-0000-4000-8000-000000000003",
      lessonNumber: 3,
      lessonSource: "assimil",
    },
    {
      id: "10000000-0000-4000-8000-000000000004",
      lessonNumber: 4,
      lessonSource: "free",
    },
    {
      id: "10000000-0000-4000-8000-000000000005",
      lessonNumber: 5,
      lessonSource: "language_framework",
    },
  ];

  try {
    assert.equal(
      migrations[sourceNumberMigrationIndex]?.id,
      sourceNumberMigrationId,
    );
    const migrationsBeforeSourceNumber = migrations.slice(
      0,
      sourceNumberMigrationIndex,
    );
    const migrationsThroughSourceNumber = migrations.slice(
      0,
      sourceNumberMigrationIndex + 1,
    );
    assert.deepEqual(
      await migratePending(database, migrationsBeforeSourceNumber),
      migrationsBeforeSourceNumber.map((migrationFile) => migrationFile.id),
    );

    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'source-number-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO language_projects (id, user_id, language, level)
        VALUES (${projectId}, ${userId}, 'Alemán', 'Nivel 2')
      `;

      for (const lesson of seededLessons) {
        await sql`
          INSERT INTO language_lessons (
            id,
            language_project_id,
            lesson_number,
            lesson_source
          )
          VALUES (
            ${lesson.id},
            ${projectId},
            ${lesson.lessonNumber},
            ${lesson.lessonSource}
          )
        `;
      }
    });

    assert.deepEqual(
      await migratePending(database, migrationsThroughSourceNumber),
      [sourceNumberMigrationId],
    );

    const state = await withSql(isolatedUrl, async (sql) => {
      const lessons = await sql<
        Array<{
          id: string;
          lessonNumber: number;
          lessonSource: string;
          sourceLessonNumber: number;
        }>
      >`
        SELECT id,
               lesson_number AS "lessonNumber",
               lesson_source AS "lessonSource",
               source_lesson_number AS "sourceLessonNumber"
        FROM language_lessons
        WHERE language_project_id = ${projectId}
        ORDER BY lesson_number
      `;
      const constraints = await sql<Array<{ name: string }>>`
        SELECT conname AS name
        FROM pg_constraint
        WHERE conrelid = 'language_lessons'::regclass
          AND conname = 'language_lessons_source_number_check'
      `;
      const indexes = await sql<Array<{ name: string }>>`
        SELECT indexname AS name
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'language_lessons'
          AND indexname = 'language_lessons_project_source_number_unique'
      `;
      const [sourceNumberColumn] = await sql<
        Array<{ isNullable: "YES" | "NO" }>
      >`
        SELECT is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'language_lessons'
          AND column_name = 'source_lesson_number'
      `;

      await assert.rejects(
        sql`
          INSERT INTO language_lessons (
            id,
            language_project_id,
            lesson_number,
            lesson_source,
            source_lesson_number
          )
          VALUES (
            '10000000-0000-4000-8000-000000000006',
            ${projectId},
            6,
            'assimil',
            1
          )
        `,
        /language_lessons_project_source_number_unique/i,
      );

      return { lessons, constraints, indexes, sourceNumberColumn };
    });

    assert.deepEqual(
      state.lessons.map(
        ({ lessonNumber, lessonSource, sourceLessonNumber }) => ({
          lessonNumber,
          lessonSource,
          sourceLessonNumber,
        }),
      ),
      [
        {
          lessonNumber: 1,
          lessonSource: "assimil",
          sourceLessonNumber: 1,
        },
        {
          lessonNumber: 2,
          lessonSource: "language_framework",
          sourceLessonNumber: 1,
        },
        {
          lessonNumber: 3,
          lessonSource: "assimil",
          sourceLessonNumber: 2,
        },
        { lessonNumber: 4, lessonSource: "free", sourceLessonNumber: 1 },
        {
          lessonNumber: 5,
          lessonSource: "language_framework",
          sourceLessonNumber: 2,
        },
      ],
    );
    assert.deepEqual(
      state.constraints.map(({ name }) => name),
      ["language_lessons_source_number_check"],
    );
    assert.deepEqual(
      state.indexes.map(({ name }) => name),
      ["language_lessons_project_source_number_unique"],
    );
    assert.equal(state.sourceNumberColumn?.isNullable, "NO");

    const report = await getMigrationStatus(
      database,
      migrationsThroughSourceNumber,
    );
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state: status }) => status === "applied"));
  } finally {
    await database.close();
  }
});

test("language lesson simplification columns are nullable and preserve existing ready content", async () => {
  const isolatedUrl = await createIsolatedDatabase(
    "language_phase_3_simplification",
  );
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const simplificationMigrationId =
    "0009_add_language_lesson_simplification.sql";
  const simplificationMigrationIndex = migrations.findIndex(
    ({ id }) => id === simplificationMigrationId,
  );
  const userId = "70000000-0000-4000-8000-000000000001";
  const projectId = "70000000-0000-4000-8000-000000000002";
  const lessonId = "70000000-0000-4000-8000-000000000003";
  const originalContent = { version: "original", sectionCount: 8 };

  try {
    assert.equal(
      migrations[simplificationMigrationIndex + 1]?.id,
      "0010_create_language_audio_assets.sql",
    );
    const migrationsBeforeSimplification = migrations.slice(
      0,
      simplificationMigrationIndex,
    );
    const migrationsThroughSimplification = migrations.slice(
      0,
      simplificationMigrationIndex + 1,
    );
    assert.deepEqual(
      await migratePending(database, migrationsBeforeSimplification),
      migrationsBeforeSimplification.map(({ id }) => id),
    );

    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'simplification-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO language_projects (id, user_id, language, level)
        VALUES (${projectId}, ${userId}, 'Alemán', 'Nivel 2')
      `;
      await sql`
        INSERT INTO language_lessons (
          id,
          language_project_id,
          lesson_number,
          lesson_source,
          source_lesson_number,
          status,
          structured_content,
          processed_at
        )
        VALUES (
          ${lessonId},
          ${projectId},
          1,
          'free',
          1,
          'ready',
          ${sql.json(originalContent)},
          now()
        )
      `;
    });

    assert.deepEqual(
      await migratePending(database, migrationsThroughSimplification),
      [simplificationMigrationId],
    );

    const state = await withSql(isolatedUrl, async (sql) => {
      const [lesson] = await sql<
        Array<{
          structuredContent: unknown;
          simplifiedStructuredContent: unknown;
          simplificationStartedAt: Date | null;
          simplifiedAt: Date | null;
        }>
      >`
        SELECT structured_content AS "structuredContent",
               simplified_structured_content AS "simplifiedStructuredContent",
               simplification_started_at AS "simplificationStartedAt",
               simplified_at AS "simplifiedAt"
        FROM language_lessons
        WHERE id = ${lessonId}
      `;
      const columns = await sql<
        Array<{ name: string; isNullable: "YES" | "NO" }>
      >`
        SELECT column_name AS name, is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'language_lessons'
          AND column_name IN (
            'simplified_structured_content',
            'simplification_started_at',
            'simplified_at'
          )
        ORDER BY column_name
      `;
      const constraints = await sql<Array<{ name: string }>>`
        SELECT conname AS name
        FROM pg_constraint
        WHERE conrelid = 'language_lessons'::regclass
          AND conname = 'language_lessons_simplified_content_check'
      `;

      await assert.rejects(
        sql`
          UPDATE language_lessons
          SET simplified_structured_content = '{"version":"simplified"}'::jsonb
          WHERE id = ${lessonId}
        `,
        /language_lessons_simplified_content_check/i,
      );

      return { lesson, columns, constraints };
    });

    assert.deepEqual(state.lesson, {
      structuredContent: originalContent,
      simplifiedStructuredContent: null,
      simplificationStartedAt: null,
      simplifiedAt: null,
    });
    assert.deepEqual(
      state.columns.map(({ name, isNullable }) => ({ name, isNullable })),
      [
        { name: "simplification_started_at", isNullable: "YES" },
        { name: "simplified_at", isNullable: "YES" },
        { name: "simplified_structured_content", isNullable: "YES" },
      ],
    );
    assert.deepEqual(
      state.constraints.map(({ name }) => ({ name })),
      [{ name: "language_lessons_simplified_content_check" }],
    );

    const report = await getMigrationStatus(
      database,
      migrationsThroughSimplification,
    );
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state }) => state === "applied"));
  } finally {
    await database.close();
  }
});

test("language audio migration persists metadata with a unique private cache identity", async () => {
  const isolatedUrl = await createIsolatedDatabase("language_audio_assets");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const audioMigrationId = "0010_create_language_audio_assets.sql";
  const userId = "71000000-0000-4000-8000-000000000001";

  try {
    assert.ok(migrations.some(({ id }) => id === audioMigrationId));
    assert.deepEqual(
      await migratePending(database, migrations),
      migrations.map(({ id }) => id),
    );

    const state = await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'audio-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO language_audio_assets (
          user_id,
          language,
          normalized_text,
          original_text,
          provider,
          model,
          voice,
          audio_format,
          storage_key,
          status,
          generation_started_at
        )
        VALUES (
          ${userId},
          'Polaco',
          'Dzień dobry',
          'Dzień   dobry',
          'openai',
          'gpt-4o-mini-tts',
          'coral',
          'mp3',
          'language-audio/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp3',
          'generating',
          now()
        )
      `;
      await sql`
        UPDATE language_audio_assets
        SET status = 'ready', generation_started_at = NULL
        WHERE user_id = ${userId}
      `;
      const [asset] = await sql<
        Array<{
          language: string;
          normalizedText: string;
          originalText: string;
          provider: string;
          model: string;
          voice: string;
          audioFormat: string;
          storageKey: string;
          status: string;
        }>
      >`
        SELECT language,
               normalized_text AS "normalizedText",
               original_text AS "originalText",
               provider,
               model,
               voice,
               audio_format AS "audioFormat",
               storage_key AS "storageKey",
               status
        FROM language_audio_assets
        WHERE user_id = ${userId}
      `;

      await assert.rejects(
        sql`
          INSERT INTO language_audio_assets (
            user_id,
            language,
            normalized_text,
            original_text,
            provider,
            model,
            voice,
            audio_format,
            storage_key,
            status
          )
          VALUES (
            ${userId},
            'Polaco',
            'Dzień dobry',
            'Dzień dobry',
            'openai',
            'gpt-4o-mini-tts',
            'coral',
            'mp3',
            'language-audio/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.mp3',
            'ready'
          )
        `,
        /language_audio_assets_cache_unique/i,
      );

      return asset;
    });

    assert.deepEqual(state, {
      language: "Polaco",
      normalizedText: "Dzień dobry",
      originalText: "Dzień   dobry",
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice: "coral",
      audioFormat: "mp3",
      storageKey:
        "language-audio/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mp3",
      status: "ready",
    });
    const report = await getMigrationStatus(database, migrations);
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state: status }) => status === "applied"));
  } finally {
    await database.close();
  }
});

test("exercises migration persists focused exercise state and constraints", async () => {
  const isolatedUrl = await createIsolatedDatabase("exercises");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const exerciseMigrationId = "0011_create_exercises.sql";
  const exerciseMigrationIndex = migrations.findIndex(
    ({ id }) => id === exerciseMigrationId,
  );
  const migrationsThroughExercises = migrations.slice(
    0,
    exerciseMigrationIndex + 1,
  );
  const userId = "72000000-0000-4000-8000-000000000001";
  const exerciseId = "72000000-0000-4000-8000-000000000002";

  try {
    assert.equal(
      migrations[exerciseMigrationIndex + 1]?.id,
      "0012_structure_exercise_guides.sql",
    );
    assert.deepEqual(
      await migratePending(database, migrationsThroughExercises),
      migrationsThroughExercises.map(({ id }) => id),
    );

    const state = await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'exercise-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO exercises (
          id,
          user_id,
          title,
          source_name,
          chapter,
          exercise_number,
          prompt,
          suggested_steps,
          workspace_type,
          workspace_value
        )
        VALUES (
          ${exerciseId},
          ${userId},
          'Operaciones con tensores',
          'Deep Learning with PyTorch',
          'Capítulo 3',
          '3.4',
          'Crea un tensor y explica qué observas.',
          ${sql.json(["Crear el tensor", "Inspeccionar su shape"])},
          'local',
          'C:\\Users\\memoos\\exercise.py'
        )
      `;

      const [exercise] = await sql<
        Array<{
          title: string;
          status: string;
          suggestedSteps: unknown;
          workspaceType: string;
          workspaceValue: string;
        }>
      >`
        SELECT title,
               status,
               suggested_steps AS "suggestedSteps",
               workspace_type AS "workspaceType",
               workspace_value AS "workspaceValue"
        FROM exercises
        WHERE id = ${exerciseId} AND user_id = ${userId}
      `;

      await assert.rejects(
        sql`
          UPDATE exercises
          SET status = 'paused'
          WHERE id = ${exerciseId}
        `,
        /exercises_status_check/i,
      );
      await assert.rejects(
        sql`
          UPDATE exercises
          SET workspace_type = 'colab', workspace_value = NULL
          WHERE id = ${exerciseId}
        `,
        /exercises_workspace_pair_check/i,
      );
      await assert.rejects(
        sql`
          UPDATE exercises
          SET suggested_steps = '{"step":"not-an-array"}'::jsonb
          WHERE id = ${exerciseId}
        `,
        /exercises_suggested_steps_check/i,
      );

      return exercise;
    });

    assert.deepEqual(state, {
      title: "Operaciones con tensores",
      status: "pending",
      suggestedSteps: ["Crear el tensor", "Inspeccionar su shape"],
      workspaceType: "local",
      workspaceValue: "C:\\Users\\memoos\\exercise.py",
    });
    const report = await getMigrationStatus(database, migrationsThroughExercises);
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state: status }) => status === "applied"));
  } finally {
    await database.close();
  }
});

test("structured exercise guide migration preserves legacy guides and enforces bounds", async () => {
  const isolatedUrl = await createIsolatedDatabase("structured_exercise_guides");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const structuredGuideMigrationId =
    "0012_structure_exercise_guides.sql";
  const structuredGuideMigrationIndex = migrations.findIndex(
    ({ id }) => id === structuredGuideMigrationId,
  );
  const migrationsBeforeStructuredGuide = migrations.slice(
    0,
    structuredGuideMigrationIndex,
  );
  const migrationsThroughStructuredGuide = migrations.slice(
    0,
    structuredGuideMigrationIndex + 1,
  );
  const userId = "73000000-0000-4000-8000-000000000001";
  const exerciseId = "73000000-0000-4000-8000-000000000002";
  const legacyGuide = "## Concepto\n\n**Storage** guarda los valores.";
  const structuredGuide = {
    sections: [
      {
        type: "explanation",
        title: "La idea central",
        intro: "Distingue memoria e interpretación.",
        items: [],
      },
      {
        type: "concepts",
        title: "Piezas mínimas",
        intro: null,
        items: [
          {
            label: "Storage",
            text: "Memoria donde viven los valores.",
          },
        ],
      },
    ],
  };

  try {
    assert.equal(
      migrations[structuredGuideMigrationIndex + 1]?.id,
      "0013_add_language_lesson_progress.sql",
    );
    assert.deepEqual(
      await migratePending(database, migrationsBeforeStructuredGuide),
      migrationsBeforeStructuredGuide.map(({ id }) => id),
    );

    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'legacy-guide-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO exercises (id, user_id, title, prompt, guide_content)
        VALUES (
          ${exerciseId},
          ${userId},
          'Storage de un tensor',
          'Explica la relación entre tensor y storage.',
          ${legacyGuide}
        )
      `;
    });

    assert.deepEqual(await migratePending(database, migrationsThroughStructuredGuide), [
      structuredGuideMigrationId,
    ]);

    const state = await withSql(isolatedUrl, async (sql) => {
      const [afterMigration] = await sql<
        Array<{
          guideContent: string;
          guideStructuredContent: unknown;
          guideGenerationCount: number;
        }>
      >`
        SELECT guide_content AS "guideContent",
               guide_structured_content AS "guideStructuredContent",
               guide_generation_count AS "guideGenerationCount"
        FROM exercises
        WHERE id = ${exerciseId}
      `;

      await sql`
        UPDATE exercises
        SET guide_structured_content = ${sql.json(structuredGuide)},
            guide_generation_count = 2
        WHERE id = ${exerciseId}
      `;

      await assert.rejects(
        sql`
          UPDATE exercises
          SET guide_structured_content = '[]'::jsonb
          WHERE id = ${exerciseId}
        `,
        /exercises_guide_structured_content_check/i,
      );
      await assert.rejects(
        sql`
          UPDATE exercises
          SET guide_generation_count = 3
          WHERE id = ${exerciseId}
        `,
        /exercises_guide_generation_count_check/i,
      );

      const [persisted] = await sql<
        Array<{
          guideContent: string;
          guideStructuredContent: unknown;
          guideGenerationCount: number;
        }>
      >`
        SELECT guide_content AS "guideContent",
               guide_structured_content AS "guideStructuredContent",
               guide_generation_count AS "guideGenerationCount"
        FROM exercises
        WHERE id = ${exerciseId}
      `;

      return { afterMigration, persisted };
    });

    assert.deepEqual(state.afterMigration, {
      guideContent: legacyGuide,
      guideStructuredContent: null,
      guideGenerationCount: 0,
    });
    assert.deepEqual(state.persisted, {
      guideContent: legacyGuide,
      guideStructuredContent: structuredGuide,
      guideGenerationCount: 2,
    });
    const report = await getMigrationStatus(
      database,
      migrationsThroughStructuredGuide,
    );
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state }) => state === "applied"));
  } finally {
    await database.close();
  }
});

test("account recovery migration preserves users and enforces email and reset-token constraints", async () => {
  const isolatedUrl = await createIsolatedDatabase("account_recovery");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const accountMigrationId = "0014_add_account_recovery.sql";
  const accountMigrationIndex = migrations.findIndex(
    ({ id }) => id === accountMigrationId,
  );
  const migrationsBeforeAccount = migrations.slice(0, accountMigrationIndex);
  const migrationsThroughAccount = migrations.slice(0, accountMigrationIndex + 1);
  const legacyUserId = "74000000-0000-4000-8000-000000000001";

  try {
    assert.equal(
      migrations[accountMigrationIndex + 1]?.id,
      "0015_add_language_free_lesson_title.sql",
    );
    assert.deepEqual(
      await migratePending(database, migrationsBeforeAccount),
      migrationsBeforeAccount.map(({ id }) => id),
    );

    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${legacyUserId}, 'legacy-account', 'legacy-password-hash')
      `;
    });

    assert.deepEqual(await migratePending(database, migrationsThroughAccount), [
      accountMigrationId,
    ]);

    const state = await withSql(isolatedUrl, async (sql) => {
      const [legacyUser] = await sql<
        Array<{ email: string | null; passwordHash: string }>
      >`
        SELECT email, password_hash AS "passwordHash"
        FROM users
        WHERE id = ${legacyUserId}
      `;
      const columns = await sql<Array<{ columnName: string }>>`
        SELECT column_name AS "columnName"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'password_reset_tokens'
        ORDER BY ordinal_position
      `;
      const indexes = await sql<Array<{ indexName: string }>>`
        SELECT indexname AS "indexName"
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('users', 'password_reset_tokens')
      `;
      const constraints = await sql<
        Array<{ constraintName: string; definition: string }>
      >`
        SELECT conname AS "constraintName",
               pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid IN ('users'::regclass, 'password_reset_tokens'::regclass)
      `;

      await sql`
        UPDATE users
        SET email = 'legacy@example.com'
        WHERE id = ${legacyUserId}
      `;
      await assert.rejects(
        sql`
          INSERT INTO users (username, email, password_hash)
          VALUES ('duplicate-email', 'legacy@example.com', 'hash')
        `,
        /users_email_unique/i,
      );
      await assert.rejects(
        sql`
          UPDATE users
          SET email = 'UPPER@example.com'
          WHERE id = ${legacyUserId}
        `,
        /users_email_normalized_check/i,
      );

      const tokenHash = "a".repeat(64);
      await sql`
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES (${legacyUserId}, ${tokenHash}, now() + interval '45 minutes')
      `;
      await assert.rejects(
        sql`
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES (${legacyUserId}, ${tokenHash}, now() + interval '45 minutes')
        `,
        /password_reset_tokens_token_hash_unique/i,
      );
      await assert.rejects(
        sql`
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES (${legacyUserId}, ${"b".repeat(64)}, now() - interval '1 minute')
        `,
        /password_reset_tokens_expiry_check/i,
      );

      const [token] = await sql<
        Array<{ tokenHash: string; usedAt: Date | null }>
      >`
        SELECT token_hash AS "tokenHash", used_at AS "usedAt"
        FROM password_reset_tokens
        WHERE user_id = ${legacyUserId}
      `;

      return { columns, constraints, indexes, legacyUser, token };
    });

    assert.deepEqual(state.legacyUser, {
      email: null,
      passwordHash: "legacy-password-hash",
    });
    assert.deepEqual(
      state.columns.map(({ columnName }) => columnName),
      ["id", "user_id", "token_hash", "expires_at", "used_at", "created_at"],
    );
    assert.ok(
      state.indexes.some(({ indexName }) => indexName === "users_email_unique"),
    );
    assert.ok(
      state.indexes.some(
        ({ indexName }) =>
          indexName === "password_reset_tokens_token_hash_unique",
      ),
    );
    assert.ok(
      state.indexes.some(
        ({ indexName }) =>
          indexName === "password_reset_tokens_user_created_at_idx",
      ),
    );
    assert.ok(
      state.constraints.some(
        ({ constraintName }) =>
          constraintName === "users_email_normalized_check",
      ),
    );
    assert.ok(
      state.constraints.some(
        ({ constraintName }) =>
          constraintName === "password_reset_tokens_expiry_check",
      ),
    );
    assert.ok(
      state.constraints.some(
        ({ definition }) =>
          /FOREIGN KEY \(user_id\) REFERENCES users\(id\) ON DELETE CASCADE/i.test(
            definition,
          ),
      ),
    );
    assert.deepEqual(state.token, {
      tokenHash: "a".repeat(64),
      usedAt: null,
    });

    const report = await getMigrationStatus(database, migrationsThroughAccount);
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state: status }) => status === "applied"));
  } finally {
    await database.close();
  }
});

test("free lesson title migration preserves legacy lessons and permits ready exact-text lessons", async () => {
  const isolatedUrl = await createIsolatedDatabase("language_free_lesson_title");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const migrationId = "0015_add_language_free_lesson_title.sql";
  const migrationIndex = migrations.findIndex(({ id }) => id === migrationId);
  const before = migrations.slice(0, migrationIndex);
  const through = migrations.slice(0, migrationIndex + 1);
  const userId = "75000000-0000-4000-8000-000000000001";
  const projectId = "75000000-0000-4000-8000-000000000002";
  const legacyLessonId = "75000000-0000-4000-8000-000000000003";
  const newLessonId = "75000000-0000-4000-8000-000000000004";

  try {
    assert.equal(
      migrations[migrationIndex + 1]?.id,
      "0016_add_language_free_analysis.sql",
    );
    assert.deepEqual(
      await migratePending(database, before),
      before.map(({ id }) => id),
    );

    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'free-lesson-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO language_projects (id, user_id, language, level)
        VALUES (${projectId}, ${userId}, 'Deutsch', 'Nivel 2')
      `;
      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number, source_content, status,
          structured_content, processed_at
        ) VALUES (
          ${legacyLessonId}, ${projectId}, 1, 'free', 1,
          'Historischer Inhalt', 'ready', ${sql.json({ vocabulary: [] })}, now()
        )
      `;
      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number, source_content, status
        ) VALUES (
          ${newLessonId}, ${projectId}, 2, 'free', 2, '', 'draft'
        )
      `;
    });

    assert.deepEqual(await migratePending(database, through), [migrationId]);

    const state = await withSql(isolatedUrl, async (sql) => {
      const beforePrepare = await sql<
        Array<{ id: string; freeTitle: string | null; structuredContent: unknown }>
      >`
        SELECT id, free_title AS "freeTitle",
               structured_content AS "structuredContent"
        FROM language_lessons
        WHERE id IN (${legacyLessonId}, ${newLessonId})
        ORDER BY lesson_number
      `;

      const exactText = "  Erste Zeile.\n\nZweite Zeile.  ";
      await sql`
        UPDATE language_lessons
        SET free_title = 'Mein Text', source_content = ${exactText},
            status = 'ready', processed_at = now()
        WHERE id = ${newLessonId}
      `;
      await assert.rejects(
        sql`
          UPDATE language_lessons
          SET free_title = '   '
          WHERE id = ${newLessonId}
        `,
        /language_lessons_free_title_check/i,
      );
      await assert.rejects(
        sql`
          UPDATE language_lessons
          SET free_title = ${"a".repeat(161)}
          WHERE id = ${newLessonId}
        `,
        /language_lessons_free_title_check/i,
      );
      await assert.rejects(
        sql`
          INSERT INTO language_lessons (
            language_project_id, lesson_number, lesson_source,
            source_lesson_number, source_content, status, processed_at
          ) VALUES (
            ${projectId}, 3, 'language_framework', 1,
            'Kein strukturiertes Ergebnis', 'ready', now()
          )
        `,
        /language_lessons_ready_content_check/i,
      );

      const [prepared] = await sql<
        Array<{
          freeTitle: string;
          sourceContent: string;
          status: string;
          structuredContent: unknown;
        }>
      >`
        SELECT free_title AS "freeTitle", source_content AS "sourceContent",
               status, structured_content AS "structuredContent"
        FROM language_lessons
        WHERE id = ${newLessonId}
      `;
      return { beforePrepare, exactText, prepared };
    });

    assert.equal(state.beforePrepare[0]?.freeTitle, null);
    assert.deepEqual(state.beforePrepare[0]?.structuredContent, {
      vocabulary: [],
    });
    assert.equal(state.beforePrepare[1]?.freeTitle, null);
    assert.deepEqual(state.prepared, {
      freeTitle: "Mein Text",
      sourceContent: state.exactText,
      status: "ready",
      structuredContent: null,
    });
    const report = await getMigrationStatus(database, through);
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state }) => state === "applied"));
  } finally {
    await database.close();
  }
});

test("free analysis migration preserves lessons and stores optional analysis JSON", async () => {
  const isolatedUrl = await createIsolatedDatabase("language_free_analysis");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const migrationId = "0016_add_language_free_analysis.sql";
  const migrationIndex = migrations.findIndex(({ id }) => id === migrationId);
  const before = migrations.slice(0, migrationIndex);
  const through = migrations.slice(0, migrationIndex + 1);
  const userId = "76000000-0000-4000-8000-000000000001";
  const projectId = "76000000-0000-4000-8000-000000000002";
  const lessonId = "76000000-0000-4000-8000-000000000003";
  const sourceContent = "Ich warte am Bahnhof.";
  const analysis = {
    items: [
      {
        phrase: sourceContent,
        pattern: "auf + Akkusativ warten",
        explanation: "Se usa para expresar que esperas algo.",
      },
    ],
  };

  try {
    assert.equal(
      migrations[migrationIndex + 1]?.id,
      "0017_add_language_lesson_split_relationship.sql",
    );
    assert.deepEqual(
      await migratePending(database, before),
      before.map(({ id }) => id),
    );

    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'free-analysis-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO language_projects (id, user_id, language, level)
        VALUES (${projectId}, ${userId}, 'Deutsch', 'B1')
      `;
      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number, free_title, source_content, status,
          processed_at, learning_status, difficulty
        ) VALUES (
          ${lessonId}, ${projectId}, 1, 'free', 1, 'Am Bahnhof',
          ${sourceContent}, 'ready', now(), 'completed', 'hard'
        )
      `;
    });

    assert.deepEqual(await migratePending(database, through), [migrationId]);

    const state = await withSql(isolatedUrl, async (sql) => {
      const [afterMigration] = await sql<
        Array<{ freeAnalysis: unknown }>
      >`
        SELECT free_analysis AS "freeAnalysis"
        FROM language_lessons
        WHERE id = ${lessonId}
      `;
      await sql`
        UPDATE language_lessons
        SET free_analysis = ${sql.json(analysis)}
        WHERE id = ${lessonId}
      `;
      const [persisted] = await sql<
        Array<{
          freeAnalysis: unknown;
          freeTitle: string;
          sourceContent: string;
          status: string;
          learningStatus: string;
          difficulty: string;
        }>
      >`
        SELECT free_analysis AS "freeAnalysis", free_title AS "freeTitle",
               source_content AS "sourceContent", status,
               learning_status AS "learningStatus", difficulty
        FROM language_lessons
        WHERE id = ${lessonId}
      `;
      return { afterMigration, persisted };
    });

    assert.equal(state.afterMigration.freeAnalysis, null);
    assert.deepEqual(state.persisted, {
      freeAnalysis: analysis,
      freeTitle: "Am Bahnhof",
      sourceContent,
      status: "ready",
      learningStatus: "completed",
      difficulty: "hard",
    });
    const report = await getMigrationStatus(database, through);
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state }) => state === "applied"));
  } finally {
    await database.close();
  }
});

test("lesson split relationship migration preserves roots and enforces A/B children", async () => {
  const isolatedUrl = await createIsolatedDatabase("language_lesson_split");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const migrationId = "0017_add_language_lesson_split_relationship.sql";
  const migrationIndex = migrations.findIndex(({ id }) => id === migrationId);
  const before = migrations.slice(0, migrationIndex);
  const through = migrations.slice(0, migrationIndex + 1);
  const userId = "77000000-0000-4000-8000-000000000001";
  const projectId = "77000000-0000-4000-8000-000000000002";
  const parentId = "77000000-0000-4000-8000-000000000003";
  const freeId = "77000000-0000-4000-8000-000000000004";
  const assimilId = "77000000-0000-4000-8000-000000000005";
  const partAId = "77000000-0000-4000-8000-000000000006";
  const partBId = "77000000-0000-4000-8000-000000000007";

  try {
    assert.equal(
      migrations[migrationIndex + 1]?.id,
      "0018_transform_architect_projects_to_projects.sql",
    );
    assert.deepEqual(
      await migratePending(database, before),
      before.map(({ id }) => id),
    );

    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'lesson-split-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO language_projects (id, user_id, language, level)
        VALUES (${projectId}, ${userId}, 'Deutsch', 'A1')
      `;
      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number, source_content, status, structured_content,
          simplified_structured_content, processed_at, simplified_at,
          learning_status, difficulty
        ) VALUES (
          ${parentId}, ${projectId}, 1, 'language_framework', 1,
          'Historischer Rahmeninhalt', 'ready',
          ${sql.json({ marker: "original" })},
          ${sql.json({ marker: "simplified" })}, now(), now(),
          'completed', 'hard'
        )
      `;
      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number
        ) VALUES (${freeId}, ${projectId}, 2, 'free', 1)
      `;
      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number
        ) VALUES (${assimilId}, ${projectId}, 3, 'assimil', 1)
      `;
    });

    assert.deepEqual(await migratePending(database, through), [migrationId]);

    const state = await withSql(isolatedUrl, async (sql) => {
      const historical = await sql<
        Array<{
          id: string;
          splitParentLessonId: string | null;
          splitPart: string | null;
          sourceContent: string;
          structuredContent: unknown;
          simplifiedStructuredContent: unknown;
          learningStatus: string;
          difficulty: string | null;
        }>
      >`
        SELECT id,
               split_parent_lesson_id AS "splitParentLessonId",
               split_part AS "splitPart",
               source_content AS "sourceContent",
               structured_content AS "structuredContent",
               simplified_structured_content AS "simplifiedStructuredContent",
               learning_status AS "learningStatus",
               difficulty
        FROM language_lessons
        WHERE id IN (${parentId}, ${freeId}, ${assimilId})
        ORDER BY lesson_number
      `;

      await sql`
        INSERT INTO language_lessons (
          language_project_id, lesson_number, lesson_source,
          source_lesson_number
        ) VALUES (${projectId}, 4, 'language_framework', 2)
      `;

      await assert.rejects(
        sql`
          INSERT INTO language_lessons (
            language_project_id, lesson_number, lesson_source,
            source_lesson_number, split_part
          ) VALUES (${projectId}, 5, 'language_framework', 3, 'A')
        `,
        /language_lessons_split_pair_check/i,
      );
      await assert.rejects(
        sql`
          INSERT INTO language_lessons (
            language_project_id, lesson_number, lesson_source,
            source_lesson_number, split_parent_lesson_id
          ) VALUES (${projectId}, 6, 'language_framework', 1, ${parentId})
        `,
        /language_lessons_split_pair_check/i,
      );
      await assert.rejects(
        sql`
          INSERT INTO language_lessons (
            language_project_id, lesson_number, lesson_source,
            source_lesson_number, split_parent_lesson_id, split_part
          ) VALUES (
            ${projectId}, 7, 'language_framework', 1, ${parentId}, 'C'
          )
        `,
        /language_lessons_split_pair_check/i,
      );
      await assert.rejects(
        sql`
          INSERT INTO language_lessons (
            id, language_project_id, lesson_number, lesson_source,
            source_lesson_number, split_parent_lesson_id, split_part
          ) VALUES (
            '77000000-0000-4000-8000-000000000008', ${projectId}, 8,
            'language_framework', 1,
            '77000000-0000-4000-8000-000000000008', 'A'
          )
        `,
        /language_lessons_split_self_check/i,
      );
      await assert.rejects(
        sql`
          INSERT INTO language_lessons (
            language_project_id, lesson_number, lesson_source,
            source_lesson_number, split_parent_lesson_id, split_part
          ) VALUES (${projectId}, 9, 'free', 1, ${parentId}, 'A')
        `,
        /language_lessons_split_framework_only_check/i,
      );
      await assert.rejects(
        sql`
          INSERT INTO language_lessons (
            language_project_id, lesson_number, lesson_source,
            source_lesson_number, split_parent_lesson_id, split_part
          ) VALUES (${projectId}, 10, 'assimil', 1, ${parentId}, 'A')
        `,
        /language_lessons_split_framework_only_check/i,
      );

      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number, split_parent_lesson_id, split_part
        ) VALUES (
          ${partAId}, ${projectId}, 11, 'language_framework', 1,
          ${parentId}, 'A'
        )
      `;
      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number, split_parent_lesson_id, split_part
        ) VALUES (
          ${partBId}, ${projectId}, 12, 'language_framework', 1,
          ${parentId}, 'B'
        )
      `;

      await assert.rejects(
        sql`
          INSERT INTO language_lessons (
            language_project_id, lesson_number, lesson_source,
            source_lesson_number
          ) VALUES (${projectId}, 13, 'language_framework', 1)
        `,
        /language_lessons_project_source_number_unique/i,
      );
      await assert.rejects(
        sql`
          INSERT INTO language_lessons (
            language_project_id, lesson_number, lesson_source,
            source_lesson_number, split_parent_lesson_id, split_part
          ) VALUES (
            ${projectId}, 14, 'language_framework', 1, ${parentId}, 'A'
          )
        `,
        /language_lessons_split_parent_part_unique/i,
      );
      await assert.rejects(
        sql`
          INSERT INTO language_lessons (
            language_project_id, lesson_number, lesson_source,
            source_lesson_number, split_parent_lesson_id, split_part
          ) VALUES (
            ${projectId}, 15, 'language_framework', 1, ${parentId}, 'B'
          )
        `,
        /language_lessons_split_parent_part_unique/i,
      );

      const childrenBeforeDelete = await sql<
        Array<{
          id: string;
          sourceLessonNumber: number;
          splitParentLessonId: string;
          splitPart: string;
        }>
      >`
        SELECT id, source_lesson_number AS "sourceLessonNumber",
               split_parent_lesson_id AS "splitParentLessonId",
               split_part AS "splitPart"
        FROM language_lessons
        WHERE split_parent_lesson_id = ${parentId}
        ORDER BY split_part
      `;
      await sql`DELETE FROM language_lessons WHERE id = ${parentId}`;
      const [childState] = await sql<Array<{ childCount: number }>>`
        SELECT count(*)::integer AS "childCount"
        FROM language_lessons
        WHERE id IN (${partAId}, ${partBId})
      `;

      return {
        historical,
        childrenBeforeDelete,
        childCount: childState?.childCount,
      };
    });

    assert.deepEqual(
      state.historical.map(({ id, splitParentLessonId, splitPart }) => ({
        id,
        splitParentLessonId,
        splitPart,
      })),
      [parentId, freeId, assimilId].map((id) => ({
        id,
        splitParentLessonId: null,
        splitPart: null,
      })),
    );
    assert.deepEqual(state.historical[0], {
      id: parentId,
      splitParentLessonId: null,
      splitPart: null,
      sourceContent: "Historischer Rahmeninhalt",
      structuredContent: { marker: "original" },
      simplifiedStructuredContent: { marker: "simplified" },
      learningStatus: "completed",
      difficulty: "hard",
    });
    assert.deepEqual(
      state.childrenBeforeDelete.map(
        ({ sourceLessonNumber, splitParentLessonId, splitPart }) => ({
          sourceLessonNumber,
          splitParentLessonId,
          splitPart,
        }),
      ),
      [
        {
          sourceLessonNumber: 1,
          splitParentLessonId: parentId,
          splitPart: "A",
        },
        {
          sourceLessonNumber: 1,
          splitParentLessonId: parentId,
          splitPart: "B",
        },
      ],
    );
    assert.equal(state.childCount, 0);

    const report = await getMigrationStatus(database, through);
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state }) => state === "applied"));
  } finally {
    await database.close();
  }
});

test("split repository creates A/B atomically, idempotently and preserves the parent", async () => {
  const isolatedUrl = await createIsolatedDatabase("lesson_split_repository");
  const migrationDatabase = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const userId = "78000000-0000-4000-8000-000000000001";
  const projectId = "78000000-0000-4000-8000-000000000002";
  const parentId = "78000000-0000-4000-8000-000000000003";
  const rollbackParentId = "78000000-0000-4000-8000-000000000004";
  const partA = {
    vocabulary: [{ term: "müde", meaning: "cansado", example: "Ich bin müde." }],
    phrases: [{ text: "Ich bin müde.", translation: "Estoy cansado.", note: null }],
    patterns: [
      {
        name: "Ich bin …",
        explanation: "Describe un estado.",
        examples: ["Ich bin müde."],
      },
    ],
    miniStory: { text: "Lukas ist müde." },
    automaticThoughts: [{ text: "Ich bin müde." }],
    dialogue: [{ speaker: "Lukas", text: "Ich bin müde." }],
    nextLevelBridge: [
      {
        base: "Ich bin müde.",
        advanced: "Ich bin sehr müde.",
        note: "Añade intensidad.",
      },
    ],
    review: { keyVocabulary: ["müde"], keyPatterns: ["Ich bin …"] },
    kanji: [],
  };
  const partB = {
    ...partA,
    vocabulary: [
      {
        term: "aufstehen",
        meaning: "levantarse",
        example: "Ich stehe früh auf.",
      },
    ],
    miniStory: { text: "Lukas steht früh auf." },
    review: {
      keyVocabulary: ["aufstehen"],
      keyPatterns: ["Ich stehe … auf"],
    },
  };

  try {
    assert.deepEqual(await migratePending(migrationDatabase, migrations), migrations.map(({ id }) => id));
    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'split-repository-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO language_projects (id, user_id, language, level)
        VALUES (${projectId}, ${userId}, 'Deutsch', 'A1 Beginner')
      `;
      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number, source_content, status, structured_content,
          simplified_structured_content, simplification_started_at,
          simplified_at, processed_at, learning_status, difficulty
        ) VALUES (
          ${parentId}, ${projectId}, 1, 'language_framework', 1,
          'Parent source remains private', 'ready', ${sql.json(partA)},
          ${sql.json(partB)}, null, now(), now(), 'in_progress', 'hard'
        )
      `;
      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number, source_content, status, structured_content,
          processed_at
        ) VALUES (
          ${rollbackParentId}, ${projectId}, 2, 'language_framework', 2,
          'Rollback parent source', 'ready', ${sql.json(partA)}, now()
        )
      `;
      await sql.unsafe(`
        ALTER TABLE language_lessons
        ADD CONSTRAINT language_lessons_test_reject_part_b
        CHECK (
          split_parent_lesson_id <> '${rollbackParentId}'::uuid
          OR split_part <> 'B'
        )
      `);
    });

    process.env.DATABASE_URL = isolatedUrl;
    const parentBefore = await withSql(isolatedUrl, async (sql) =>
      sql`
        SELECT * FROM language_lessons WHERE id = ${parentId}
      `,
    );
    const created = await languageStore.createLessonSplitChildren({
      languageProjectId: projectId,
      lessonId: parentId,
      userId,
      partA,
      partB,
    });
    assert.equal(created.kind, "created");
    if (created.kind !== "created") assert.fail("Expected split creation.");

    assert.deepEqual(
      [created.parts.A.lessonNumber, created.parts.B.lessonNumber],
      [3, 4],
    );
    assert.deepEqual(
      [created.parts.A.splitPart, created.parts.B.splitPart],
      ["A", "B"],
    );
    for (const child of [created.parts.A, created.parts.B]) {
      assert.equal(child.splitParentLessonId, parentId);
      assert.equal(child.lessonSource, "language_framework");
      assert.equal(child.sourceLessonNumber, 1);
      assert.equal(child.status, "ready");
      assert.equal(child.learningStatus, "pending");
      assert.equal(child.difficulty, null);
      assert.equal(child.sourceContent, "");
      assert.equal(child.simplifiedStructuredContent, null);
      assert.equal(child.simplificationStartedAt, null);
      assert.equal(child.simplifiedAt, null);
      assert.equal(child.freeTitle, null);
      assert.equal(child.freeAnalysis, null);
      assert.ok(child.processedAt);
    }

    const repeated = await languageStore.createLessonSplitChildren({
      languageProjectId: projectId,
      lessonId: parentId,
      userId,
      partA,
      partB,
    });
    assert.equal(repeated.kind, "existing");
    if (repeated.kind !== "existing") assert.fail("Expected existing split.");
    assert.deepEqual(
      [repeated.parts.A.id, repeated.parts.B.id],
      [created.parts.A.id, created.parts.B.id],
    );

    await assert.rejects(
      languageStore.createLessonSplitChildren({
        languageProjectId: projectId,
        lessonId: rollbackParentId,
        userId,
        partA,
        partB,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        const cause = "cause" in error ? error.cause : undefined;
        assert.match(
          cause instanceof Error ? cause.message : String(cause),
          /language_lessons_test_reject_part_b/i,
        );
        return true;
      },
    );

    const stateAfter = await withSql(isolatedUrl, async (sql) => {
      const parentAfter = await sql`
        SELECT * FROM language_lessons WHERE id = ${parentId}
      `;
      const [rollbackChildren] = await sql<Array<{ count: number }>>`
        SELECT count(*)::integer AS count
        FROM language_lessons
        WHERE split_parent_lesson_id = ${rollbackParentId}
      `;
      const [createdChildren] = await sql<Array<{ count: number }>>`
        SELECT count(*)::integer AS count
        FROM language_lessons
        WHERE split_parent_lesson_id = ${parentId}
      `;
      return {
        parentAfter,
        rollbackChildCount: rollbackChildren?.count,
        createdChildCount: createdChildren?.count,
      };
    });

    assert.deepEqual(stateAfter.parentAfter, parentBefore);
    assert.equal(stateAfter.createdChildCount, 2);
    assert.equal(stateAfter.rollbackChildCount, 0);
  } finally {
    await closeDbConnection();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await migrationDatabase.close();
  }
});

test("very simplification repository claims children and preserves Base, previous versions and parent", async () => {
  const isolatedUrl = await createIsolatedDatabase("very_simplification_repository");
  const migrationDatabase = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const userId = "79000000-0000-4000-8000-000000000001";
  const projectId = "79000000-0000-4000-8000-000000000002";
  const parentId = "79000000-0000-4000-8000-000000000003";
  const partAId = "79000000-0000-4000-8000-000000000004";
  const partBId = "79000000-0000-4000-8000-000000000005";
  const base = {
    vocabulary: [
      { term: "ich", meaning: "yo", example: "Ich bin hier." },
      { term: "hier", meaning: "aquí", example: "Ich bin hier." },
      { term: "müde", meaning: "cansado", example: "Ich bin müde." },
    ],
    phrases: [
      { text: "Ich bin hier.", translation: "Estoy aquí.", note: null },
      { text: "Ich bin müde.", translation: "Estoy cansado.", note: null },
      { text: "Ich schlafe.", translation: "Duermo.", note: null },
    ],
    patterns: [
      {
        name: "Ich bin …",
        explanation: "Describe un estado.",
        examples: ["Ich bin hier."],
      },
    ],
    miniStory: { text: "Mia ist hier.\nMia ist müde." },
    automaticThoughts: [
      { text: "Ich bin hier." },
      { text: "Ich bin müde." },
      { text: "Ich schlafe." },
    ],
    dialogue: [
      { speaker: "Mia", text: "Ich bin müde." },
      { speaker: "Tom", text: "Schlaf gut." },
    ],
    nextLevelBridge: [
      {
        base: "Ich bin müde.",
        advanced: "Ich bin sehr müde.",
        note: "Añade intensidad.",
      },
    ],
    review: { keyVocabulary: ["müde"], keyPatterns: ["Ich bin …"] },
    kanji: [],
  };
  const very = {
    ...base,
    miniStory: { text: "Mia ist müde." },
  };
  const previousVery = {
    ...base,
    miniStory: { text: "Tom ist hier." },
  };

  try {
    assert.deepEqual(
      await migratePending(migrationDatabase, migrations),
      migrations.map(({ id }) => id),
    );
    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'very-simplification-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO language_projects (id, user_id, language, level)
        VALUES (${projectId}, ${userId}, 'Deutsch', 'A1 Beginner')
      `;
      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number, source_content, status, structured_content,
          processed_at, learning_status, difficulty
        ) VALUES (
          ${parentId}, ${projectId}, 1, 'language_framework', 1,
          'Parent remains private', 'ready', ${sql.json(base)}, now(),
          'in_progress', 'hard'
        )
      `;
      await sql`
        INSERT INTO language_lessons (
          id, language_project_id, lesson_number, lesson_source,
          source_lesson_number, split_parent_lesson_id, split_part,
          source_content, status, structured_content, processed_at
        ) VALUES
          (${partAId}, ${projectId}, 2, 'language_framework', 1,
           ${parentId}, 'A', '', 'ready', ${sql.json(base)}, now()),
          (${partBId}, ${projectId}, 3, 'language_framework', 1,
           ${parentId}, 'B', '', 'ready', ${sql.json(base)}, now())
      `;
      await sql`
        UPDATE language_lessons
        SET simplified_structured_content = ${sql.json(previousVery)},
            simplified_at = now()
        WHERE id = ${partBId}
      `;
    });

    process.env.DATABASE_URL = isolatedUrl;

    const rootVeryClaim = await languageStore.claimLessonForVerySimplification({
      languageProjectId: projectId,
      lessonId: parentId,
      userId,
      regenerate: false,
    });
    assert.equal(rootVeryClaim.kind, "not_eligible");

    const childRootClaim = await languageStore.claimLessonForSimplification({
      languageProjectId: projectId,
      lessonId: partAId,
      userId,
      regenerate: false,
    });
    assert.equal(childRootClaim.kind, "not_eligible");

    const partAClaim = await languageStore.claimLessonForVerySimplification({
      languageProjectId: projectId,
      lessonId: partAId,
      userId,
      regenerate: false,
    });
    assert.equal(partAClaim.kind, "claimed");
    if (partAClaim.kind !== "claimed") assert.fail("Expected child claim.");
    const partAStartedAt = partAClaim.lesson.simplificationStartedAt;
    assert.ok(partAStartedAt);

    const duplicate = await languageStore.claimLessonForVerySimplification({
      languageProjectId: projectId,
      lessonId: partAId,
      userId,
      regenerate: false,
    });
    assert.equal(duplicate.kind, "processing");

    const completed = await languageStore.completeLessonSimplification({
      languageProjectId: projectId,
      lessonId: partAId,
      userId,
      simplificationStartedAt: partAStartedAt,
      simplifiedStructuredContent: very,
    });
    assert.ok(completed);
    assert.deepEqual(completed.structuredContent, base);
    assert.deepEqual(completed.simplifiedStructuredContent, very);
    assert.equal(completed.simplificationStartedAt, null);
    assert.equal(completed.status, "ready");

    const partBClaim = await languageStore.claimLessonForVerySimplification({
      languageProjectId: projectId,
      lessonId: partBId,
      userId,
      regenerate: true,
    });
    assert.equal(partBClaim.kind, "claimed");
    if (partBClaim.kind !== "claimed") assert.fail("Expected regenerate claim.");
    assert.deepEqual(partBClaim.lesson.simplifiedStructuredContent, previousVery);
    assert.ok(partBClaim.lesson.simplificationStartedAt);

    const failed = await languageStore.failLessonSimplification({
      languageProjectId: projectId,
      lessonId: partBId,
      userId,
      simplificationStartedAt: partBClaim.lesson.simplificationStartedAt,
    });
    assert.ok(failed);
    assert.deepEqual(failed.structuredContent, base);
    assert.deepEqual(failed.simplifiedStructuredContent, previousVery);
    assert.equal(failed.simplificationStartedAt, null);
    assert.equal(failed.status, "ready");

    const parentAfter = await languageStore.findLessonByIdForUser(
      parentId,
      projectId,
      userId,
    );
    assert.ok(parentAfter);
    assert.deepEqual(parentAfter.structuredContent, base);
    assert.equal(parentAfter.simplifiedStructuredContent, null);
    assert.equal(parentAfter.learningStatus, "in_progress");
    assert.equal(parentAfter.difficulty, "hard");
    assert.equal(parentAfter.simplificationStartedAt, null);
  } finally {
    await closeDbConnection();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await migrationDatabase.close();
  }
});

test("Proyectos migration preserves historical projects and enforces link direction", async () => {
  const isolatedUrl = await createIsolatedDatabase("proyectos_migration");
  const database = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const migrationId = "0018_transform_architect_projects_to_projects.sql";
  const migrationIndex = migrations.findIndex(({ id }) => id === migrationId);
  const before = migrations.slice(0, migrationIndex);
  const through = migrations.slice(0, migrationIndex + 1);
  const userId = "80000000-0000-4000-8000-000000000001";
  const historicalProjectId = "80000000-0000-4000-8000-000000000002";

  try {
    assert.notEqual(migrationIndex, -1);
    assert.deepEqual(
      await migratePending(database, before),
      before.map(({ id }) => id),
    );

    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'historical-project-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO architect_projects (
          id, user_id, project_type, source_text, official_url,
          analysis_status, structured_data
        ) VALUES (
          ${historicalProjectId}, ${userId}, 'competition',
          'Concurso histórico', 'https://example.com/competition',
          'pending', null
        )
      `;
    });

    assert.deepEqual(await migratePending(database, through), [migrationId]);

    const state = await withSql(isolatedUrl, async (sql) => {
      const columns = await sql<
        Array<{ columnName: string; dataType: string; isNullable: string }>
      >`
        SELECT column_name AS "columnName", data_type AS "dataType",
               is_nullable AS "isNullable"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'architect_projects'
          AND column_name IN ('name', 'objective', 'status')
        ORDER BY column_name
      `;
      const [historical] = await sql<
        Array<{
          name: string | null;
          objective: string | null;
          status: string | null;
          sourceText: string | null;
          officialUrl: string | null;
          analysisStatus: string;
        }>
      >`
        SELECT name, objective, status, source_text AS "sourceText",
               official_url AS "officialUrl",
               analysis_status AS "analysisStatus"
        FROM architect_projects
        WHERE id = ${historicalProjectId}
      `;
      const [tableState] = await sql<Array<{ exists: boolean }>>`
        SELECT to_regclass('public.project_links') IS NOT NULL AS exists
      `;
      const [foreignKey] = await sql<
        Array<{
          foreignTable: string;
          deleteRule: string;
        }>
      >`
        SELECT ccu.table_name AS "foreignTable",
               rc.delete_rule AS "deleteRule"
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.referential_constraints AS rc
          ON rc.constraint_schema = tc.constraint_schema
         AND rc.constraint_name = tc.constraint_name
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_schema = tc.constraint_schema
         AND ccu.constraint_name = tc.constraint_name
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'project_links'
          AND tc.constraint_type = 'FOREIGN KEY'
      `;
      const indexes = await sql<Array<{ indexName: string }>>`
        SELECT indexname AS "indexName"
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'project_links'
        ORDER BY indexname
      `;

      await assert.rejects(
        sql`
          UPDATE architect_projects
          SET status = 'working'
          WHERE id = ${historicalProjectId}
        `,
        /architect_projects_status_check/i,
      );
      await assert.rejects(
        sql`
          INSERT INTO project_links (project_id, name, url)
          VALUES (
            '80000000-0000-4000-8000-000000000099',
            'Huérfano',
            'https://example.com/orphan'
          )
        `,
        /project_links_project_id_fkey/i,
      );

      const [firstLink] = await sql<
        Array<{ id: string; createdAt: Date }>
      >`
        INSERT INTO project_links (project_id, name, url)
        VALUES (
          ${historicalProjectId},
          'GitHub',
          'https://github.com/example/project'
        )
        RETURNING id, created_at AS "createdAt"
      `;
      await sql`DELETE FROM project_links WHERE id = ${firstLink!.id}`;
      const [projectAfterLinkDelete] = await sql<Array<{ count: number }>>`
        SELECT count(*)::integer AS count
        FROM architect_projects
        WHERE id = ${historicalProjectId}
      `;

      const [cascadeLink] = await sql<Array<{ id: string }>>`
        INSERT INTO project_links (project_id, name, url)
        VALUES (
          ${historicalProjectId},
          'Notion',
          'https://notion.so/example'
        )
        RETURNING id
      `;
      await sql`DELETE FROM architect_projects WHERE id = ${historicalProjectId}`;
      const [linkAfterProjectDelete] = await sql<Array<{ count: number }>>`
        SELECT count(*)::integer AS count
        FROM project_links
        WHERE id = ${cascadeLink!.id}
      `;

      return {
        columns,
        historical,
        tableExists: tableState?.exists,
        foreignKey,
        indexes,
        firstLink,
        projectCountAfterLinkDelete: projectAfterLinkDelete?.count,
        linkCountAfterProjectDelete: linkAfterProjectDelete?.count,
      };
    });

    assert.deepEqual(Array.from(state.columns), [
      { columnName: "name", dataType: "text", isNullable: "YES" },
      { columnName: "objective", dataType: "text", isNullable: "YES" },
      { columnName: "status", dataType: "text", isNullable: "YES" },
    ]);
    assert.deepEqual(state.historical, {
      name: null,
      objective: null,
      status: null,
      sourceText: "Concurso histórico",
      officialUrl: "https://example.com/competition",
      analysisStatus: "pending",
    });
    assert.equal(state.tableExists, true);
    assert.deepEqual(state.foreignKey, {
      foreignTable: "architect_projects",
      deleteRule: "CASCADE",
    });
    assert.deepEqual(
      Array.from(state.indexes, ({ indexName }) => indexName),
      ["project_links_pkey", "project_links_project_created_at_idx"],
    );
    assert.match(
      state.firstLink!.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    assert.ok(state.firstLink!.createdAt instanceof Date);
    assert.equal(state.projectCountAfterLinkDelete, 1);
    assert.equal(state.linkCountAfterProjectDelete, 0);

    const report = await getMigrationStatus(database, through);
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state: status }) => status === "applied"));
  } finally {
    await database.close();
  }
});

test("direct SQL curriculum repository normalizes real PostgreSQL timestamptz values", async () => {
  const isolatedUrl = await createIsolatedDatabase("curriculum_timestamps");
  const migrationDatabase = createPostgresMigrationDatabase(isolatedUrl);
  const migrations = await loadMigrationFiles(migrationDirectory);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const userId = "91000000-0000-4000-8000-000000000001";
  const documentId = "91000000-0000-4000-8000-000000000002";
  const expectedTimestamp = "2026-09-05T00:43:56.837Z";

  try {
    await migratePending(migrationDatabase, migrations);
    await withSql(isolatedUrl, async (sql) => {
      await sql`
        INSERT INTO users (id, username, password_hash)
        VALUES (${userId}, 'curriculum-timestamp-user', 'not-a-real-hash')
      `;
      await sql`
        INSERT INTO language_curriculum_documents (
          id,
          user_id,
          document_id,
          curriculum_id,
          level_id,
          created_at,
          updated_at
        ) VALUES (
          ${documentId},
          ${userId},
          'A1-TIMESTAMP-REGRESSION',
          'memoos-core-language',
          'A1',
          ${expectedTimestamp}::timestamptz,
          ${expectedTimestamp}::timestamptz
        )
      `;
    });

    process.env.DATABASE_URL = isolatedUrl;
    const documents = await curriculumDocumentStore.listDocuments(userId);

    assert.equal(documents.length, 1);
    assert.ok(documents[0]?.createdAt instanceof Date);
    assert.ok(documents[0]?.updatedAt instanceof Date);
    assert.equal(documents[0]?.createdAt.toISOString(), expectedTimestamp);
    assert.equal(documents[0]?.updatedAt.toISOString(), expectedTimestamp);
  } finally {
    await closeDbConnection();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await migrationDatabase.close();
  }
});
