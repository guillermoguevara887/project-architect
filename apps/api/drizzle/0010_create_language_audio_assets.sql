CREATE TABLE "language_audio_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "language" text NOT NULL,
  "normalized_text" text NOT NULL,
  "original_text" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "voice" text NOT NULL,
  "audio_format" text NOT NULL,
  "storage_key" text NOT NULL,
  "status" text DEFAULT 'generating' NOT NULL,
  "generation_started_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "language_audio_assets_status_check"
    CHECK ("status" IN ('generating', 'ready', 'failed')),
  CONSTRAINT "language_audio_assets_generation_state_check"
    CHECK (
      ("status" = 'generating' AND "generation_started_at" IS NOT NULL)
      OR ("status" <> 'generating' AND "generation_started_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "language_audio_assets_cache_unique"
  ON "language_audio_assets" (
    "user_id",
    "language",
    "normalized_text",
    "provider",
    "model",
    "voice",
    "audio_format"
  );

CREATE UNIQUE INDEX "language_audio_assets_storage_key_unique"
  ON "language_audio_assets" ("storage_key");

CREATE INDEX "language_audio_assets_user_created_at_idx"
  ON "language_audio_assets" ("user_id", "created_at" DESC);
