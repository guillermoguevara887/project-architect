-- Preserve legacy v1 rows; new v2 artifacts use an explicit S3B canonical.
-- Artifact and binding live in the same row. There is no backfill or rebind.
ALTER TABLE language_decision_registry_versions
  ALTER COLUMN profile_record_id DROP NOT NULL,
  ADD COLUMN canonical_record_id uuid,
  ADD COLUMN profile_binding_v2 jsonb,
  ADD CONSTRAINT ld_registry_canonical_fk FOREIGN KEY (canonical_record_id) REFERENCES language_profile_v2_canonicals(id),
  ADD CONSTRAINT ld_registry_profile_binding_choice CHECK (
    (profile_record_id IS NOT NULL AND canonical_record_id IS NULL AND profile_binding_v2 IS NULL)
    OR
    (profile_record_id IS NULL AND canonical_record_id IS NOT NULL AND profile_binding_v2 IS NOT NULL)
  ),
  ADD CONSTRAINT ld_registry_profile_binding_shape CHECK (
    profile_binding_v2 IS NULL OR (
      jsonb_typeof(profile_binding_v2) = 'object'
      AND profile_binding_v2 ?& ARRAY['bindingVersion','profileId','profileVersion','schemaVersion','contractVersion','canonicalRecordId','canonicalSha256']
      AND profile_binding_v2 - ARRAY['bindingVersion','profileId','profileVersion','schemaVersion','contractVersion','canonicalRecordId','canonicalSha256'] = '{}'::jsonb
      AND jsonb_typeof(profile_binding_v2->'profileId') = 'string'
      AND length(btrim(profile_binding_v2->>'profileId')) > 0
      AND jsonb_typeof(profile_binding_v2->'profileVersion') = 'string'
      AND length(btrim(profile_binding_v2->>'profileVersion')) > 0
      AND profile_binding_v2->'bindingVersion' = '"1.0.0"'::jsonb
      AND profile_binding_v2->'schemaVersion' = '"2.0.0"'::jsonb
      AND profile_binding_v2->'contractVersion' = '"1.0.0"'::jsonb
      AND profile_binding_v2->'canonicalRecordId' = to_jsonb(canonical_record_id::text)
      AND jsonb_typeof(profile_binding_v2->'canonicalSha256') = 'string'
      AND profile_binding_v2->>'canonicalSha256' ~ '^[0-9a-f]{64}$'
    )
  );

-- Existing UNIQUE(user_id, registry_id, version) remains stronger than uniqueness
-- per canonical: changing grounding requires a new artifact identity/version.
CREATE INDEX ld_registry_canonical_lookup_idx
  ON language_decision_registry_versions(user_id, canonical_record_id, registry_id, version)
  WHERE canonical_record_id IS NOT NULL;
