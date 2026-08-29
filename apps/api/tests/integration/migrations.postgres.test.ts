import assert from "node:assert/strict";
import { after, test } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  bootstrapLegacyMigrationHistory,
  checksumMigrationSql,
  getMigrationStatus,
  loadMigrationFiles,
  migratePending,
  type MigrationFile,
} from "../../src/db/migrations.js";
import { createPostgresMigrationDatabase } from "../../src/db/postgres-migration-database.js";

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
    assert.equal(accountMigrationIndex, migrations.length - 1);
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
