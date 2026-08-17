import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapLegacyMigrationHistory,
  checksumMigrationSql,
  getMigrationStatus,
  migratePending,
  type AppliedMigration,
  type MigrationDatabase,
  type MigrationFile,
  type MigrationHistorySnapshot,
} from "../src/db/migrations.js";

function migration(id: string, sql = `SELECT '${id}'`) {
  return {
    id,
    sql,
    checksum: checksumMigrationSql(sql),
  } satisfies MigrationFile;
}

class MemoryMigrationDatabase implements MigrationDatabase {
  historyMode: MigrationHistorySnapshot["mode"];
  applied = new Map<string, AppliedMigration>();
  applicationOrder: string[] = [];
  failOn: string | null = null;
  applyDelayMs = 0;
  private lockTail: Promise<void> = Promise.resolve();

  constructor(
    mode: MigrationHistorySnapshot["mode"] = "current",
    applied: AppliedMigration[] = [],
  ) {
    this.historyMode = mode;

    for (const migration of applied) {
      this.applied.set(migration.id, migration);
    }
  }

  async withMigrationLock<T>(operation: () => Promise<T>) {
    const previous = this.lockTail;
    let release = () => {};
    this.lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;

    try {
      return await operation();
    } finally {
      release();
    }
  }

  async readMigrationHistory(): Promise<MigrationHistorySnapshot> {
    return {
      mode: this.historyMode,
      applied: [...this.applied.values()].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    };
  }

  async createMigrationHistory() {
    assert.equal(this.historyMode, "missing");
    this.historyMode = "current";
  }

  async applyMigration(file: MigrationFile) {
    const stagedApplied = new Map(this.applied);
    const stagedOrder = [...this.applicationOrder];

    if (this.applyDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.applyDelayMs));
    }

    if (file.id === this.failOn) {
      throw new Error(`Simulated failure for ${file.id}`);
    }

    stagedApplied.set(file.id, {
      id: file.id,
      checksum: file.checksum,
      appliedAt: new Date("2026-08-17T00:00:00.000Z"),
    });
    stagedOrder.push(file.id);
    this.applied = stagedApplied;
    this.applicationOrder = stagedOrder;
  }

  async bootstrapMigrationChecksums(
    migrations: Array<{ id: string; checksum: string }>,
  ) {
    const staged = new Map(this.applied);

    for (const migration of migrations) {
      const applied = staged.get(migration.id);
      assert.ok(applied);
      staged.set(migration.id, {
        ...applied,
        checksum: migration.checksum,
      });
    }

    this.applied = staged;
    this.historyMode = "current";
  }
}

function applied(
  file: MigrationFile,
  checksum: string | null = file.checksum,
) {
  return {
    id: file.id,
    checksum,
    appliedAt: new Date("2026-08-16T00:00:00.000Z"),
  } satisfies AppliedMigration;
}

test("a pending migration is applied and recorded", async () => {
  const file = migration("0000_first.sql", "CREATE TABLE first (id integer);");
  const database = new MemoryMigrationDatabase("missing");

  const result = await migratePending(database, [file]);

  assert.deepEqual(result, [file.id]);
  assert.deepEqual(database.applicationOrder, [file.id]);
  assert.equal(database.applied.get(file.id)?.checksum, file.checksum);
  assert.equal(database.historyMode, "current");
});

test("an applied migration is never executed again", async () => {
  const file = migration("0000_first.sql");
  const database = new MemoryMigrationDatabase("current", [applied(file)]);

  const result = await migratePending(database, [file]);

  assert.deepEqual(result, []);
  assert.deepEqual(database.applicationOrder, []);
});

test("migrations execute in deterministic filename order", async () => {
  const first = migration("0000_first.sql");
  const second = migration("0001_second.sql");
  const third = migration("0002_third.sql");
  const database = new MemoryMigrationDatabase("missing");

  await migratePending(database, [third, first, second]);

  assert.deepEqual(database.applicationOrder, [
    first.id,
    second.id,
    third.id,
  ]);
});

test("a failed migration is rolled back and later migrations do not run", async () => {
  const first = migration("0000_first.sql");
  const failing = migration("0001_failing.sql", "INVALID SQL;");
  const later = migration("0002_later.sql");
  const database = new MemoryMigrationDatabase("missing");
  database.failOn = failing.id;

  await assert.rejects(
    migratePending(database, [first, failing, later]),
    /Simulated failure/,
  );

  assert.deepEqual(database.applicationOrder, [first.id]);
  assert.equal(database.applied.has(first.id), true);
  assert.equal(database.applied.has(failing.id), false);
  assert.equal(database.applied.has(later.id), false);
});

test("a changed checksum aborts before pending migrations execute", async () => {
  const first = migration("0000_first.sql");
  const second = migration("0001_second.sql");
  const database = new MemoryMigrationDatabase("current", [
    applied(first, "different-checksum"),
  ]);

  const report = await getMigrationStatus(database, [first, second]);
  assert.equal(report.migrations[0]?.state, "modified");

  await assert.rejects(
    migratePending(database, [first, second]),
    /Checksum mismatch.*0000_first\.sql/,
  );
  assert.deepEqual(database.applicationOrder, []);
});

test("checksums are stable across operating-system line endings", () => {
  const windowsSql = "CREATE TABLE example (id integer);\r\nSELECT 1;\r\n";
  const unixSql = "CREATE TABLE example (id integer);\nSELECT 1;\n";

  assert.equal(checksumMigrationSql(windowsSql), checksumMigrationSql(unixSql));
});

test("the migration lock serializes concurrent runners", async () => {
  const file = migration("0000_first.sql");
  const database = new MemoryMigrationDatabase("missing");
  database.applyDelayMs = 20;

  const results = await Promise.all([
    migratePending(database, [file]),
    migratePending(database, [file]),
  ]);

  assert.deepEqual(results, [[file.id], []]);
  assert.deepEqual(database.applicationOrder, [file.id]);
});

test("legacy history requires explicit bootstrap and preserves recorded IDs", async () => {
  const first = migration("0000_first.sql");
  const second = migration("0001_second.sql");
  const database = new MemoryMigrationDatabase("legacy", [
    applied(first, null),
  ]);

  await assert.rejects(
    migratePending(database, [first, second]),
    /Legacy migration history detected/,
  );

  const accepted = await bootstrapLegacyMigrationHistory(database, [
    first,
    second,
  ]);

  assert.deepEqual(accepted, [first.id]);
  assert.equal(database.applied.get(first.id)?.checksum, first.checksum);
  assert.equal(database.applied.has(second.id), false);

  const migrated = await migratePending(database, [first, second]);
  assert.deepEqual(migrated, [second.id]);
});
