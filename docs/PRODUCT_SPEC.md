# Product Spec

## Propósito

Project Architect ayuda a recopilar, organizar y revisar el contexto de un proyecto complejo antes de solicitar recomendaciones o convertirlo en trabajo ejecutable.

El producto evita generar un plan superficial a partir de una sola frase. Primero identifica qué se sabe, qué falta y qué restricciones condicionan el proyecto.

## Tipos iniciales

- `research`: investigación o exploración con resultado inicialmente incierto.
- `competition`: concurso o hackathon condicionado por reglas, criterios y fecha límite.

## Flujo funcional actual

1. El usuario crea un proyecto con nombre, tipo y objetivo global.
2. Fastify guarda el proyecto en PostgreSQL.
3. El usuario abre el detalle del proyecto.
4. Inicia una sesión idempotente de descubrimiento.
5. El backend materializa una plantilla determinista adecuada al tipo.
6. El usuario responde por secciones y guarda progresivamente.
7. El backend actualiza respuestas sin duplicarlas y calcula el progreso.
8. El usuario puede salir y reanudar desde la sección guardada.
9. La aplicación presenta una revisión agrupada.
10. El usuario corrige respuestas o confirma el contexto.
11. La sesión solo cambia a `completed` cuando todas las preguntas obligatorias tienen respuesta.

## Principios

- PostgreSQL es la única fuente de verdad.
- El navegador solo usa `/api/*`.
- Las preguntas deterministas no viven dentro de componentes visuales.
- Los cambios estructurales importantes requieren confirmación humana.
- La interfaz visible está en español.
- La ausencia de autenticación no elimina la validación de pertenencia entre proyecto, sesión y pregunta.

## No objetivos del incremento

- Generar preguntas mediante IA
- Generar propuestas o planes
- Integrar OpenAI
- Crear sprints, tareas o tablero
- Convertirse en un gestor genérico de proyectos
- Integrarse con MemoOS o Supabase

## Próximo objetivo de producto

Antes de añadir IA, conviene endurecer el módulo con pruebas de integración contra PostgreSQL, observabilidad de errores y un mecanismo explícito para reabrir o versionar contexto confirmado.
