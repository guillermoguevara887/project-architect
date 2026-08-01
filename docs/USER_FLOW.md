# User Flow

## Flujo implementado

1. El usuario abre el dashboard.
2. La web solicita `/api/projects`.
3. El dashboard muestra cada proyecto, tipo, objetivo y estado del descubrimiento.
4. El usuario crea un proyecto desde `/projects/new`.
5. Tras guardarlo, la web navega a `/projects/:projectId`.
6. La página de detalle permite iniciar o continuar el descubrimiento.
7. La ruta `/projects/:projectId/discovery` obtiene o inicia la sesión.
8. El usuario avanza por cinco secciones.
9. “Guardar y continuar” persiste las respuestas de la sección y la posición actual.
10. El usuario puede abandonar el flujo y reanudarlo posteriormente.
11. Al terminar las secciones, la sesión pasa a `ready_for_review`.
12. La revisión agrupa preguntas y respuestas, permite editar y resalta obligatorias faltantes.
13. “Confirmar contexto” solo está disponible cuando las obligatorias están respondidas.
14. Al confirmar, la sesión pasa a `completed` y muestra que el contexto está listo para una futura fase de IA.

## Estados

- `not_started`: no existe una sesión materializada.
- `in_progress`: el usuario está recopilando o editando información.
- `ready_for_review`: el usuario llegó a la revisión.
- `completed`: el contexto fue confirmado.

## Recuperación de errores

- Las solicitudes deshabilitan botones mientras están activas.
- Un error de guardado conserva los valores escritos en el estado del formulario.
- La API devuelve errores con `error.code` y `error.message`.
- Preguntas que no pertenecen al proyecto indicado son rechazadas.

## Flujo futuro, no implementado

Después del descubrimiento confirmado podrá existir un análisis asistido por IA. Cualquier dirección propuesta deberá ser revisada y aprobada antes de generar un sprint.
