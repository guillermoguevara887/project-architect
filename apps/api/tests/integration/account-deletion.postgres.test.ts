import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { deleteUserAccount } from "../../src/account-deletion/service.js";
import type { AccountObjectStorage } from "../../src/account-deletion/storage.js";
import { closeDbConnection } from "../../src/db/client.js";
import { loadMigrationFiles, migratePending } from "../../src/db/migrations.js";
import { createPostgresMigrationDatabase } from "../../src/db/postgres-migration-database.js";
import { languageAudioStore } from "../../src/languages/audio-repository.js";
import { getOrCreateLanguageAudio } from "../../src/languages/audio.js";
import { curriculumDocumentStore } from "../../src/languages/documents/repository.js";
import { CurriculumDocumentService } from "../../src/languages/documents/service.js";

const adminUrl = process.env.MIGRATION_TEST_DATABASE_URL;
if (!adminUrl || process.env.MIGRATION_TEST_ALLOW_LOCAL !== "1") {
  throw new Error("Account deletion integration requires explicit local PostgreSQL harness.");
}
const parsed = new URL(adminUrl);
if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(parsed.hostname) ||
    parsed.pathname !== "/memoos_migration_admin") {
  throw new Error("Refusing to run outside the disposable local database.");
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function databaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; cause?: unknown };
  return typeof value.code === "string" ? value.code : databaseErrorCode(value.cause);
}

