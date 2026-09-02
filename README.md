# MemoOS

MemoOS es el hub personal que reúne módulos independientes bajo un Dashboard
protegido. El workspace conserva el módulo Proyectos sobre la arquitectura de
Project Architect e incorpora Journey como módulo dedicado al recorrido de ideas para
videos de YouTube.

## Aplicaciones

- `apps/web`: login, Dashboard de MemoOS y páginas de los módulos en Next.js.
- `apps/api`: API Fastify con autenticación, health checks y rutas de módulos.

El navegador consume la API mediante rutas relativas `/api/*`. Next.js utiliza
`API_INTERNAL_URL` para reenviar esas solicitudes al backend. El frontend nunca
se conecta directamente a PostgreSQL.

## Módulos

### Proyectos

Proyectos reutiliza Project Architect como módulo independiente bajo las rutas
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

### Idiomas

Idiomas organiza proyectos por idioma y nivel. Cada lección recibe material
fuente y lo transforma desde el backend en ocho secciones estructuradas:
vocabulario, frases, patrones, mini historia, pensamientos automáticos, diálogo,
puente al siguiente nivel y repaso.

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
APP_URL=http://localhost:3000
RESEND_API_KEY=re_replace-with-a-resend-api-key
PASSWORD_RESET_FROM_EMAIL=MemoOS <no-reply@example.com>
OPENAI_API_KEY=replace-with-a-server-side-api-key
OPENAI_LANGUAGE_MODEL=gpt-5.4-mini
OPENAI_PROJECT_TEXT_MODEL=gpt-5.4-mini
```

En Railway, la API también acepta la variable `PORT` proporcionada por la
plataforma. `OPENAI_API_KEY`, `OPENAI_LANGUAGE_MODEL` y
`OPENAI_PROJECT_TEXT_MODEL` pertenecen únicamente al entorno del backend; nunca
deben exponerse mediante variables `NEXT_PUBLIC_*`. Los modelos son
configurables y usan `gpt-5.4-mini` por defecto.

La recuperación de contraseña usa Resend desde la API. `APP_URL` es el origen
público del frontend incluido en el enlace, `PASSWORD_RESET_FROM_EMAIL` debe ser
un remitente autorizado por Resend y `RESEND_API_KEY` es un secreto exclusivo
del backend. Ninguna de estas variables debe usar el prefijo `NEXT_PUBLIC_*`.

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
- Cuenta: `GET http://localhost:4000/account`
- Perfil: `PATCH http://localhost:4000/account/profile`
- Contraseña autenticada: `PATCH http://localhost:4000/account/password`
- Solicitar recuperación: `POST http://localhost:4000/auth/forgot-password`
- Restablecer contraseña: `POST http://localhost:4000/auth/reset-password`

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
- `0003_create_architect_projects.sql`: persistencia histórica de Project Architect.
- `0018_transform_architect_projects_to_projects.sql`: campos de Proyectos y herramientas.
- `0004_create_journey.sql`: ideas y entradas del diario de Journey.
- `0005_create_languages.sql`: proyectos y lecciones del módulo Idiomas.
- `0006_structure_language_lessons.sql`: estado y contenido JSON estructurado de
  las lecciones de Idiomas.
- `0014_add_account_recovery.sql`: correo único opcional y tokens de
  recuperación de contraseña de un solo uso.

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

La configuración y el flujo operativo de las lecciones estructuradas se
documentan en `docs/operations/language-lessons-openai.md`.

El primer usuario se provisiona sin registro público mediante
`auth:create-user`, usando temporalmente `ARCHITECT_USERNAME` y
`ARCHITECT_PASSWORD`. Estos nombres se conservan para no romper el mecanismo de
autenticación existente.
