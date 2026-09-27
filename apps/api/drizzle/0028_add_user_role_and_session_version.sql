ALTER TABLE "users"
  ADD COLUMN "role" text DEFAULT 'user' NOT NULL,
  ADD COLUMN "session_version" integer DEFAULT 1 NOT NULL,
  ADD CONSTRAINT "users_role_check"
    CHECK ("role" IN ('user', 'superadmin')),
  ADD CONSTRAINT "users_session_version_check"
    CHECK ("session_version" >= 1);
