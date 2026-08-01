# AI Pipeline

No hay llamadas a OpenAI ni a otros proveedores de IA en el incremento actual.

## Contexto preparado

El descubrimiento determinista crea una base estructurada y confirmada:

1. Proyecto con tipo y objetivo global.
2. Sesión con estado explícito.
3. Preguntas materializadas por sección.
4. Respuestas validadas y persistidas.
5. Progreso y obligatorias faltantes calculados por el backend.
6. Confirmación humana mediante estado `completed`.

Una integración futura solo deberá considerar elegibles las sesiones confirmadas. Deberá leer PostgreSQL a través del backend y construir un DTO o snapshot derivado; nunca editar un JSON maestro como estado canónico.

## Pipeline futuro propuesto

1. Seleccionar una sesión `completed`.
2. Construir un contexto estructurado desde PostgreSQL.
3. Detectar vacíos, contradicciones y riesgos.
4. Proponer varias direcciones iniciales, no un plan cerrado.
5. Permitir que el usuario edite, rechace o apruebe.
6. Registrar la entrada, salida, versión del modelo y contexto de origen.
7. Solo después de una aprobación explícita, preparar el siguiente incremento.

## Principios

- Las ediciones del usuario son autoritativas.
- La IA no modifica datos canónicos sin una acción de dominio validada.
- Cada salida debe referenciar el proyecto y la versión de contexto utilizada.
- Las suposiciones deben distinguirse de los hechos proporcionados.
- La aplicación debe poder reproducir y auditar una ejecución.

## Fuera de alcance actual

- Configuración de OpenAI
- Prompts
- Generación dinámica de preguntas
- Propuestas, planes o sprints
- Tablero o tarjetas
