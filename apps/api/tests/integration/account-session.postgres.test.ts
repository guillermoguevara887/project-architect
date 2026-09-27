import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { accountStore } from "../../src/account/repository.js";
import { authStore } from "../../src/auth/repository.js";
import { hashPassword, verifyPassword } from "../../src/auth/password.js";
import { closeDbConnection } from "../../src/db/client.js";
import { loadMigrationFiles, migratePending } from "../../src/db/migrations.js";
import { createPostgresMigrationDatabase } from "../../src/db/postgres-migration-database.js";

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;
if (!databaseUrl || process.env.MIGRATION_TEST_ALLOW_LOCAL !== "1") {
  throw new Error("Account session integration tests require the isolated PostgreSQL harness.");
}
const parsedUrl = new URL(databaseUrl);
if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsedUrl.hostname) ||
    parsedUrl.pathname !== "/memoos_migration_admin") {
  throw new Error("Refusing to run outside the disposable local database.");
}

test("PostgreSQL password changes and recovery revoke sessions atomically", async (t) => {
  const admin = postgres(databaseUrl, { max: 1 });
  const databaseName = `memoos_it_${process.pid}_account_session`;
  const isolatedUrl = new URL(databaseUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const database = createPostgresMigrationDatabase(isolatedUrl.toString());
  const sql = postgres(isolatedUrl.toString(), { max: 3 });

  async function seedUser() {
    const id = randomUUID();
    await sql`INSERT INTO users (id, username, password_hash) VALUES (${id}, ${id}, 'initial-test-hash')`;
    return id;
  }

  async function seedToken(userId: string) {
    const tokenHash = createHash("sha256").update(randomUUID()).digest("hex");
    await accountStore.createPasswordResetToken({ userId, tokenHash, expiresAt: new Date(Date.now() + 60_000) });
    return tokenHash;
  }

  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    const migrations = await loadMigrationFiles(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle"));
    await migratePending(database, migrations);
    process.env.DATABASE_URL = isolatedUrl.toString();

    await t.test("stores return the persisted version and password change returns its atomic increment", async () => {
      const id = await seedUser();
      assert.equal((await authStore.findById(id))?.sessionVersion, 1);
      assert.equal((await authStore.findByUsername(id))?.sessionVersion, 1);
      const hash = await hashPassword("new-integration-password");
      assert.equal(await accountStore.updatePassword(id, hash, 1), 2);
      const account = await accountStore.findById(id);
      assert.equal(account?.sessionVersion, 2);
      assert.equal(await verifyPassword("new-integration-password", account!.passwordHash), true);
      assert.equal((await authStore.findById(id))?.sessionVersion, 2);
    });

    await t.test("concurrent authenticated changes cannot overwrite credentials authorized with a stale version", async () => {
      const id = await seedUser();
      const versions = await Promise.all([
        accountStore.updatePassword(id, "first-test-hash", 1),
        accountStore.updatePassword(id, "second-test-hash", 1),
      ]);
      assert.equal(versions.filter((version) => version === 2).length, 1);
      assert.equal(versions.filter((version) => version === null).length, 1);
      const account = await accountStore.findById(id);
      assert.equal(account?.sessionVersion, 2);
      assert.equal(account?.passwordHash, versions[0] === 2 ? "first-test-hash" : "second-test-hash");
      assert.equal(await accountStore.updatePassword(id, "third-test-hash", 2), 3);
    });

    await t.test("concurrent recovery increments are not lost and unrelated tokens remain usable", async () => {
      const id = await seedUser();
      const first = await seedToken(id);
      const second = await seedToken(id);
      const pending = await seedToken(id);
      const results = await Promise.all([
        accountStore.resetPasswordWithToken({ tokenHash: first, passwordHash: "first-reset-hash", now: new Date() }),
        accountStore.resetPasswordWithToken({ tokenHash: second, passwordHash: "second-reset-hash", now: new Date() }),
      ]);
      assert.deepEqual(results, [true, true]);
      const account = await accountStore.findById(id);
      assert.equal(account?.sessionVersion, 3);
      assert.ok(["first-reset-hash", "second-reset-hash"].includes(account!.passwordHash));
      assert.equal(await accountStore.hasUsablePasswordResetToken(first, new Date()), false);
      assert.equal(await accountStore.hasUsablePasswordResetToken(second, new Date()), false);
      assert.equal(await accountStore.hasUsablePasswordResetToken(pending, new Date()), true);
      assert.equal(await accountStore.resetPasswordWithToken({ tokenHash: first, passwordHash: "reused-hash", now: new Date() }), false);
      assert.equal((await accountStore.findById(id))?.sessionVersion, 3);
    });

    await t.test("recovery and authenticated change races retain every successful increment", async () => {
      const id = await seedUser();
      const tokenHash = await seedToken(id);
      const [changeVersion, recovered] = await Promise.all([
        accountStore.updatePassword(id, "change-hash", 1),
        accountStore.resetPasswordWithToken({ tokenHash, passwordHash: "recovery-hash", now: new Date() }),
      ]);
      assert.equal(recovered, true);
      assert.ok(changeVersion === null || changeVersion === 2);
      const account = await accountStore.findById(id);
      assert.equal(account?.sessionVersion, changeVersion === null ? 2 : 3);
      assert.equal(account?.passwordHash, "recovery-hash");
      assert.equal(await accountStore.updatePassword(id, "stale-change-hash", 1), null);
    });

    await t.test("a failed recovery update rolls back token consumption and password changes", async () => {
      const id = await seedUser();
      const tokenHash = await seedToken(id);
      await sql`UPDATE users SET session_version = 2147483647 WHERE id = ${id}`;
      await assert.rejects(accountStore.resetPasswordWithToken({ tokenHash, passwordHash: "must-not-persist", now: new Date() }));
      const account = await accountStore.findById(id);
      assert.equal(account?.passwordHash, "initial-test-hash");
      assert.equal(account?.sessionVersion, 2147483647);
      assert.equal(await accountStore.hasUsablePasswordResetToken(tokenHash, new Date()), true);
    });
  } finally {
    await closeDbConnection();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await sql.end({ timeout: 5 });
    await database.close();
    await admin.end({ timeout: 5 });
  }
});
