# Agent Instructions

Project Architect is a standalone product. Do not import or depend on MemoOS code, database tables, authentication, environment variables, routes, UI internals, deployment configuration, or runtime assumptions.

## Definitive Architecture

- Monorepo: pnpm workspaces
- Orchestration: Turborepo
- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS, shadcn/ui
- Backend: Fastify with TypeScript
- Database: PostgreSQL as the single source of truth, intended for Railway
- ORM: Drizzle ORM
- Migrations: SQL migrations managed with the repository's Drizzle workflow
- Validation: Zod
- Future authentication: Better Auth hosted by the backend
- Frontend deployment: Vercel
- API deployment: Railway

## Package Boundaries

`packages/contracts` may contain only:

- Zod schemas
- Input and output DTOs
- Enumerations
- Types derived from Zod
- Error contracts

`packages/contracts` must not contain:

- React code
- PostgreSQL access
- Authentication
- Environment variables
- Business logic
- OpenAI code

## API Access Rule

The browser must not call the Railway API domain directly. The frontend calls relative `/api/*` paths. Next.js or Vercel rewrites those requests to the backend target configured by environment variables.

The frontend must not connect directly to PostgreSQL. All application data access goes through the Fastify API.

## Existing Functionality

The current repository includes:

- PostgreSQL as the canonical source of application data
- Drizzle ORM and SQL migrations
- Basic project creation and listing through the Fastify API
- A dashboard that lists saved projects
- A Next.js project-creation flow
- Shared Zod contracts
- A relative `/api/*` proxy between the Next.js frontend and Fastify
- `GET /health`

## Authorized Increment: Deterministic Project Discovery

The current increment may implement:

- Project detail pages
- Discovery sessions associated with projects
- Deterministic questions selected by project type
- Questions organized into sections
- PostgreSQL persistence for questions and answers
- Progressive answer saving and discovery resumption
- Backend-calculated progress
- Answer review
- Required-question validation
- Discovery completion
- Shared Zod contracts
- Fastify endpoints
- Drizzle schema changes and SQL migrations
- Next.js pages and components
- Real tests for this functionality
- Updates to outdated documentation

## Discovery Rules

1. PostgreSQL remains the only source of truth.
2. The frontend must not connect directly to PostgreSQL.
3. The frontend consumes Fastify only through relative `/api/*` paths.
4. Internal types may use English, but all visible interface text must be in Spanish.
5. Deterministic question templates must remain outside visual components.
6. Starting a discovery session must be idempotent.
7. Answers must be updatable without creating duplicates.
8. A discovery session must not be completed while required answers are missing.
9. Do not report tests or migrations as executed when they could not be verified.
10. Do not create commits or push changes.

## Out Of Scope

Do not implement yet:

- OpenAI or other AI model integrations
- Dynamically generated questions from AI
- Better Auth or any other authentication and authorization
- Registration or login
- Final proposal generation
- Sprints
- Kanban
- Cards or task management
- Direct editing of a master JSON document as a source of truth
- General architecture changes
- Unrelated refactors
- Supabase
- MemoOS integration
