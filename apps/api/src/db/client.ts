import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

let client: postgres.Sql | undefined;
let database: PostgresJsDatabase<typeof schema> | undefined;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!client) {
    client = postgres(process.env.DATABASE_URL, {
      max: 10,
    });
    database = drizzle(client, { schema });
  }

  if (!database) {
    throw new Error("Database client could not be created.");
  }

  return database;
}

export async function closeDbConnection() {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
    database = undefined;
  }
}
