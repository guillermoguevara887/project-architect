# Auth Architecture

Authentication is not implemented in the current foundation.

## Future Auth Decision

Project Architect will use Better Auth hosted by the Fastify backend. Do not implement manual password hash tables, manual refresh token tables, or custom session storage before Better Auth is introduced.

## Same-Origin Browser Communication

The browser must not call the Railway API domain directly.

The frontend must call backend endpoints through relative paths under:

```text
/api/*
```

Next.js or Vercel rewrites those requests to the backend target configured by environment variables.

## Reasoning

This preserves same-origin communication from the browser perspective and simplifies future use of secure HTTP-only cookies for Better Auth sessions.

## Environment Variable

`API_INTERNAL_URL` defines the server-side rewrite target.

Local example:

```text
API_INTERNAL_URL=http://localhost:4000
```

Production example:

```text
API_INTERNAL_URL=https://project-architect-api.example.up.railway.app
```

The production value is an example only. Do not commit real deployment secrets or private URLs if they become sensitive.

## Current API Flow

1. El navegador solicita una ruta relativa como `/api/health`, `/api/projects` o `/api/projects/:id/discovery`.
2. El rewrite de Next.js reenvia la solicitud a `${API_INTERNAL_URL}` sin exponer ese destino al cliente.
3. Fastify valida la entrada, accede a PostgreSQL cuando corresponde y devuelve un DTO.
4. El frontend valida la respuesta mediante los contratos Zod de `packages/contracts`.

Mientras no exista autenticacion, el producto debe utilizarse en un entorno local o controlado. La validacion de pertenencia entre proyecto, sesion y pregunta ya se aplica, pero no sustituye control de acceso por usuario.
