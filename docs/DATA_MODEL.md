# Data Model

PostgreSQL es la única fuente de verdad. Drizzle define el esquema de aplicación y las migraciones SQL viven en `apps/api/drizzle`.

## `projects`

Registro principal del proyecto.

- `id`: UUID, clave primaria
- `name`: texto obligatorio
- `project_type`: enum `research | competition`
- `global_objective`: texto obligatorio
- `created_at`
- `updated_at`

Índice:

- `projects_created_at_idx` para el orden del dashboard

## `discovery_sessions`

Una sesión de descubrimiento por proyecto.

- `id`: UUID, clave primaria
- `project_id`: FK a `projects.id`, `ON DELETE CASCADE`
- `status`: enum `not_started | in_progress | ready_for_review | completed`
- `current_step`: entero no negativo
- `completed_at`: nullable
- `created_at`
- `updated_at`

Restricciones e índices:

- Unicidad de `project_id`
- Check `current_step >= 0`
- Índice por `status`

En la práctica `not_started` se representa en la API cuando todavía no hay fila. Una sesión recién creada comienza como `in_progress`.

## `discovery_questions`

Materializa las preguntas de la plantilla utilizada por una sesión.

- `id`: UUID, clave primaria
- `discovery_session_id`: FK, `ON DELETE CASCADE`
- `question_key`: clave estable dentro de la plantilla
- `question_text`
- `category`
- `section_key`
- `section_title`
- `question_type`
- `options`: JSONB nullable
- `position`: entero no negativo
- `section_position`: entero no negativo
- `is_required`
- `created_at`

Tipos:

- `short_text`
- `long_text`
- `number`
- `date`
- `single_select`
- `multi_select`
- `yes_no`

Restricciones e índices:

- Unicidad de `(discovery_session_id, question_key)`
- Índice por sesión, sección y posición
- Checks para posiciones no negativas

Las preguntas se materializan para que un cambio futuro en las plantillas no altere silenciosamente sesiones ya iniciadas.

## `discovery_answers`

Una respuesta por pregunta.

- `id`: UUID, clave primaria
- `question_id`: FK, `ON DELETE CASCADE`
- `answer`: JSONB obligatorio
- `created_at`
- `updated_at`

Restricción:

- Unicidad de `question_id`

JSONB permite representar de forma consistente `string`, `number`, `boolean` y `string[]`. El backend valida cada valor con Zod y también contra el tipo y las opciones de la pregunta. El upsert por `question_id` permite actualizar sin duplicar.

## Integridad

- Eliminar un proyecto elimina su sesión, preguntas y respuestas.
- El inicio usa la unicidad por proyecto y `ON CONFLICT DO NOTHING`.
- El guardado comprueba que la pregunta pertenezca a la sesión del proyecto indicado.
- La finalización calcula respuestas obligatorias faltantes en el backend.
- El frontend no conoce `DATABASE_URL` ni ejecuta consultas.

## Migraciones

- `0000_create_projects.sql`
- `0001_project_discovery.sql`

Aplicación:

```powershell
corepack pnpm db:migrate
```

El comando requiere `DATABASE_URL`. La migración `0001` no se considera verificada contra PostgreSQL hasta ejecutarla en una instancia disponible.

## Entidades futuras

Fuera del incremento actual:

- Versiones o reaperturas de contexto confirmado
- Ejecuciones de IA trazables
- Rutas o direcciones propuestas
- Sprints, cierres y resultados

Ningún JSON maestro debe convertirse en fuente de verdad. Si se añade, será una vista o snapshot derivado de estas entidades canónicas.
