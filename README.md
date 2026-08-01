# Project Architect

Project Architect recopila y estructura el contexto de proyectos complejos antes de planificarlos. La aplicación admite inicialmente proyectos de investigación o exploración y concursos o hackathons.

El producto es independiente de MemoOS. PostgreSQL es la única fuente de verdad y el navegador nunca accede directamente a la base de datos ni al dominio externo de la API.

## Stack

- Monorepo con pnpm workspaces y Turborepo
- Next.js App Router, React, TypeScript y Tailwind CSS
- Fastify con TypeScript
- PostgreSQL y Drizzle ORM
- Contratos compartidos con Zod
- Rewrites relativos `/api/*` desde Next.js hacia Fastify

## Funcionalidad implementada

- `GET /health`
- Dashboard con listado de proyectos
- Creación de proyectos de investigación o concurso
- Detalle de proyecto
- Sesión única e idempotente de descubrimiento por proyecto
- Plantillas deterministas de preguntas según el tipo de proyecto
- Cinco secciones de preguntas por plantilla
- Guardado y actualización de respuestas en PostgreSQL
- Reanudación desde la sección guardada
- Progreso calculado por el backend
- Revisión agrupada y detección de respuestas obligatorias faltantes
- Confirmación del contexto
- Pruebas reales con el ejecutor nativo de Node y `tsx`

No se han implementado autenticación, OpenAI, preguntas dinámicas, propuestas, sprints, Kanban ni tarjetas.

## Variables de entorno

Copia `.env.example` a `.env` en la raíz o configura las variables equivalentes en cada aplicación.

```dotenv
API_PORT=4000
DATABASE_URL=postgresql://project_architect:project_architect@localhost:5432/project_architect
API_INTERNAL_URL=http://localhost:4000
APP_ENV=local
NODE_ENV=development
```

`DATABASE_URL` solo debe estar disponible para `apps/api`. No uses un prefijo `NEXT_PUBLIC_` para esta variable.

## Instalación y ejecución local

Desde la raíz:

```powershell
corepack pnpm install
corepack pnpm db:migrate
corepack pnpm dev
```

Puertos locales:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`

El navegador consume rutas relativas como `/api/projects`. Next.js las reescribe hacia `API_INTERNAL_URL`.

## Validación

```powershell
corepack pnpm build
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
```

La migración requiere una instancia PostgreSQL accesible:

```powershell
corepack pnpm db:migrate
```

No se debe considerar verificada la persistencia real hasta ejecutar la migración y un recorrido de integración contra una `DATABASE_URL` utilizable.

## Estructura

```text
apps/
  api/       Fastify, Drizzle, migraciones y dominio
  web/       Next.js y experiencia de usuario
packages/
  contracts/ Esquemas Zod y tipos derivados
docs/        Visión, alcance, flujo y modelo de datos
```
