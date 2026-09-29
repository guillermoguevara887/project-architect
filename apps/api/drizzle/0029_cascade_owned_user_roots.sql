ALTER TABLE "architect_projects"
  DROP CONSTRAINT "architect_projects_user_id_fkey",
  ADD CONSTRAINT "architect_projects_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;

ALTER TABLE "journey_ideas"
  DROP CONSTRAINT "journey_ideas_user_id_fkey",
  ADD CONSTRAINT "journey_ideas_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;

ALTER TABLE "language_projects"
  DROP CONSTRAINT "language_projects_user_id_fkey",
  ADD CONSTRAINT "language_projects_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
