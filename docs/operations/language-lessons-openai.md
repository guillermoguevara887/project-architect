# Lecciones estructuradas de Idiomas con OpenAI

Idiomas procesa cada lección con una única llamada desde la API de MemoOS. El
navegador nunca se conecta directamente a OpenAI y nunca recibe la clave del
proveedor.

## Variables del backend

Configurar únicamente en el entorno de la API:

```dotenv
OPENAI_API_KEY=replace-with-a-server-side-api-key
OPENAI_LANGUAGE_MODEL=gpt-5.4-mini
```

`OPENAI_API_KEY` es obligatoria solo al procesar una lección. Lint, TypeScript,
tests, build, health checks y las partes que no usan IA funcionan sin realizar
una llamada real. `OPENAI_LANGUAGE_MODEL` es opcional y permite sustituir el
modelo sin cambiar código.

No crear una variable `NEXT_PUBLIC_OPENAI_API_KEY`, no registrar la clave y no
añadir valores reales al repositorio.

## Contrato y privacidad

El backend usa la Responses API con Structured Outputs y un esquema Zod
estricto. El resultado contiene exactamente ocho propiedades principales:

- `vocabulary`
- `phrases`
- `patterns`
- `miniStory`
- `automaticThoughts`
- `dialogue`
- `nextLevelBridge`
- `review`

`source_content` se conserva en PostgreSQL para trazabilidad y reintentos, pero
la respuesta normal de una lección `ready` no lo incluye. La llamada se realiza
con almacenamiento de respuestas del proveedor desactivado (`store: false`).

## Estados

- `draft`: acepta material y permite procesar.
- `processing`: bloquea envíos duplicados mientras la petición está activa.
- `failed`: conserva el material y permite reintentar.
- `ready`: contiene `structured_content` y `processed_at`; no permite editar ni
  reprocesar.

Un estado `processing` con más de 15 minutos se trata como fallido recuperable
para evitar que una interrupción deje la lección bloqueada permanentemente.

El material fuente admite como máximo 100.000 caracteres. El API rechaza el
exceso sin truncarlo.

## Antes de desplegar

1. Revisar y fusionar el código y comprobar la CI sin una clave real.
2. Confirmar un backup recuperable de PostgreSQL.
3. Consultar el estado de migraciones contra el destino correcto.
4. Aplicar `0006_structure_language_lessons.sql` mediante el migrador seguro,
   únicamente después de autorización explícita.
5. Configurar `OPENAI_API_KEY` en el proyecto de backend de Vercel.
6. Configurar opcionalmente `OPENAI_LANGUAGE_MODEL`.
7. Desplegar la API y el frontend.
8. Comprobar manualmente creación, procesamiento, recarga, copia por sección y
   eliminación de una lección.

La migración `0006` no debe ejecutarse desde CI ni automáticamente al iniciar la
aplicación.
