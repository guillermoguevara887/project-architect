import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("account recovery migration is additive and enforces its invariants", async () => {
  const migration = await readFile(
    new URL("../drizzle/0014_add_account_recovery.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /ALTER TABLE "users" ADD COLUMN "email" text/);
  assert.match(migration, /users_email_normalized_check/);
  assert.match(migration, /CREATE UNIQUE INDEX "users_email_unique"/);
  assert.match(migration, /WHERE "email" IS NOT NULL/);
  assert.match(migration, /CREATE TABLE "password_reset_tokens"/);
  assert.match(migration, /REFERENCES "users" \("id"\) ON DELETE CASCADE/);
  assert.match(migration, /password_reset_tokens_expiry_check/);
  assert.match(migration, /password_reset_tokens_token_hash_unique/);
  assert.match(migration, /password_reset_tokens_user_created_at_idx/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b|(?:^|;)\s*DELETE\b/im);
  assert.doesNotMatch(migration, /ALTER TABLE "(?!users")/i);
});
