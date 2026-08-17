# Migraciones de PostgreSQL

MemoOS conserva migraciones SQL incrementales en `apps/api/drizzle`. Los
archivos se ordenan por su prefijo numérico y una migración histórica nunca se
debe editar después de aplicarla.

## Comandos

Desde la raíz del repositorio:

```powershell
pnpm db:migrate:status
pnpm db:migrate
pnpm test:integration:migrations
```

Estos comandos leen `DATABASE_URL` desde el entorno. En desarrollo, el script
del paquete API carga `apps/api/.env` porque pnpm lo ejecuta desde ese paquete.

`db:migrate:status` es de solo lectura. Muestra cada archivo como:

- `applied`: está registrado y el checksum coincide;
- `pending`: todavía no está registrado;
- `unverified`: el historial antiguo no tiene checksum;
- `modified`: el archivo ya aplicado no coincide con su checksum registrado.

`db:migrate` toma un advisory lock de PostgreSQL para serializar migradores,
valida primero todo el historial y ejecuta cada archivo pendiente completo en
una transacción propia. La misma transacción registra el ID y el checksum. Si
el SQL falla, también se revierte su registro. El migrador no separa SQL por
puntos y coma. El checksum normaliza únicamente los finales de línea para ser
estable entre Windows y Linux; cualquier otro cambio del archivo se detecta.

`test:integration:migrations` requiere Docker local. Levanta PostgreSQL 16 en
un contenedor efímero ligado a `127.0.0.1` y un puerto aleatorio, ejecuta las
pruebas reales y elimina el contenedor y su volumen incluso si una prueba
falla. La prueba rechaza cualquier URL que no sea local o que no use la base
administrativa temporal esperada. No carga `DATABASE_URL` de la aplicación.

## Adopción desde el historial anterior

El migrador anterior ya utilizaba `schema_migrations`, pero la tabla solo
guardaba `id` y `applied_at`. El migrador nuevo nunca deduce el historial a
partir de la existencia de tablas de producto y se niega a ejecutar pendientes
mientras detecte ese formato antiguo.

Procedimiento manual por entorno:

1. Configurar conscientemente la `DATABASE_URL` del entorno objetivo.
2. Ejecutar `pnpm db:migrate:status`.
3. Comparar los IDs `unverified` con el historial esperado de ese entorno.
4. Revisar que no haya IDs desconocidos, huecos ni archivos modificados.
5. Hacer o confirmar un backup recuperable antes de modificar el historial.
6. Solo después de esa revisión, ejecutar:

   ```powershell
   pnpm db:migrate:bootstrap -- --accept-existing
   ```

7. Ejecutar nuevamente `pnpm db:migrate:status` y confirmar que las antiguas
   aparecen como `applied` y las demás como `pending`.
8. Con una autorización separada, ejecutar `pnpm db:migrate`.

El bootstrap requiere la bandera literal `--accept-existing`. Solo añade y
completa la columna `checksum` para IDs que la tabla histórica ya contenía; no
marca migraciones pendientes, no inspecciona tablas de producto y no ejecuta
los archivos SQL.

## Garantías y límites

- Una migración aplicada con checksum diferente aborta todo el comando.
- IDs desconocidos o un historial con huecos abortan el comando.
- Dos migradores no pueden avanzar simultáneamente mientras compartan la misma
  base PostgreSQL.
- Cada migración es atómica siempre que todas sus sentencias sean
  transaccionales en PostgreSQL.
- La prueba de integración con PostgreSQL temporal cubre ejecución de SQL
  completo, orden, no repetición, rollback real, checksums, bootstrap y bloqueo
  concurrente. No se ejecuta dentro de `pnpm test`; requiere invocación
  explícita para no convertir Docker en una dependencia de las pruebas rápidas.
