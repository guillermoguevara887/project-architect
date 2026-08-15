CREATE TABLE "journey_ideas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id"),
  "title" text NOT NULL,
  "source_type" text NOT NULL,
  "source_reference" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "journey_ideas_source_type_check"
    CHECK (
      "source_type" IN (
        'url',
        'article',
        'paper',
        'pdf',
        'book',
        'video',
        'personal_note',
        'other'
      )
    )
);

CREATE INDEX "journey_ideas_user_created_at_idx"
  ON "journey_ideas" ("user_id", "created_at" DESC);

CREATE TABLE "journey_feed_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idea_id" uuid NOT NULL
    REFERENCES "journey_ideas" ("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX "journey_feed_entries_idea_created_at_idx"
  ON "journey_feed_entries" ("idea_id", "created_at" DESC);
