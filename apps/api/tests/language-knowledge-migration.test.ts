import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("M11 language knowledge migration is additive and preserves append-only review invariants", async () => {
  const migration = await readFile(
    new URL("../drizzle/0022_create_language_knowledge_registry.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /CREATE TABLE language_knowledge_profiles/);
  assert.match(migration, /CREATE TABLE language_decision_registry_versions/);
  assert.match(migration, /CREATE TABLE language_decision_proposals/);
  assert.match(migration, /profile jsonb NOT NULL/);
  assert.match(migration, /registry jsonb NOT NULL/);
  assert.match(migration, /proposed_decision jsonb NOT NULL/);
  assert.match(migration, /status IN \('pending_review', 'accepted', 'rejected'\)/);
  assert.match(migration, /promoted_registry_record_id uuid REFERENCES language_decision_registry_versions/);
  assert.match(migration, /language_decision_proposals_review_state_check/);
  assert.match(migration, /language_knowledge_profiles_user_profile_version_unique/);
  assert.match(migration, /language_decision_registry_versions_user_registry_version_unique/);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b|(?:^|;)\s*DELETE\b/im);
  assert.doesNotMatch(migration, /ALTER TABLE/i);
});
