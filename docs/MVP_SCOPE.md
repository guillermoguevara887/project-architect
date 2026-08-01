# MVP Scope

## Alcance funcional actual

La entrega actual incluye:

- Fundación del monorepo
- Web Next.js y API Fastify
- Contratos compartidos con Zod
- PostgreSQL y Drizzle ORM
- Migraciones SQL
- Health check
- Dashboard de proyectos
- Creación, listado y lectura individual de proyectos
- Descubrimiento determinista según tipo de proyecto
- Persistencia progresiva de respuestas
- Reanudación, progreso, revisión y finalización del descubrimiento
- Pruebas unitarias y de integración HTTP sin base de datos
- Proxy `/api/*` entre navegador y Fastify

## Límites del descubrimiento actual

- Las preguntas provienen de plantillas versionadas en código.
- La sesión se crea al iniciar descubrimiento por primera vez.
- Solo existe una sesión por proyecto.
- Las preguntas se materializan en PostgreSQL al iniciar para conservar el texto utilizado.
- Las respuestas admiten texto, número, fecha, selección simple, selección múltiple y sí/no.
- El frontend actual presenta controles para todos esos tipos.
- Completar exige todas las respuestas obligatorias.

## Fuera de alcance

- Autenticación y autorización
- OpenAI u otros proveedores de IA
- Generación dinámica de preguntas
- Generación final de propuestas
- Planificación, sprints, Kanban y tarjetas
- Colaboración multiusuario
- Supabase
- Integración con MemoOS
- JSON maestro como fuente de verdad

## Verificación pendiente con infraestructura

La migración y el flujo completo contra PostgreSQL deben ejecutarse cuando exista una `DATABASE_URL` utilizable. Las pruebas actuales verifican contratos, reglas de dominio y endpoints Fastify mediante un almacén de prueba en memoria; no sustituyen una prueba real de la migración.
