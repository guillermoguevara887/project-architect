import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { users } from "../src/db/schema.js";

test("user role and session version migration is additive and limited to users", async () => {
  const migration = await readFile(
    new URL("../drizzle/0028_add_user_role_and_session_version.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /ADD COLUMN "role" text DEFAULT 'user' NOT NULL/);
  assert.match(migration, /ADD COLUMN "session_version" integer DEFAULT 1 NOT NULL/);
  assert.match(migration, /CONSTRAINT "users_role_check"\s+CHECK \("role" IN \('user', 'superadmin'\)\)/);
  assert.match(migration, /CONSTRAINT "users_session_version_check"\s+CHECK \("session_version" >= 1\)/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT|CREATE)\b/i);
  assert.doesNotMatch(migration, /ALTER TABLE "(?!users")/i);
  assert.doesNotMatch(migration, /password_reset_tokens|password_change_required/i);
});

test("Drizzle users schema matches the role and session version database contract", () => {
  assert.equal(users.role.name, "role");
  assert.equal(users.role.getSQLType(), "text");
  assert.equal(users.role.notNull, true);
  assert.equal(users.role.default, "user");
  assert.equal(users.sessionVersion.name, "session_version");
  assert.equal(users.sessionVersion.getSQLType(), "integer");
  assert.equal(users.sessionVersion.notNull, true);
  assert.equal(users.sessionVersion.default, 1);

  const dialect = new PgDialect();
  const checks = new Map(
    getTableConfig(users).checks.map((constraint) => [
      constraint.name,
      dialect.sqlToQuery(constraint.value).sql,
    ]),
  );
  assert.equal(checks.get("users_role_check"), '"users"."role" in (\'user\', \'superadmin\')');
  assert.equal(checks.get("users_session_version_check"), '"users"."session_version" >= 1');
});
