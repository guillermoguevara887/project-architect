# Current State Audit

Fecha: 2026-07-27

## Resumen

Project Architect es un monorepo independiente con una primera vertical funcional para crear proyectos y recopilar contexto mediante descubrimiento determinista.

El repositorio todavía no tiene un primer commit; todos los archivos aparecen sin seguimiento en `git status`. No se realizó commit ni push.

## Arquitectura verificada

- pnpm workspaces y Turborepo
- Next.js App Router, React, TypeScript y Tailwind CSS
- Fastify con TypeScript
- PostgreSQL como fuente de verdad
- Drizzle ORM y migraciones SQL
- Zod en `packages/contracts`
- Rewrite `/api/:path*` hacia `API_INTERNAL_URL`
- Ninguna dependencia de MemoOS o Supabase

## Funcionalidad implementada

### Proyectos

- Dashboard `/`
- Formulario `/projects/new`
- Detalle `/projects/[projectId]`
- `GET /projects`
- `GET /projects/:projectId`
- `POST /projects`
- Tipos `research` y `competition`

### Descubrimiento

- Ruta `/projects/[projectId]/discovery`
- Una sesión idempotente por proyecto
- Plantillas deterministas distintas para investigación y concurso
- Cinco secciones por plantilla
- Preguntas materializadas en PostgreSQL
- Respuestas actualizables mediante upsert
- Progreso calculado en Fastify
- Persistencia de `current_step`
- Revisión agrupada
- Obligatorias faltantes visibles
- Bloqueo de finalización incompleta
- Estado final `completed`

### Endpoints

- `GET /health`
- `GET /projects`
- `POST /projects`
- `GET /projects/:projectId`
- `GET /projects/:projectId/discovery`
- `POST /projects/:projectId/discovery`
- `PATCH /projects/:projectId/discovery`
- `GET /projects/:projectId/discovery/progress`
- `PUT /projects/:projectId/discovery/answers/:questionId`
- `POST /projects/:projectId/discovery/review`
- `POST /projects/:projectId/discovery/complete`

## Seguridad e integridad

- El navegador usa rutas relativas `/api/*`.
- `DATABASE_URL` solo se consume en Fastify/Drizzle.
- Los IDs de ruta se validan como UUID.
- Una pregunta se rechaza si pertenece a otro proyecto.
- Las claves foráneas usan cascada.
- Las sesiones y respuestas tienen restricciones de unicidad.
- No existe autenticación; el producto continúa pensado para uso local o entorno controlado hasta implementar autorización.

## Pruebas

Los scripts placeholder fueron reemplazados por el ejecutor nativo de Node con `tsx`.

Cobertura actual:

- Contratos de respuestas, estados, UUID y listado
- Selección de plantilla por tipo
- Inicio idempotente
- Creación y actualización de respuesta
- Cálculo de progreso, incluido booleano `false`
- Rechazo de pregunta de otro proyecto
- Rechazo de finalización incompleta
- Finalización exitosa
- Integración de rutas mediante `Fastify.inject`
- Etiquetas visibles en español

Las pruebas de API usan un almacén en memoria para verificar reglas de dominio y transporte HTTP. No se ejecutó una prueba de integración contra PostgreSQL porque no había `DATABASE_URL`.

## Validación de infraestructura

Comando pendiente cuando exista PostgreSQL:

```powershell
corepack pnpm db:migrate
```

Después conviene crear dos proyectos reales, iniciar ambas plantillas, guardar respuestas, recargar, revisar y completar.

## Pendiente

- Migración verificada contra PostgreSQL
- Pruebas de repositorio contra una base temporal
- Autenticación y autorización
- Versionado o reapertura del contexto confirmado
- Integración futura de IA
- Observabilidad y despliegue

## Siguiente incremento recomendado

Endurecimiento de la persistencia: pruebas de integración con PostgreSQL efímero, verificación de concurrencia del inicio idempotente y una decisión de producto sobre versionar o reabrir una sesión completada. La IA debe permanecer fuera hasta que ese contexto tenga un ciclo de vida estable.
