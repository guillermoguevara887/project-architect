# Auditoría de backups de Railway

## Lo que demuestra el repositorio

MemoOS usa PostgreSQL como fuente de verdad y obtiene la conexión mediante
`DATABASE_URL`. El repositorio contiene migraciones y health checks, pero no
contiene configuración declarativa de backups, retención ni restauración de
Railway.

Por lo tanto, desde el código no se puede afirmar que existan backups, conocer
su frecuencia o demostrar que una restauración funciona. Esos datos deben
verificarse en el proyecto y plan actuales de Railway.

## Checklist manual

- [ ] Abrir el servicio PostgreSQL correcto en Railway y confirmar que es el
      mismo destino usado por la `DATABASE_URL` de producción.
- [ ] Verificar si backups o snapshots están habilitados para ese servicio.
- [ ] Registrar la frecuencia real y si el horario está expresado en UTC.
- [ ] Registrar la retención: cuántas copias se conservan y durante cuánto
      tiempo.
- [ ] Confirmar si los backups incluyen toda la base, extensiones y esquema.
- [ ] Documentar quién tiene permiso para iniciar una restauración.
- [ ] Documentar el procedimiento oficial de restauración y su tiempo estimado.
- [ ] Confirmar si restaurar reemplaza la base actual o crea una instancia
      separada.
- [ ] Revisar la fecha y estado del backup más reciente.

## Prueba segura de restauración

1. Elegir un backup reciente sin modificar producción.
2. Restaurarlo en un servicio PostgreSQL temporal y aislado.
3. Usar credenciales distintas y no cambiar la `DATABASE_URL` de producción.
4. Conectar una sesión local o un entorno de prueba a esa copia.
5. Verificar tablas, conteos aproximados, usuario de prueba y rutas de lectura.
6. Ejecutar `pnpm db:migrate:status` contra la copia restaurada.
7. Registrar fecha, duración, resultado y cualquier paso manual descubierto.
8. Eliminar el servicio temporal únicamente después de conservar la evidencia
   de la prueba y confirmar que ninguna aplicación apunta a él.

Una copia no debe considerarse recuperable hasta completar con éxito esta
prueba en un entorno aislado.
