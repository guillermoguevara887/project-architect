# MemoOS

MemoOS es el hub personal que reúne módulos independientes bajo un Dashboard
protegido. El workspace conserva Project Architect como módulo para proyectos
generales e incorpora Journey como módulo dedicado al recorrido de ideas para
videos de YouTube.

## Aplicaciones

- `apps/web`: login, Dashboard de MemoOS y páginas de los módulos en Next.js.
- `apps/api`: API Fastify con autenticación, health checks y rutas de módulos.

El navegador consume la API mediante rutas relativas `/api/*`. Next.js utiliza
`API_INTERNAL_URL` para reenviar esas solicitudes al backend. El frontend nunca
se conecta directamente a PostgreSQL.

## Módulos

### Project Architect

Project Architect se conserva como módulo independiente bajo las rutas
`/projects/*` y los endpoints `/architect/*`.

### Journey

El primer incremento de Journey permite:

- listar y crear ideas de videos de YouTube;
- registrar el tipo y la referencia de la fuente original;
- abrir el detalle de una idea;
- crear, listar, editar y borrar entradas de su diario;
- mantener el feed ordenado desde la entrada más reciente.

Páginas principales:

- `/journey`
- `/journey/new`
- `/journey/:ideaId`

## Variables de entorno

El backend carga sus variables desde `apps/api/.env` durante el desarrollo
local. Usa `.env.example` como referencia y no publiques `DATABASE_URL` en el
frontend.

Variables principales del backend:

```dotenv
API_PORT=4000
API_HOST=0.0.0.0
DATABASE_URL=postgresql://usuario:contraseña@host:5432/base
APP_ENV=local
NODE_ENV=development
AUTH_COOKIE_SECRET=replace-with-a-long-random-secret
```

En Railway, la API también acepta la variable `PORT` proporcionada por la
plataforma.

## Ejecución

Desde la raíz:

```powershell
corepack pnpm install
corepack pnpm dev
```

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:4000`
- Estado de la API: `GET http://localhost:4000/health`
- Estado de PostgreSQL: `GET http://localhost:4000/health/db`
- Login: `POST http://localhost:4000/auth/login`
- Sesión: `GET http://localhost:4000/auth/session`
- Logout: `POST http://localhost:4000/auth/logout`

`GET /health/db` ejecuta únicamente `SELECT 1`.

## Verificación

```powershell
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
```

## Base de datos

PostgreSQL continúa siendo la única fuente de verdad. Se conservan el esquema
histórico y todas las migraciones existentes.

Migraciones de los incrementos actuales:

- `0002_create_users.sql`: autenticación por username y password.
- `0003_create_architect_projects.sql`: persistencia de Project Architect.
- `0004_create_journey.sql`: ideas y entradas del diario de Journey.
- `0005_create_languages.sql`: proyectos y lecciones del módulo Idiomas.

Las migraciones no se ejecutan automáticamente. Antes de aplicarlas contra
Railway hay que revisar el SQL y autorizar explícitamente la operación. Journey
depende de que la tabla `users` exista.

Comandos de operación:

```powershell
pnpm db:migrate:status
pnpm db:migrate
```

Las bases creadas con el migrador anterior requieren una adopción explícita del
historial con checksums antes de ejecutar nuevas migraciones. El procedimiento
completo está en `docs/operations/database-migrations.md`. La auditoría manual
de backups y restauración de Railway está en
`docs/operations/railway-backups.md`.

El primer usuario se provisiona sin registro público mediante
`auth:create-user`, usando temporalmente `ARCHITECT_USERNAME` y
`ARCHITECT_PASSWORD`. Estos nombres se conservan para no romper el mecanismo de
autenticación existente.
