import postgres from "postgres";
import type {
  MigrationDatabase,
  MigrationFile,
  MigrationHistorySnapshot,
} from "./migrations.js";

const MIGRATION_LOCK_KEY = 1_297_040_723;

type HistoryColumn = {
  column_name: string;
  is_nullable: "YES" | "NO";
};

export function createPostgresMigrationDatabase(databaseUrl: string) {
  const sql = postgres(databaseUrl, { max: 1 });

  const database: MigrationDatabase & { close(): Promise<void> } = {
    async withMigrationLock(operation) {
      await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;

      try {
        return await operation();
      } finally {
        await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
      }
    },

    async readMigrationHistory(): Promise<MigrationHistorySnapshot> {
      const historyRows = await sql<Array<{ historyTable: string | null }>>`
        SELECT to_regclass('public.schema_migrations')::text AS "historyTable"
      `;
      const historyTable = historyRows[0]?.historyTable;

      if (!historyTable) {
        return { mode: "missing", applied: [] };
      }

      const columns = await sql<HistoryColumn[]>`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'schema_migrations'
      `;
      const columnNames = new Set(columns.map((column) => column.column_name));

      if (!columnNames.has("id") || !columnNames.has("applied_at")) {
        throw new Error(
          "schema_migrations does not contain the required id and applied_at columns.",
        );
      }

      const checksumColumn = columns.find(
        (column) => column.column_name === "checksum",
      );
      const applied = checksumColumn
        ? await sql<
            Array<{ id: string; checksum: string | null; appliedAt: Date }>
          >`
            SELECT id, checksum, applied_at AS "appliedAt"
            FROM schema_migrations
            ORDER BY id
          `
        : await sql<
            Array<{ id: string; checksum: null; appliedAt: Date }>
          >`
            SELECT id, NULL::text AS checksum, applied_at AS "appliedAt"
            FROM schema_migrations
            ORDER BY id
          `;

      return {
        mode:
          checksumColumn?.is_nullable === "NO" ? "current" : "legacy",
        applied,
      };
    },

    async createMigrationHistory() {
      await sql`
        CREATE TABLE schema_migrations (
          id text PRIMARY KEY,
          checksum text NOT NULL,
          applied_at timestamp with time zone DEFAULT now() NOT NULL
        )
      `;
    },

    async applyMigration(migration: MigrationFile) {
      await sql.begin(async (transaction) => {
        await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO schema_migrations (id, checksum)
          VALUES (${migration.id}, ${migration.checksum})
        `;
      });
    },

    async bootstrapMigrationChecksums(migrations) {
      await sql.begin(async (transaction) => {
        await transaction.unsafe(
          "ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text",
        );

        for (const migration of migrations) {
          const updated = await transaction`
            UPDATE schema_migrations
            SET checksum = ${migration.checksum}
            WHERE id = ${migration.id}
          `;

          if (updated.count !== 1) {
            throw new Error(
              `Could not attach a checksum to "${migration.id}".`,
            );
          }
        }

        await transaction.unsafe(
          "ALTER TABLE schema_migrations ALTER COLUMN checksum SET NOT NULL",
        );
      });
    },

    async close() {
      await sql.end({ timeout: 5 });
    },
  };

  return database;
}
