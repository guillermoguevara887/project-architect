# Agent Instructions

Arquitect is a standalone product. Do not import or depend on MemoOS
code, database tables, authentication, environment variables, routes, UI
internals, deployment configuration, or runtime assumptions.

## Current Baseline

- Monorepo: pnpm workspaces with Turborepo
- Frontend: minimal Next.js App Router application
- Backend: minimal Fastify application with TypeScript
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

## Current Scope

The repository may contain only the minimal frontend, minimal backend,
database connection, Drizzle configuration, preserved schema and migrations,
health endpoints, username/password authentication, login, and the protected
minimal dashboard.

Do not restore or implement Projects, Discovery, research, competition,
product dashboards, repositories, services, or their former contracts and
tests unless explicitly requested.

Do not add email, names, avatars, roles, permissions, organizations, profiles,
public registration, password recovery, OAuth, MFA, or email verification.

Do not execute `0002_create_users.sql` until the user explicitly authorizes
that migration. Do not report live credential authentication as verified until
the migration has been applied and a user has been provisioned.

Do not create commits, push changes, or deploy.
