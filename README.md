# Arquitect

Base mínima de Arquitect con login mediante username y password, Dashboard
protegido, una API Fastify y PostgreSQL mediante Drizzle ORM.

## Aplicaciones

- `apps/web`: login y Dashboard protegido en Next.js.
- `apps/api`: API Fastify con autenticación y health checks.

El navegador consume la API mediante rutas relativas `/api/*`. Next.js utiliza
`API_INTERNAL_URL` para reenviar esas solicitudes al backend.

## Variables de entorno

El backend carga sus variables desde `apps/api/.env` durante el desarrollo
local. Usa `apps/api/.env.example` como referencia y no publiques
`DATABASE_URL` en el frontend.

El frontend puede configurar `API_INTERNAL_URL` siguiendo
`apps/web/.env.example`.

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

PostgreSQL continúa siendo la fuente de verdad. Se conservan sin cambios:

- `apps/api/src/db/schema.ts`
- `apps/api/drizzle.config.ts`
- `apps/api/drizzle/0000_create_projects.sql`
- `apps/api/drizzle/0001_project_discovery.sql`
- `apps/api/drizzle/0002_create_users.sql`
- `apps/api/src/db/migrate.ts`

Las tablas y migraciones históricas se mantienen para representar la base de
datos existente, aunque la API ya no exponga funcionalidad de producto.

No generes ni ejecutes migraciones contra la base existente sin una
autorización específica y una revisión previa del SQL.

La migración `0002_create_users.sql` crea únicamente la tabla `users` y no se
ejecuta automáticamente. Después de que su aplicación sea autorizada, el
primer usuario se puede provisionar sin registro público mediante el script
`auth:create-user`, usando temporalmente `ARCHITECT_USERNAME` y
`ARCHITECT_PASSWORD` en el entorno del proceso.
