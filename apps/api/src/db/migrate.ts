import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);
const sql = postgres(databaseUrl, {
  max: 1,
});

async function ensureMigrationsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamp with time zone DEFAULT now() NOT NULL
    )
  `;
}

async function hasMigrationRun(id: string) {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM schema_migrations WHERE id = ${id}
  `;

  return rows.length > 0;
}

async function runMigration(fileName: string) {
  const migrationPath = join(migrationsDir, fileName);
  const migrationSql = await readFile(migrationPath, "utf8");
  const statements = migrationSql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

  await sql.begin(async (transaction) => {
    for (const statement of statements) {
      await transaction.unsafe(statement);
    }

    await transaction`
      INSERT INTO schema_migrations (id) VALUES (${fileName})
    `;
  });
}

async function main() {
  await ensureMigrationsTable();

  const files = (await readdir(migrationsDir))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();

  for (const fileName of files) {
    if (await hasMigrationRun(fileName)) {
      continue;
    }

    await runMigration(fileName);
    console.log(`Applied migration ${fileName}`);
  }
}

try {
  await main();
} finally {
  await sql.end({ timeout: 5 });
}