async function until(promise: Promise<unknown>, label: string) {
  await Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out: ${label}`)), 3_000)),
  ]);
}

test("GUI-17 migration, deletion, and PostgreSQL lock races", async (t) => {
  const admin = postgres(adminUrl, { max: 1 });
  const name = `memoos_it_${process.pid}_account_deletion`;
  const isolatedUrl = new URL(adminUrl);
  isolatedUrl.pathname = `/${name}`;
  const migrationDb = createPostgresMigrationDatabase(isolatedUrl.toString());
  const db = postgres(isolatedUrl.toString(), { max: 12 });
  const previousUrl = process.env.DATABASE_URL;

  async function user(role = "user") {
    const id = randomUUID();
    await db`INSERT INTO users (id, username, password_hash, role) VALUES (${id}, ${id}, 'test-hash', ${role})`;
    return id;
  }

  async function audio(userId: string, key = randomUUID()) {
    const startedAt = new Date();
    const [row] = await db<{ id: string; generation_started_at: Date }[]>`
      INSERT INTO language_audio_assets
        (user_id, language, normalized_text, original_text, provider, model, voice,
         audio_format, storage_key, status, generation_started_at)
      VALUES (${userId}, 'en', ${key}, ${key}, 'openai', 'model', 'voice', 'mp3', ${key},
              'generating', ${startedAt})
      RETURNING id, generation_started_at`;
    return { id: row!.id, startedAt: row!.generation_started_at, key };
  }

  async function document(userId: string, key = randomUUID()) {
    const [next] = await db<{ unit_order: number }[]>`
      SELECT COALESCE(MAX(unit_order), 0) + 1 AS unit_order
      FROM language_curriculum_documents WHERE curriculum_id='memoos-core-language' AND level_id='A1'`;
    const unitOrder = next!.unit_order;
    const unitId = `A1-U${String(unitOrder).padStart(2, "0")}`;
    const [doc] = await db<{ id: string }[]>`
      INSERT INTO language_curriculum_documents (uploaded_by_user_id, document_id, curriculum_id, level_id, unit_id, unit_order)
      VALUES (${userId}, ${key}, 'memoos-core-language', 'A1', ${unitId}, ${unitOrder}) RETURNING id`;
    const [version] = await db<{ id: string }[]>`
      INSERT INTO language_curriculum_document_versions
        (document_record_id, document_version, source_title, source_format,
         original_filename, media_type, storage_key, content_sha256, byte_size)
      VALUES (${doc!.id}, 'v1', 'source', 'plain_text', 'source.txt', 'text/plain',
              ${key}, ${"a".repeat(64)}, 1) RETURNING id`;
    return { id: version!.id, key, documentId: key, unitId, unitOrder };
  }

  async function unit(userId: string) {
    const version = await document(userId);
    const [run] = await db<{ id: string }[]>`
      INSERT INTO language_curriculum_compilation_runs (document_version_id, boundary_key)
      VALUES (${version.id}, 'test') RETURNING id`;
    const [record] = await db<{ id: string }[]>`
      INSERT INTO language_curriculum_units
        (compilation_run_id, unit_id, spec_version, unit_order, status, spec)
      VALUES (${run!.id}, ${version.unitId}, 'v1', ${version.unitOrder}, 'draft', ${{}})
      RETURNING id`;
    return record!.id;
  }

  async function bundle(userId: string, unitId: string) {
    const hash = "b".repeat(64);
    const [bundle] = await db<{ id: string }[]>`
      INSERT INTO language_curriculum_planning_bundles
        (user_id, curriculum_unit_record_id, language_id, variety_id, level_id, unit_id,
         curriculum_unit_spec, language_profile, decision_registry, adaptation_plan,
         adapted_unit_spec, lesson_route, lesson_specs, content_sha256)
      VALUES (${userId}, ${unitId}, 'en', 'general', 'A1', 'unit',
              ${{}}, ${{}}, ${{}}, ${{}}, ${{}}, ${{}}, ${[{}]}, ${hash}) RETURNING id`;
    return bundle!.id;
  }

  async function extendedGraph(userId: string) {
    const unitId = await unit(userId);
    const hash = "b".repeat(64);
    const bundleId = await bundle(userId, unitId);
    const [orchestration] = await db<{ id: string }[]>`INSERT INTO language_curriculum_orchestration_runs
      (user_id, planning_bundle_id, expected_lesson_count)
      VALUES (${userId}, ${bundleId}, 1) RETURNING id`;
    await db`INSERT INTO language_curriculum_unit_reviews
      (reviewed_by_user_id, source_unit_record_id, action, review_note)
      VALUES (${userId}, ${unitId}, 'rejected', 'test')`;
    const [profile] = await db<{ id: string }[]>`
      INSERT INTO language_knowledge_profiles
        (user_id, profile_id, language_id, variety_id, version, status, profile, content_sha256)
      VALUES (${userId}, ${randomUUID()}, 'en', 'general', 'v1', 'draft', ${{}}, ${hash}) RETURNING id`;
    const [registry] = await db<{ id: string }[]>`
      INSERT INTO language_decision_registry_versions
        (user_id, profile_record_id, registry_id, language_id, variety_id,
         curriculum_id, version, status, registry, content_sha256)
      VALUES (${userId}, ${profile!.id}, ${randomUUID()}, 'en', 'general',
              'curriculum', 'v1', 'draft', ${{}}, ${hash}) RETURNING id`;
    const [proposal] = await db<{ id: string }[]>`INSERT INTO language_decision_proposals
      (user_id, profile_record_id, base_registry_record_id, adaptation_plan_id,
       adaptation_plan_version, research_task_ref, operation, requirement_refs,
       decision_id, decision_version, proposed_decision, proposal_sha256)
      VALUES (${userId}, ${profile!.id}, ${registry!.id}, 'plan', 'v1', 'task',
              'create', ${["requirement"]}, ${randomUUID()}, 'v1', ${{}}, ${hash}) RETURNING id`;
    const [resolution] = await db<{ id: string }[]>`
      INSERT INTO language_adaptation_resolution_runs
        (user_id, curriculum_unit_record_id, profile_record_id, registry_record_id,
         stage, adaptation_plan, content_sha256)
      VALUES (${userId}, ${unitId}, ${profile!.id}, ${registry!.id},
              'ready_for_planning', ${{}}, ${hash}) RETURNING id`;
    const [research] = await db<{ id: string }[]>`INSERT INTO language_profile_research_runs
      (user_id, adaptation_resolution_run_id, base_profile_record_id, stage, content_sha256)
      VALUES (${userId}, ${resolution!.id}, ${profile!.id}, 'failed', ${hash}) RETURNING id`;
    const [generation] = await db<{ id: string }[]>`
      INSERT INTO language_lesson_generation_runs
        (user_id, lesson_spec_id, lesson_spec_version, language_id, variety_id,
         level_id, unit_id, route_node_ref, generation_intent, lesson_spec,
         generator_key, provider)
      VALUES (${userId}, ${randomUUID()}, 'v1', 'en', 'general', 'A1', 'unit',
              'route', 'canonical', ${{}}, 'test', 'test') RETURNING id`;
    await db`INSERT INTO language_generated_lessons
      (id, generation_run_id, generated_lesson, content_sha256)
      VALUES (${randomUUID()}, ${generation!.id}, ${{}}, ${hash})`;
    await db`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (${userId}, ${randomUUID()}, ${new Date(Date.now() + 60_000)})`;
    return {
      unitId, bundleId, orchestrationId: orchestration!.id,
      profileId: profile!.id, registryId: registry!.id,
      proposalId: proposal!.id, resolutionId: resolution!.id, researchId: research!.id,
    };
  }

  function storage() {
    const deleted: string[][] = [];
    return {
      deleted,
      store: { async deleteKeys(keys: readonly string[]) { deleted.push([...keys]); } } satisfies AccountObjectStorage,
    };
  }

  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    const migrations = await loadMigrationFiles(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "drizzle"));
    assert.equal(migrations.filter((migration) => migration.id.startsWith("0029_")).length, 1);
    await migratePending(migrationDb, migrations);
    process.env.DATABASE_URL = isolatedUrl.toString();

    await t.test("migration changes exactly the three direct user FK actions", async () => {
      const constraints = await db<{ conname: string; confdeltype: string }[]>`
        SELECT c.conname, c.confdeltype
        FROM pg_constraint c JOIN pg_class parent ON parent.oid=c.confrelid
        WHERE c.contype='f' AND parent.relname='users' ORDER BY c.conname`;
      assert.equal(constraints.length, 16);
      const cascades = ["architect_projects_user_id_fkey", "journey_ideas_user_id_fkey", "language_projects_user_id_fkey"];
      for (const name of cascades) {
        assert.equal(constraints.find((row) => row.conname === name)?.confdeltype, "c");
      }
      assert.deepEqual(constraints.filter((row) => row.confdeltype !== "c").map((row) => row.conname).sort(), [
        "language_curriculum_documents_uploaded_by_user_id_fkey",
        "language_curriculum_unit_reviews_reviewed_by_user_id_fkey",
      ]);
    });

    await t.test("superadmin is protected without session revocation or R2 access", async () => {
      const id = await user("superadmin");
      const { store, deleted } = storage();
      assert.equal(await deleteUserAccount(id, { storage: store }), "forbidden_role");
      const [row] = await db<{ role: string; session_version: number }[]>`SELECT role, session_version FROM users WHERE id=${id}`;
      assert.deepEqual(row, { role: "superadmin", session_version: 1 });
      assert.deepEqual(deleted, []);
    });

    await t.test("global units and review actors do not create cross-user ownership violations", async () => {
      const a = await user(), b = await user();
      const unitA = await unit(a), unitB = await unit(b);
      await db`INSERT INTO language_curriculum_unit_reviews
        (reviewed_by_user_id, source_unit_record_id, action, review_note)
        VALUES (${b}, ${unitA}, 'rejected', 'cross-owner')`;
      await db`INSERT INTO language_curriculum_planning_bundles
        (user_id, curriculum_unit_record_id, language_id, variety_id, level_id, unit_id,
         curriculum_unit_spec, language_profile, decision_registry, adaptation_plan,
         adapted_unit_spec, lesson_route, lesson_specs, content_sha256)
        VALUES (${a}, ${unitB}, 'en', 'general', 'A1', 'unit',
                ${{}}, ${{}}, ${{}}, ${{}}, ${{}}, ${{}}, ${[{}]}, ${"a".repeat(64)})`;
      const sharedBundle = await bundle(b, unitA);
      const { store, deleted } = storage();
      assert.equal(await deleteUserAccount(a, { storage: store }), "deleted");
      assert.deepEqual(deleted, [[]]);
      assert.equal((await db`SELECT 1 FROM users WHERE id=${a}`).length, 0);
      assert.equal((await db`SELECT 1 FROM users WHERE id=${b}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_curriculum_unit_reviews WHERE reviewed_by_user_id=${b}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_curriculum_units WHERE id=${unitA}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_curriculum_units WHERE id=${unitB}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_curriculum_planning_bundles WHERE id=${sharedBundle}`).length, 1);
    });

    await t.test("cascades owned graph, preserves B and global rows, and is idempotent", async () => {
      const graphTables = [
        "language_curriculum_compilation_runs", "language_curriculum_units",
        "language_curriculum_planning_bundles", "language_curriculum_orchestration_runs",
        "language_curriculum_unit_reviews", "language_knowledge_profiles",
        "language_decision_registry_versions", "language_decision_proposals",
        "language_adaptation_resolution_runs", "language_profile_research_runs",
        "language_lesson_generation_runs", "language_generated_lessons", "password_reset_tokens",
      ];
      const baseline = new Map<string, number>();
      for (const table of graphTables) {
        const [row] = await db.unsafe<{ count: number }[]>(`SELECT count(*)::integer AS count FROM ${table}`);
        baseline.set(table, row!.count);
      }
      const a = await user();
      const b = await user();
      const keyA = await audio(a);
      const keyB = await audio(b);
      const docA = await document(a);
      const docB = await document(b);
      for (const owner of [a, b]) {
        const readyAudio = await audio(owner);
        const failedAudio = await audio(owner);
        await db`UPDATE language_audio_assets SET status='ready', generation_started_at=NULL WHERE id=${readyAudio.id}`;
        await db`UPDATE language_audio_assets SET status='failed', generation_started_at=NULL WHERE id=${failedAudio.id}`;
        const readyDocument = await document(owner);
        const failedDocument = await document(owner);
        await db`UPDATE language_curriculum_document_versions SET storage_status='ready' WHERE id=${readyDocument.id}`;
        await db`UPDATE language_curriculum_document_versions SET storage_status='failed' WHERE id=${failedDocument.id}`;
        await db`INSERT INTO exercises (user_id, title, prompt) VALUES (${owner}, 'Exercise', 'Prompt')`;
      }
      await extendedGraph(a);
      await extendedGraph(b);
      const [projectA] = await db<{ id: string }[]>`INSERT INTO architect_projects (user_id, project_type) VALUES (${a}, 'project') RETURNING id`;
      const [projectB] = await db<{ id: string }[]>`INSERT INTO architect_projects (user_id, project_type) VALUES (${b}, 'project') RETURNING id`;
      await db`INSERT INTO project_links (project_id, name, url) VALUES (${projectA!.id}, 'A', 'https://example.com/a'), (${projectB!.id}, 'B', 'https://example.com/b')`;
      const [ideaA] = await db<{ id: string }[]>`INSERT INTO journey_ideas (user_id, title, source_type, source_reference) VALUES (${a}, 'A', 'url', 'a') RETURNING id`;
      const [ideaB] = await db<{ id: string }[]>`INSERT INTO journey_ideas (user_id, title, source_type, source_reference) VALUES (${b}, 'B', 'url', 'b') RETURNING id`;
      await db`INSERT INTO journey_feed_entries (idea_id, content) VALUES (${ideaA!.id}, 'A'), (${ideaB!.id}, 'B')`;
      const [languageA] = await db<{ id: string }[]>`INSERT INTO language_projects (user_id, language, level) VALUES (${a}, 'en', 'A1') RETURNING id`;
      const [languageB] = await db<{ id: string }[]>`INSERT INTO language_projects (user_id, language, level) VALUES (${b}, 'en', 'A1') RETURNING id`;
      await db`INSERT INTO language_lessons (language_project_id, lesson_number, source_lesson_number) VALUES (${languageA!.id}, 1, 1), (${languageB!.id}, 1, 1)`;
      const [global] = await db<{ id: string }[]>`INSERT INTO projects (name, project_type, global_objective) VALUES ('Global', 'research', 'keep') RETURNING id`;
      await db`INSERT INTO discovery_sessions (project_id) VALUES (${global!.id})`;
      const globalProfile = `global-${randomUUID()}`;
      await db.begin(async (tx) => {
        const [candidate] = await tx<{ id: string }[]>`
          INSERT INTO language_profile_v2_candidates
            (profile_id, version, schema_version, contract_version, status,
             snapshot_json, content_sha256, candidate_sha256, lineage)
          VALUES (${globalProfile}, '1.0.0', '2.0.0', '1.0.0', 'review', '{}',
                  ${"d".repeat(64)}, ${"e".repeat(64)}, ${{}}) RETURNING id`;
        const canonicalId = randomUUID();
        const [decision] = await tx<{ id: string }[]>`
          INSERT INTO language_profile_v2_decisions
            (profile_id, candidate_record_id, action, decision_json, canonical_record_id)
          VALUES (${globalProfile}, ${candidate!.id}, 'ACCEPT', ${{}}, ${canonicalId})
          RETURNING id`;
        await tx`INSERT INTO language_profile_v2_canonicals
          (id, profile_id, version, schema_version, contract_version, status,
           snapshot_json, content_sha256, candidate_record_id, decision_record_id)
          VALUES (${canonicalId}, ${globalProfile}, '1.0.0', '2.0.0', '1.0.0',
                  'canonical', '{}', ${"d".repeat(64)}, ${candidate!.id}, ${decision!.id})`;
      });
      const expectedKeys = [
        ...(await db<{ storage_key: string }[]>`SELECT storage_key FROM language_audio_assets WHERE user_id=${a}`),
      ].map((row) => row.storage_key);
      const { store, deleted } = storage();
      assert.equal(await deleteUserAccount(a, { storage: store }), "deleted");
      assert.deepEqual(new Set(deleted[0]), new Set(expectedKeys));
      assert.equal(await deleteUserAccount(a, { storage: store }), "already_deleted");
      assert.equal(deleted.length, 1);
      for (const table of ["architect_projects", "project_links", "journey_ideas", "journey_feed_entries", "language_projects", "language_lessons", "exercises"]) {
        const [count] = await db.unsafe<{ count: number }[]>(`SELECT count(*)::integer AS count FROM ${table}`);
        assert.equal(count!.count, 1, table);
      }
      assert.equal((await db`SELECT 1 FROM users WHERE id=${a}`).length, 0);
      assert.equal((await db`SELECT 1 FROM users WHERE id=${b}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_audio_assets WHERE storage_key=${keyB.key}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_audio_assets WHERE user_id=${a}`).length, 0);
      assert.equal((await db`SELECT 1 FROM language_audio_assets WHERE user_id=${b}`).length, 3);
      assert.equal((await db`SELECT 1 FROM language_curriculum_document_versions WHERE storage_key=${docB.key}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_curriculum_document_versions WHERE storage_key=${docA.key}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_curriculum_documents WHERE uploaded_by_user_id=${a}`).length, 0);
      assert.equal((await db`SELECT 1 FROM language_curriculum_documents WHERE uploaded_by_user_id IS NULL`).length >= 4, true);
      assert.equal((await db`SELECT 1 FROM language_curriculum_documents WHERE uploaded_by_user_id=${b}`).length, 4);
      assert.equal((await db`SELECT 1 FROM projects WHERE id=${global!.id}`).length, 1);
      assert.equal((await db`SELECT 1 FROM discovery_sessions WHERE project_id=${global!.id}`).length, 1);
      for (const table of ["language_profile_v2_candidates", "language_profile_v2_decisions", "language_profile_v2_canonicals"]) {
        const [row] = await db.unsafe<{ count: number }[]>(`SELECT count(*)::integer AS count FROM ${table} WHERE profile_id=$1`, [globalProfile]);
        assert.equal(row!.count, 1, table);
      }
      for (const table of graphTables) {
        const [count] = await db.unsafe<{ count: number }[]>(`SELECT count(*)::integer AS count FROM ${table}`);
        const globalTable = ["language_curriculum_compilation_runs", "language_curriculum_units", "language_curriculum_unit_reviews"].includes(table);
        assert.equal(count!.count, baseline.get(table)! + (globalTable ? 2 : 1), table);
      }
    });

    for (const direction of ["other_run_to_target_bundle", "target_run_to_other_bundle"] as const) {
      await t.test(`orchestration ownership preflight: ${direction}`, async () => {
        const a = await user(), b = await user();
        const bundleA = await bundle(a, await unit(a));
        const bundleB = await bundle(b, await unit(b));
        const runOwner = direction === "other_run_to_target_bundle" ? b : a;
        const referencedBundle = direction === "other_run_to_target_bundle" ? bundleA : bundleB;
        const [run] = await db<{ id: string }[]>`
          INSERT INTO language_curriculum_orchestration_runs
            (user_id, planning_bundle_id, expected_lesson_count)
          VALUES (${runOwner}, ${referencedBundle}, 1) RETURNING id`;
        const { store, deleted } = storage();
        assert.equal(await deleteUserAccount(a, { storage: store }), "ownership_violation");
        assert.deepEqual(deleted, []);
        assert.equal((await db`SELECT 1 FROM users WHERE id=${a}`).length, 1);
        assert.equal((await db`SELECT 1 FROM users WHERE id=${b}`).length, 1);
        assert.equal((await db`SELECT 1 FROM language_curriculum_orchestration_runs WHERE id=${run!.id}`).length, 1);
        assert.equal((await db`SELECT 1 FROM language_curriculum_planning_bundles WHERE id=${referencedBundle}`).length, 1);
      });
    }

    for (const edge of ["planning_bundle", "unit_review"] as const) {
      for (const direction of ["other_to_target", "target_to_other"] as const) {
        await t.test(`${edge} ownership preflight: ${direction}`, async () => {
          const a = await user(), b = await user();
          const unitA = await unit(a), unitB = await unit(b);
          const owner = direction === "other_to_target" ? b : a;
          const referencedUnit = direction === "other_to_target" ? unitA : unitB;
          let rowId: string;
          if (edge === "planning_bundle") {
            rowId = await bundle(owner, referencedUnit);
          } else {
            const [row] = await db<{ id: string }[]>`
              INSERT INTO language_curriculum_unit_reviews
                (reviewed_by_user_id, source_unit_record_id, action, review_note)
              VALUES (${owner}, ${referencedUnit}, 'rejected', 'cross-owner') RETURNING id`;
            rowId = row!.id;
          }
          const { store, deleted } = storage();
          assert.equal(await deleteUserAccount(a, { storage: store }), "deleted");
          assert.deepEqual(deleted, [[]]);
          assert.equal((await db`SELECT 1 FROM users WHERE id=${a}`).length, 0);
          assert.equal((await db`SELECT 1 FROM users WHERE id=${b}`).length, 1);
          const table = edge === "planning_bundle"
            ? "language_curriculum_planning_bundles" : "language_curriculum_unit_reviews";
          assert.equal((await db.unsafe(`SELECT 1 FROM ${table} WHERE id=$1`, [rowId])).length,
            edge === "unit_review" || owner === b ? 1 : 0);
        });
      }
    }

    for (const direction of ["other_to_target", "target_to_other"] as const) {
      await t.test(`split lesson ownership preflight: ${direction}`, async () => {
        const a = await user(), b = await user();
        const [projectA] = await db<{ id: string }[]>`INSERT INTO language_projects (user_id, language, level) VALUES (${a}, 'en', 'A1') RETURNING id`;
        const [projectB] = await db<{ id: string }[]>`INSERT INTO language_projects (user_id, language, level) VALUES (${b}, 'en', 'A1') RETURNING id`;
        const parentProject = direction === "other_to_target" ? projectA!.id : projectB!.id;
        const childProject = direction === "other_to_target" ? projectB!.id : projectA!.id;
        const [parent] = await db<{ id: string }[]>`
          INSERT INTO language_lessons
            (language_project_id, lesson_number, source_lesson_number, lesson_source)
          VALUES (${parentProject}, 1, 1, 'language_framework') RETURNING id`;
        const [child] = await db<{ id: string }[]>`
          INSERT INTO language_lessons
            (language_project_id, lesson_number, source_lesson_number, lesson_source,
             split_parent_lesson_id, split_part)
          VALUES (${childProject}, 1, 1, 'language_framework', ${parent!.id}, 'A') RETURNING id`;
        const { store, deleted } = storage();
        assert.equal(await deleteUserAccount(a, { storage: store }), "ownership_violation");
        assert.deepEqual(deleted, []);
        assert.equal((await db`SELECT 1 FROM users WHERE id=${a}`).length, 1);
        assert.equal((await db`SELECT 1 FROM users WHERE id=${b}`).length, 1);
        assert.equal((await db`SELECT 1 FROM language_lessons WHERE id=${parent!.id}`).length, 1);
        assert.equal((await db`SELECT 1 FROM language_lessons WHERE id=${child!.id}`).length, 1);
      });
    }

    await t.test("NO ACTION user-owned edges reject both cross-user directions before R2", async () => {
      const a = await user(), b = await user();
      const graphA = await extendedGraph(a), graphB = await extendedGraph(b);
      for (const graph of [graphA, graphB]) {
        await db`UPDATE language_decision_proposals
          SET status='accepted', reviewed_at=now(), review_note='accepted',
              review_evidence_status='verified', review_confidence='high',
              promoted_registry_record_id=${graph.registryId}
          WHERE id=${graph.proposalId}`;
      }
      const edges = [
        ["language_decision_registry_versions", "profile_record_id", "registryId", "profileId"],
        ["language_decision_proposals", "profile_record_id", "proposalId", "profileId"],
        ["language_decision_proposals", "base_registry_record_id", "proposalId", "registryId"],
        ["language_decision_proposals", "promoted_registry_record_id", "proposalId", "registryId"],
        ["language_adaptation_resolution_runs", "profile_record_id", "resolutionId", "profileId"],
        ["language_adaptation_resolution_runs", "registry_record_id", "resolutionId", "registryId"],
        ["language_adaptation_resolution_runs", "previous_run_id", "resolutionId", "resolutionId"],
        ["language_profile_research_runs", "adaptation_resolution_run_id", "researchId", "resolutionId"],
        ["language_profile_research_runs", "resumed_resolution_run_id", "researchId", "resolutionId"],
        ["language_profile_research_runs", "base_profile_record_id", "researchId", "profileId"],
        ["language_profile_research_runs", "enriched_profile_record_id", "researchId", "profileId"],
      ] as const;
      const nullable = new Set(["previous_run_id", "resumed_resolution_run_id", "enriched_profile_record_id"]);
      for (const [table, column, childKey, parentKey] of edges) {
        for (const direction of ["target_to_other", "other_to_target"] as const) {
          const child = direction === "target_to_other" ? graphA : graphB;
          const parent = direction === "target_to_other" ? graphB : graphA;
          const childId = child[childKey];
          const parentId = parent[parentKey];
          await db.unsafe(`UPDATE ${table} SET ${column}=$1 WHERE id=$2`, [parentId, childId]);
          const { store, deleted } = storage();
          assert.equal(
            await deleteUserAccount(a, { storage: store }),
            "ownership_violation",
            `${table}.${column} ${direction}`,
          );
          assert.deepEqual(deleted, [], `${table}.${column} ${direction} called R2`);
          assert.equal((await db`SELECT 1 FROM users WHERE id=${a}`).length, 1);
          assert.equal((await db`SELECT 1 FROM users WHERE id=${b}`).length, 1);
          assert.equal((await db.unsafe(`SELECT 1 FROM ${table} WHERE id=$1`, [childId])).length, 1);
          await db.unsafe(`UPDATE ${table} SET ${column}=$1 WHERE id=$2`, [
            nullable.has(column) ? null : child[parentKey], childId,
          ]);
        }
      }
    });

    await t.test("writer-first holds KEY SHARE through PUT and completion; deletion waits and collects key", async () => {
      const id = await user();
      const asset = await audio(id);
      const entered = gate();
      const release = gate();
      const writer = languageAudioStore.completeUnderUserBarrier({
        userId: id, assetId: asset.id, generationStartedAt: asset.startedAt,
        put: async () => { entered.release(); await release.promise; },
      });
      await until(entered.promise, "audio PUT entered");
      const { store, deleted } = storage();
      let finished = false;
      const deletion = deleteUserAccount(id, { storage: store }).then((value) => { finished = true; return value; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(finished, false);
      release.release();
      assert.equal((await writer)?.status, "ready");
      assert.equal(await deletion, "deleted");
      assert.deepEqual(deleted, [[asset.key]]);
    });

    await t.test("deletion-first blocks audio writer; missing user prevents PUT", async () => {
      const id = await user();
      const asset = await audio(id);
      const entered = gate();
      const release = gate();
      const deletion = deleteUserAccount(id, { storage: {
        async deleteKeys() { entered.release(); await release.promise; },
      } });
      await until(entered.promise, "deletion R2 entered");
      let puts = 0;
      const writer = languageAudioStore.completeUnderUserBarrier({
        userId: id, assetId: asset.id, generationStartedAt: asset.startedAt,
        put: async () => { puts += 1; },
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(puts, 0);
      release.release();
      assert.equal(await deletion, "deleted");
      assert.equal(await writer, null);
      assert.equal(puts, 0);
    });

    await t.test("account deletion blocks audio but not the global document version barrier", async () => {
      const id = await user();
      const asset = await audio(id);
      const version = await document(id);
      const entered = gate(), release = gate();
      const deletion = deleteUserAccount(id, { storage: {
        async deleteKeys() { entered.release(); await release.promise; },
      } });
      await until(entered.promise, "deletion owns user lock");
      let audioPuts = 0, documentPuts = 0;
      const attempts = await Promise.allSettled([
        languageAudioStore.completeUnderUserBarrier({
          userId: id, assetId: asset.id, generationStartedAt: asset.startedAt,
          put: async () => { audioPuts += 1; },
        }),
        curriculumDocumentStore.markStorageReadyUnderVersionBarrier({
          versionId: version.id,
          put: async () => { documentPuts += 1; },
        }),
      ]);
      assert.equal(attempts[0]?.status, "rejected");
      if (attempts[0]?.status === "rejected") assert.equal(databaseErrorCode(attempts[0].reason), "55P03");
      assert.equal(attempts[1]?.status, "fulfilled");
      assert.equal(audioPuts, 0);
      assert.equal(documentPuts, 1);
      release.release();
      assert.equal(await deletion, "deleted");
    });

    await t.test("two KEY SHARE writers coexist, deletion waits for both", async () => {
      const id = await user();
      const first = await audio(id);
      const second = await audio(id);
      const enteredA = gate(), enteredB = gate(), releaseA = gate(), releaseB = gate();
      const writerA = languageAudioStore.completeUnderUserBarrier({ userId: id, assetId: first.id, generationStartedAt: first.startedAt, put: async () => { enteredA.release(); await releaseA.promise; } });
      await until(enteredA.promise, "first writer");
      const writerB = languageAudioStore.completeUnderUserBarrier({ userId: id, assetId: second.id, generationStartedAt: second.startedAt, put: async () => { enteredB.release(); await releaseB.promise; } });
      await until(enteredB.promise, "second writer");
      const { store, deleted } = storage();
      let finished = false;
      const deletion = deleteUserAccount(id, { storage: store }).then((value) => { finished = true; return value; });
      releaseA.release();
      await writerA;
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(finished, false);
      releaseB.release();
      await writerB;
      assert.equal(await deletion, "deleted");
      assert.deepEqual(new Set(deleted[0]), new Set([first.key, second.key]));
    });

    await t.test("writer PUT failure releases barrier; deletion finds reserved key", async () => {
      const id = await user();
      const asset = await audio(id);
      const entered = gate(), release = gate();
      const writer = languageAudioStore.completeUnderUserBarrier({
        userId: id, assetId: asset.id, generationStartedAt: asset.startedAt,
        put: async () => { entered.release(); await release.promise; throw new Error("writer PUT failed"); },
      });
      await until(entered.promise, "failed writer PUT");
      const { store, deleted } = storage();
      let finished = false;
      const deletion = deleteUserAccount(id, { storage: store }).then((value) => { finished = true; return value; });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(finished, false);
      release.release();
      await assert.rejects(writer, /writer PUT failed/);
      assert.equal(await deletion, "deleted");
      assert.deepEqual(deleted, [[asset.key]]);
    });

    await t.test("global document writer does not block unrelated account deletion", async () => {
      const a = await user(), b = await user();
      const doc = await document(b);
      const entered = gate(), release = gate();
      const writer = curriculumDocumentStore.markStorageReadyUnderVersionBarrier({
        versionId: doc.id,
        put: async () => { entered.release(); await release.promise; },
      });
      await until(entered.promise, "document PUT entered");
      const { store } = storage();
      assert.equal(await deleteUserAccount(a, { storage: store }), "deleted");
      release.release();
      assert.equal((await writer)?.storageStatus, "ready");
      assert.equal((await db`SELECT 1 FROM users WHERE id=${b}`).length, 1);
    });

    await t.test("global document ingestion survives deletion of the uploader", async () => {
      const id = await user();
      const reserved = gate(), resume = gate();
      let puts = 0;
      const service = new CurriculumDocumentService(
        {
          ...curriculumDocumentStore,
          async reserveVersion(input) {
            const result = await curriculumDocumentStore.reserveVersion(input);
            reserved.release();
            await resume.promise;
            return result;
          },
        },
        { async put() { puts += 1; }, async get() { return new Uint8Array(); } },
        { async extract() { throw new Error("unused extractor"); } },
      );
      const ingest = service.ingest(id, {
        documentId: `DOC-${randomUUID()}`,
        documentVersion: "1.0.0",
        curriculumId: "memoos-core-language",
        levelId: "C1",
        unitId: "C1-U01",
        unitOrder: 1,
        sourceTitle: "Source",
        sourceFormat: "plain_text",
        originalFilename: "source.txt",
        mediaType: "text/plain",
        fileBase64: Buffer.from("hello").toString("base64"),
      });
      await until(reserved.promise, "document reservation");
      assert.equal(await deleteUserAccount(id, { storage: storage().store }), "deleted");
      resume.release();
      assert.equal((await ingest).version.storageStatus, "ready");
      assert.equal(puts, 1);
    });

    await t.test("slow audio generation after deletion cannot PUT", async () => {
      const id = await user();
      const generating = gate(), resume = gate();
      let puts = 0;
      const operation = getOrCreateLanguageAudio({ userId: id, language: "en", originalText: randomUUID() }, {
        store: languageAudioStore,
        provider: { async generate() { generating.release(); await resume.promise; return new Uint8Array([1]); } },
        storage: { async put() { puts += 1; }, async get() { return new Uint8Array([1]); } },
      });
      await until(generating.promise, "audio generation");
      assert.equal(await deleteUserAccount(id, { storage: storage().store }), "deleted");
      resume.release();
      await assert.rejects(operation, /claim changed/);
      assert.equal(puts, 0);
    });

    await t.test("storage failure rolls back SQL, retains keys and revokes sessions", async () => {
      const id = await user();
      const asset = await audio(id);
      assert.equal(await deleteUserAccount(id, { storage: { async deleteKeys() { throw new Error("R2 unavailable"); } } }), "storage_failed");
      const [row] = await db<{ session_version: number }[]>`SELECT session_version FROM users WHERE id=${id}`;
      assert.equal(row!.session_version, 2);
      assert.equal((await db`SELECT 1 FROM language_audio_assets WHERE id=${asset.id}`).length, 1);
      assert.equal(await deleteUserAccount(id, { storage: storage().store }), "deleted");
    });

    await t.test("partial audio R2 deletion is retryable and leaves global curriculum untouched", async () => {
      const id = await user();
      const first = await audio(id);
      const second = await document(id);
      let attempts = 0;
      const store: AccountObjectStorage = { async deleteKeys(keys) {
        assert.deepEqual(new Set(keys), new Set([first.key]));
        attempts += 1;
        if (attempts === 1) throw new Error("partial R2 failure");
      } };
      assert.equal(await deleteUserAccount(id, { storage: store }), "storage_failed");
      assert.equal((await db`SELECT 1 FROM users WHERE id=${id}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_audio_assets WHERE id=${first.id}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_curriculum_document_versions WHERE id=${second.id}`).length, 1);
      assert.equal(await deleteUserAccount(id, { storage: store }), "deleted");
      assert.equal((await db`SELECT 1 FROM language_curriculum_document_versions WHERE id=${second.id}`).length, 1);
      assert.equal(attempts, 2);
    });

    await t.test("PUT followed by metadata failure leaves discoverable key", async () => {
      await db.unsafe(`CREATE TABLE gui17_fail_audio_ready (asset_id uuid PRIMARY KEY)`);
      await db.unsafe(`CREATE FUNCTION gui17_fail_audio_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='ready' AND EXISTS (SELECT 1 FROM gui17_fail_audio_ready WHERE asset_id=NEW.id) THEN RAISE EXCEPTION 'injected audio completion failure'; END IF; RETURN NEW; END $$`);
      await db.unsafe(`CREATE TRIGGER gui17_audio_completion_probe BEFORE UPDATE ON language_audio_assets FOR EACH ROW EXECUTE FUNCTION gui17_fail_audio_completion()`);
      const id = await user();
      const asset = await audio(id);
      await db`INSERT INTO gui17_fail_audio_ready (asset_id) VALUES (${asset.id})`;
      let puts = 0;
      await assert.rejects(languageAudioStore.completeUnderUserBarrier({
        userId: id, assetId: asset.id, generationStartedAt: asset.startedAt,
        put: async () => { puts += 1; },
      }), (error: unknown) =>
        (error as { cause?: { message?: string } }).cause?.message === "injected audio completion failure");
      assert.equal(puts, 1);
      assert.equal((await db`SELECT 1 FROM language_audio_assets WHERE id=${asset.id} AND status='generating'`).length, 1);
      const { store, deleted } = storage();
      assert.equal(await deleteUserAccount(id, { storage: store }), "deleted");
      assert.deepEqual(deleted, [[asset.key]]);
    });

    await t.test("NO ACTION internal FK prevents a cross-user direct DELETE and rolls back SQL", async () => {
      const a = await user(), b = await user();
      const [profile] = await db<{ id: string }[]>`
        INSERT INTO language_knowledge_profiles
          (user_id, profile_id, language_id, variety_id, version, status, profile, content_sha256)
        VALUES (${a}, ${randomUUID()}, 'en', 'general', 'v1', 'draft', ${{}}, ${"c".repeat(64)}) RETURNING id`;
      await db`INSERT INTO language_decision_registry_versions
        (user_id, profile_record_id, registry_id, language_id, variety_id, curriculum_id,
         version, status, registry, content_sha256)
        VALUES (${b}, ${profile!.id}, ${randomUUID()}, 'en', 'general', 'curriculum',
                'v1', 'draft', ${{}}, ${"c".repeat(64)})`;
      const { store, deleted } = storage();
      assert.equal(await deleteUserAccount(a, { storage: store }), "ownership_violation");
      assert.deepEqual(deleted, []);
      await assert.rejects(db`DELETE FROM users WHERE id=${a}`, (error: unknown) =>
        (error as { code?: string }).code === "23503");
      assert.equal((await db`SELECT 1 FROM users WHERE id=${a}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_knowledge_profiles WHERE id=${profile!.id}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_decision_registry_versions WHERE user_id=${b}`).length > 0, true);
    });

    await t.test("lock timeout is retryable and does not delete user or metadata", async () => {
      const id = await user();
      const asset = await audio(id);
      const held = gate(), release = gate();
      const lock = db.begin(async (tx) => {
        await tx`SELECT 1 FROM users WHERE id=${id} FOR KEY SHARE`;
        held.release();
        await release.promise;
      });
      await until(held.promise, "held user lock");
      const { store, deleted } = storage();
      assert.equal(await deleteUserAccount(id, { storage: store }), "retryable_database_failure");
      release.release();
      await lock;
      assert.deepEqual(deleted, []);
      assert.equal((await db`SELECT 1 FROM users WHERE id=${id}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_audio_assets WHERE id=${asset.id}`).length, 1);
    });

    await t.test("real PostgreSQL deadlock returns retryable failure and rolls back", async () => {
      await db.unsafe(`CREATE TABLE gui17_deadlock_probe (target_id uuid PRIMARY KEY, other_id uuid NOT NULL)`);
      await db.unsafe(`CREATE FUNCTION gui17_lock_other_user() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE other uuid; BEGIN SELECT other_id INTO other FROM gui17_deadlock_probe WHERE target_id=OLD.id; IF other IS NOT NULL THEN PERFORM 1 FROM users WHERE id=other FOR UPDATE; END IF; RETURN OLD; END $$`);
      await db.unsafe(`CREATE TRIGGER gui17_deadlock_trigger BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION gui17_lock_other_user()`);
      const a = await user(), b = await user();
      const asset = await audio(a);
      await db`INSERT INTO gui17_deadlock_probe (target_id, other_id) VALUES (${a}, ${b})`;
      const heldB = gate(), attemptA = gate(), enterStorage = gate(), resumeStorage = gate();
      const external = db.begin(async (tx) => {
        await tx`SELECT 1 FROM users WHERE id=${b} FOR UPDATE`;
        heldB.release();
        await attemptA.promise;
        await tx`SELECT 1 FROM users WHERE id=${a} FOR UPDATE`;
      });
      await until(heldB.promise, "external lock B");
      const deletion = deleteUserAccount(a, { storage: {
        async deleteKeys() {
          enterStorage.release();
          await resumeStorage.promise;
        },
      } });
      await until(enterStorage.promise, "deletion lock A");
      resumeStorage.release();
      await new Promise((resolve) => setTimeout(resolve, 100));
      attemptA.release();
      assert.equal(await deletion, "database_failed_after_storage_delete");
      await external;
      assert.equal((await db`SELECT 1 FROM users WHERE id=${a}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_audio_assets WHERE id=${asset.id}`).length, 1);
    });

    await t.test("R2 success plus SQL rollback remains retryable with persisted keys", async () => {
      await db.unsafe(`CREATE TABLE gui17_fail_delete (user_id uuid PRIMARY KEY, active boolean NOT NULL)`);
      await db.unsafe(`CREATE FUNCTION gui17_fail_delete_once() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM gui17_fail_delete WHERE user_id=OLD.id AND active) THEN RAISE EXCEPTION 'injected SQL failure'; END IF; RETURN OLD; END $$`);
      await db.unsafe(`CREATE TRIGGER gui17_delete_probe BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION gui17_fail_delete_once()`);
      const id = await user();
      const asset = await audio(id);
      await db`INSERT INTO gui17_fail_delete (user_id, active) VALUES (${id}, true)`;
      const deleted = new Set<string>();
      const seen: string[][] = [];
      const store: AccountObjectStorage = { async deleteKeys(keys) { seen.push([...keys]); for (const key of keys) deleted.add(key); } };
      assert.equal(await deleteUserAccount(id, { storage: store }), "database_failed_after_storage_delete");
      assert.equal(deleted.has(asset.key), true);
      assert.equal((await db`SELECT 1 FROM users WHERE id=${id}`).length, 1);
      assert.equal((await db`SELECT 1 FROM language_audio_assets WHERE id=${asset.id}`).length, 1);
      await db`UPDATE gui17_fail_delete SET active=false WHERE user_id=${id}`;
      assert.equal(await deleteUserAccount(id, { storage: store }), "deleted");
      assert.deepEqual(seen, [[asset.key], [asset.key]]);
    });
  } finally {
    await closeDbConnection();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await db.end({ timeout: 5 });
    await migrationDb.close();
    await admin.end({ timeout: 5 });
  }
});
