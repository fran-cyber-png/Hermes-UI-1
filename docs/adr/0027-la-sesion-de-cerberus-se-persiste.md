# ADR 0027 — La sesión de Cerberus se persiste: un deploy ya no desloguea a las vendedoras

**Fecha**: 2026-07-28 · **Estado**: aceptado · **Issue**: #106 · **Reemplaza**: la decisión escrita
en `cerberus/sesionStore.ts` («en memoria a propósito: es una credencial de sesión viva; no va a la
base ni al disco»).

## Contexto

El token de Hermes es HMAC sin estado y sobrevive cualquier reinicio. La cookie de Cerberus
(`sessionid` + `csrftoken`), con la que Hermes **actúa como la vendedora** al registrar una venta,
vivía en un `Map` del proceso — una decisión deliberada y documentada en el propio archivo.

El costo, medido por la auditoría del 24-jul (#106): **cada deploy del server desloguea a las tres
vendedoras a la vez** — siguen viendo la app como si nada (el token de Hermes vive) y se enteran al
registrar una venta, con un 409. Con dos devs desplegando y la adopción del **3 de agosto** encima,
ese costo dejó de ser aceptable: un deploy el 4-ago en plena adopción sangra la confianza en la
herramienta justo cuando más frágil es. La alternativa era congelar los deploys de server para
siempre, que es tratar el síntoma alquilando el bug.

## Decisión

1. **La sesión se persiste en la Postgres de Hermes** (tabla `sesiones_cerberus`: `vendedora_id` PK,
   la cookie en `jsonb`, `guardada_en`). Migración versionada `0008_sesion_cerberus_persistida`.
2. **El `Map` no se va: baja a caché.** El camino caliente no paga un SELECT por request; la base es
   el respaldo que cruza el reinicio. Un solo store compartido (auth y ventas): dos cachés separados
   servirían una cookie vieja después de un re-login.
3. **La vigencia se decide al leer Y se purga al arrancar**: `VIGENCIA_SESION_MS` = 14 días, los
   mismos del token de Hermes (el `SESSION_COOKIE_AGE` de Cerberus **no se verificó contra su
   repo** — si es menor, la fila puede quedar presente y muerta antes del TTL). Una fila más vieja
   se trata como inexistente; al nacer el store se borran las vencidas de todas las vendedoras —
   sin esa purga el TTL sería solo «ignorar al leer» y la fila de una vendedora inactiva viviría
   para siempre. Y cuando Cerberus la mata por su cuenta, **el primer lugar que lo descubre la
   borra**: `crearVenta` trata el 302 a `/ingresar/` como sesión muerta (nunca como «registrada» —
   antes escribía una venta fantasma en el embudo) y `cargarFormulario` detecta el redirect; los
   dos llaman a `borrarSesionCerberus` para que `/yo` diga la verdad.
4. **La base degrada, nunca tumba**: sin la tabla migrada o con la base caída, el store se comporta
   exactamente como el `Map` de antes (funciona hasta el próximo reinicio) y lo dice por el log. Un
   login no puede fallar porque la persistencia falló.
5. **Seam inyectable** (`crearSesionStore(base, ahora)`), con tests con base (ADR 0008) cuyo caso
   central es el reinicio: un store nuevo sobre la misma base es lo que un deploy le hace a
   producción.

## Sobre el argumento de seguridad que esta decisión revierte

«Una credencial viva no va a la base» era un principio correcto aplicado a un riesgo mal pesado. La
fila vive en la misma Postgres (127.0.0.1:5438, no expuesta) del mismo host que ya custodia
`.wa-sessions/` — la credencial de WhatsApp entera, bastante más sensible. El riesgo real y medido
era el deploy que tira una venta; el riesgo teórico que el `Map` mitigaba exige un atacante que ya
lee la base de producción, y ese atacante tiene cosas peores que llevarse. El TTL de 14 días acota
la vida útil de una fila robada — y para que eso sea **cierto** y no una intención, la purga al
arrancar borra las filas vencidas de verdad (la revisión adversaria del PR atrapó que sin ella el
TTL era solo «ignorar al leer»).

Dos costos que se aceptan con los ojos abiertos: (a) los `pg_dump` del deploy (`hermes-deploy.sh`,
rotación a 20) ahora llevan cookies vivas adentro — permisos `0640`/dir `0750`, pero un dump puede
sobrevivir a su propio TTL; (b) **no hay revocación server-side todavía** (el logout del front no
llama a ningún endpoint): una vendedora que deja el equipo conserva su fila operable hasta 14 días
o hasta que un `DELETE` manual la saque — trackeado como issue propio, no se resuelve acá.

## Consecuencias

- **N5 sigue siendo un botón**, pero su razón principal cambia: reiniciar ya no desloguea; queda la
  prudencia general de no reiniciar el server en horario de venta sin mirar.
- `GET /api/auth/yo` sigue devolviendo `cerberus: boolean`; `false` ya no significa «hubo un
  deploy» sino «venció o nunca existió».
- El congelamiento de deploys de la semana del 3-ago (pregunta §6.3 del plan) pasa de necesidad a
  precaución: con esto desplegado ANTES del 3-ago, un deploy de emergencia esa semana no desloguea.
- Los tests del store simulan el reinicio con un store nuevo sobre la misma base
  (`sesionStore.test.db.ts`) y fijan la degradación sin tabla.
