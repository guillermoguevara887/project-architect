import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrationFiles } from "./migrations.js";
import { createPostgresMigrationDatabase } from "./postgres-migration-database.js";

function migrationsDirectory() {
  return join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
}

export async function createMigrationRuntime() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to manage migrations.");
  }

  return {
    database: createPostgresMigrationDatabase(databaseUrl),
    migrations: await loadMigrationFiles(migrationsDirectory()),
  };
}
