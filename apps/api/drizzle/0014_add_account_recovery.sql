ALTER TABLE "users" ADD COLUMN "email" text;

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized_check"
  CHECK ("email" IS NULL OR "email" = lower(btrim("email")));

CREATE UNIQUE INDEX "users_email_unique"
  ON "users" ("email")
  WHERE "email" IS NOT NULL;

CREATE TABLE "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "password_reset_tokens_expiry_check"
    CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "password_reset_tokens_token_hash_unique"
  ON "password_reset_tokens" ("token_hash");

CREATE INDEX "password_reset_tokens_user_created_at_idx"
  ON "password_reset_tokens" ("user_id", "created_at" DESC);
