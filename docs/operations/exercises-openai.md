# Tutor de Ejercicios con OpenAI

El módulo Ejercicios genera guías y pasos sugeridos únicamente desde la API de
MemoOS. El navegador nunca recibe la clave de OpenAI. Ambos resultados se
guardan en PostgreSQL y solo se regeneran mediante una acción explícita del
usuario.

## Variables del backend

```dotenv
OPENAI_API_KEY=replace-with-a-server-side-api-key
OPENAI_EXERCISE_GUIDE_MODEL=gpt-5.4-mini
OPENAI_EXERCISE_STEPS_MODEL=gpt-5.4-mini
```

`OPENAI_API_KEY` es obligatoria solo al generar contenido. Las dos variables de
modelo son opcionales e independientes para permitir que los pasos usen otro
modelo más adelante. Si no están definidas, cada acción usa `gpt-5.4-mini` como
valor predeterminado.

Las llamadas usan Responses API, salidas estructuradas y `store: false`. El
enunciado se trata como contenido no confiable. Las instrucciones piden actuar
como tutor y prohíben entregar una solución completa o código terminado.

## Antes de desplegar

1. Confirmar un backup recuperable de PostgreSQL.
2. Revisar el estado de migraciones en el entorno correcto.
3. Aplicar `0011_create_exercises.sql` mediante el migrador seguro, solo con
   autorización explícita.
4. Configurar `OPENAI_API_KEY` y, opcionalmente, los modelos en el backend.
5. Desplegar API y frontend.
6. Verificar manualmente creación, aislamiento de usuario, estado, workspace,
   generación, recarga y regeneración.

La migración no debe ejecutarse automáticamente desde CI ni al iniciar la API.
