import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const MIGRATION_FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export type MigrationFile = {
  id: string;
  checksum: string;
  sql: string;
};

export type AppliedMigration = {
  id: string;
  checksum: string | null;
  appliedAt: Date;
};

export type MigrationHistorySnapshot = {
  mode: "missing" | "legacy" | "current";
  applied: AppliedMigration[];
};

export interface MigrationDatabase {
  withMigrationLock<T>(operation: () => Promise<T>): Promise<T>;
  readMigrationHistory(): Promise<MigrationHistorySnapshot>;
  createMigrationHistory(): Promise<void>;
  applyMigration(migration: MigrationFile): Promise<void>;
  bootstrapMigrationChecksums(
    migrations: Array<{ id: string; checksum: string }>,
  ): Promise<void>;
}

export type MigrationStatus = {
  id: string;
  checksum: string;
  state: "applied" | "pending" | "unverified" | "modified";
};

export type MigrationStatusReport = {
  historyMode: MigrationHistorySnapshot["mode"];
  migrations: MigrationStatus[];
};

export function checksumMigrationSql(sql: string) {
  const canonicalSql = sql.replace(/\r\n?/g, "\n");
  return createHash("sha256").update(canonicalSql, "utf8").digest("hex");
}

function orderMigrations(migrations: MigrationFile[]) {
  const ordered = [...migrations].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const prefixes = new Set<string>();
  const identifiers = new Set<string>();

  for (const migration of ordered) {
    const match = MIGRATION_FILE_PATTERN.exec(migration.id);

    if (!match) {
      throw new Error(
        `Invalid migration filename "${migration.id}". Expected NNNN_name.sql.`,
      );
    }

    const prefix = match[1];

    if (!prefix || prefixes.has(prefix)) {
      throw new Error(`Duplicate migration order prefix "${prefix ?? ""}".`);
    }

    if (identifiers.has(migration.id)) {
      throw new Error(`Duplicate migration identifier "${migration.id}".`);
    }

    if (migration.checksum !== checksumMigrationSql(migration.sql)) {
      throw new Error(`Invalid in-memory checksum for "${migration.id}".`);
    }

    prefixes.add(prefix);
    identifiers.add(migration.id);
  }

  return ordered;
}

export async function loadMigrationFiles(directory: string) {
  const fileNames = (await readdir(directory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
  const migrations = await Promise.all(
    fileNames.map(async (id) => {
      const sql = await readFile(join(directory, id), "utf8");

      return {
        id,
        sql,
        checksum: checksumMigrationSql(sql),
      };
    }),
  );

  return orderMigrations(migrations);
}

function analyzeHistory(
  migrations: MigrationFile[],
  history: MigrationHistorySnapshot,
): MigrationStatus[] {
  const ordered = orderMigrations(migrations);
  const migrationById = new Map(
    ordered.map((migration) => [migration.id, migration]),
  );
  const appliedById = new Map(
    history.applied.map((migration) => [migration.id, migration]),
  );

  for (const applied of history.applied) {
    if (!migrationById.has(applied.id)) {
      throw new Error(
        `Migration history contains unknown identifier "${applied.id}".`,
      );
    }
  }

  let pendingMigrationFound = false;

  return ordered.map((migration) => {
    const applied = appliedById.get(migration.id);

    if (!applied) {
      pendingMigrationFound = true;
      return { ...migration, state: "pending" as const };
    }

    if (pendingMigrationFound) {
      throw new Error(
        `Migration history is out of order at "${migration.id}". ` +
          "Applied migrations must form a contiguous prefix.",
      );
    }

    if (!applied.checksum) {
      return { ...migration, state: "unverified" as const };
    }

    if (applied.checksum !== migration.checksum) {
      return { ...migration, state: "modified" as const };
    }

    return { ...migration, state: "applied" as const };
  });
}

export async function getMigrationStatus(
  database: MigrationDatabase,
  migrations: MigrationFile[],
): Promise<MigrationStatusReport> {
  const history = await database.readMigrationHistory();

  return {
    historyMode: history.mode,
    migrations: analyzeHistory(migrations, history).map(
      ({ id, checksum, state }) => ({ id, checksum, state }),
    ),
  };
}

function assertCurrentHistory(report: MigrationStatusReport) {
  if (report.historyMode === "legacy") {
    throw new Error(
      "Legacy migration history detected. Run " +
        "`pnpm db:migrate:bootstrap -- --accept-existing` after reviewing " +
        "the recorded migration IDs.",
    );
  }

  const modified = report.migrations.find(
    (migration) => migration.state === "modified",
  );

  if (modified) {
    throw new Error(
      `Checksum mismatch for applied migration "${modified.id}". ` +
        "Historical migrations must not be edited.",
    );
  }

  const unverified = report.migrations.find(
    (migration) => migration.state === "unverified",
  );

  if (unverified) {
    throw new Error(
      `Applied migration "${unverified.id}" has no checksum. ` +
        "Bootstrap the legacy history before migrating.",
    );
  }
}

export async function migratePending(
  database: MigrationDatabase,
  migrations: MigrationFile[],
) {
  const ordered = orderMigrations(migrations);

  return database.withMigrationLock(async () => {
    let history = await database.readMigrationHistory();

    if (history.mode === "missing") {
      await database.createMigrationHistory();
      history = await database.readMigrationHistory();
    }

    const report = {
      historyMode: history.mode,
      migrations: analyzeHistory(ordered, history).map(
        ({ id, checksum, state }) => ({ id, checksum, state }),
      ),
    } satisfies MigrationStatusReport;

    assertCurrentHistory(report);
    const pendingIds = new Set(
      report.migrations
        .filter((migration) => migration.state === "pending")
        .map((migration) => migration.id),
    );
    const applied: string[] = [];

    for (const migration of ordered) {
      if (!pendingIds.has(migration.id)) {
        continue;
      }

      await database.applyMigration(migration);
      applied.push(migration.id);
    }

    return applied;
  });
}

export async function bootstrapLegacyMigrationHistory(
  database: MigrationDatabase,
  migrations: MigrationFile[],
) {
  const ordered = orderMigrations(migrations);

  return database.withMigrationLock(async () => {
    const history = await database.readMigrationHistory();

    if (history.mode === "missing") {
      throw new Error(
        "Migration history does not exist. Use `pnpm db:migrate` to " +
          "initialize a new database.",
      );
    }

    if (history.mode === "current") {
      throw new Error("Migration history already requires checksums.");
    }

    const statuses = analyzeHistory(ordered, history);
    const modified = statuses.find((migration) => migration.state === "modified");

    if (modified) {
      throw new Error(
        `Checksum mismatch for applied migration "${modified.id}".`,
      );
    }

    const recordedIds = new Set(history.applied.map((migration) => migration.id));
    const accepted = ordered
      .filter((migration) => recordedIds.has(migration.id))
      .map(({ id, checksum }) => ({ id, checksum }));

    await database.bootstrapMigrationChecksums(accepted);
    return accepted.map((migration) => migration.id);
  });
}
