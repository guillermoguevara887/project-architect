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
    assert.equal(migrations.at(-1)?.id, sourceNumberMigrationId);
    assert.equal(sourceNumberMigrationIndex, migrations.length - 1);
    const migrationsBeforeSourceNumber = migrations.slice(
      0,
      sourceNumberMigrationIndex,
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

    assert.deepEqual(await migratePending(database, migrations), [
      sourceNumberMigrationId,
    ]);

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

    const report = await getMigrationStatus(database, migrations);
    assert.equal(report.historyMode, "current");
    assert.ok(report.migrations.every(({ state: status }) => status === "applied"));
  } finally {
    await database.close();
  }
});
