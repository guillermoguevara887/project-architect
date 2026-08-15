# Agent Instructions

MemoOS is the standalone personal hub in this repository. Project Architect
and Journey are independent modules inside MemoOS. Preserve clear module
boundaries and do not couple one module's product contracts, routes, UI, or
storage to another module.

## Current Baseline

- Monorepo: pnpm workspaces with Turborepo
- Frontend: Next.js App Router application
- Backend: Fastify application with TypeScript
- Database: PostgreSQL as the single source of truth, hosted on Railway
- Database access: Drizzle ORM with the `postgres` client
- Existing SQL migrations and the complete historical Drizzle schema are kept
- Available health routes: `GET /health` and `GET /health/db`
- `GET /health/db` must remain non-destructive and use only a query equivalent
  to `SELECT 1`
- Authentication: username and scrypt password hashes in PostgreSQL
- Session: signed, expiring, HTTP-only cookie
- Authentication routes: `POST /auth/login`, `GET /auth/session`, and
  `POST /auth/logout`

## Module Boundaries

- MemoOS owns login, session handling, the Dashboard, shared infrastructure,
  and module navigation.
- Project Architect owns routes under `/projects/*`, API routes under
  `/architect/*`, and its `architect_projects` data.
- Journey owns routes under `/journey/*` and the `journey_ideas` and
  `journey_feed_entries` data.
- Do not move Journey workflows into Project Architect or use Project
  Architect records as Journey ideas.

## Database Safety

- The frontend must never connect directly to PostgreSQL.
- The frontend consumes Fastify through relative `/api/*` paths.
- Preserve `DATABASE_URL`, the PostgreSQL client, `schema.ts`, Drizzle
  configuration, and all existing migrations.
- Do not remove historical table declarations from `schema.ts` merely because
  their product functionality is no longer exposed.
- Do not generate or execute migrations, run `drizzle-kit push`, or issue
  `DROP`, `DELETE`, `TRUNCATE`, or `ALTER` statements unless the user gives
  explicit authorization for that exact operation.
- Do not modify existing PostgreSQL data as part of repository cleanup.
- Never expose `DATABASE_URL` through a `NEXT_PUBLIC_*` variable.

## Current Journey Scope

Journey currently covers only idea creation, source traceability, idea listing
and detail, and CRUD feed entries ordered newest first.

Do not implement NotebookLM, understanding checklists, video planning, scripts,
ElevenLabs, study audio, uploads, AI, publishing, analytics, thumbnails,
automations, folders, tasks, or kanban unless explicitly requested.

## Authentication Scope

Do not add email, names, avatars, roles, permissions, organizations, profiles,
public registration, password recovery, OAuth, MFA, or email verification.

Do not execute `0002_create_users.sql`, `0003_create_architect_projects.sql`,
or `0004_create_journey.sql` until the user explicitly authorizes the exact
migration operation. Do not report live credential authentication or live
Journey persistence as verified until the required migrations have been
applied and a user has been provisioned.

Do not create commits, push changes, or deploy.
