# ADR 0028 — Los dos retiros firmados del censo lote 1: el bot «kathy» y el Grafana de VPS2

**Fecha**: 2026-07-29 · **Estado**: aceptado y ejecutado · **Decide**: el dueño (firmó los dos por
chat el 29-jul, sobre los hallazgos de [`../censo-servidores.md`](../censo-servidores.md)) ·
**Molde**: [ADR 0026](0026-retiro-del-bot-de-baileys.md) — censar → archivar → detener → preguntar
→ borrar. Acá el «preguntar» ocurrió antes que el «borrar», como corresponde.

## 1. `leads_crm_bot` («kathy») — el segundo Baileys del barrido que nunca se hizo

**Qué era**: bot de WhatsApp con `@whiskeysockets/baileys` dentro del stack `leads_crm` de VPS2,
deslogueado de WhatsApp desde el **16-jun** («Logged out — need to re-scan QR»), con 923
interacciones en la base compartida. La política del 2026-07-03 prohíbe Baileys para clientes; la
lección del ADR 0026 era que una prohibición sin barrido de inventario es documentación — este es
el segundo hallazgo de ese barrido, encontrado por el censo.

**Decisión del dueño**: «aprende y quitalo del servidor».

**Ejecutado (29-jul)**:
- ✅ Archivo en `/srv/backups/archivo/leads-crm-bot-kathy-20260729/`: `inspect.json`, últimos 200
  logs, referencia del compose. Los datos de negocio (las 923 interacciones) **viven en la base
  compartida `leads_crm`, que queda** — no se archivaron aparte porque no se borran.
- ✅ `docker update --restart=no` → `stop` → `rm` del contenedor.
- ✅ **El volumen `leads-crm_bot_sessions` se DESTRUYÓ** (`docker volume rm`), no se archivó: son
  credenciales de sesión de WhatsApp, y un archivo de credenciales es un pasivo, no un respaldo
  (la regla del ADR 0026 §3).
- ✅ Verificado después: `leads_crm_api` y `leads_crm_db` siguen `Up`, intactos.

**Lo aprendido, que es lo que el dueño pidió conservar**: (a) el barrido de la política del 3-jul
sigue incompleto — dos bots encontrados por accidente y censo, no por búsqueda dirigida; el censo
de los lotes siguientes incluye `grep baileys` como paso fijo; (b) el bot compartía red con el CRM
(`leads-crm_internal`) — los stacks viejos traen acoplamientos que hacen peligroso el apagado a
ciegas, y por eso el censo mapea redes antes de tocar.

## 2. `monitoring_grafana` (VPS2) — el dashboard que mentía desde abril

**Qué era**: el Grafana del stack `/srv/monitoring`, cuyo datasource «Escuela» apuntaba a la base
**congelada** del rewrite abandonado de goberna_escuela (VPS2): los paneles «Alumnos registrados» e
«Inscripciones» mostraban cifras del 30-abr como si fueran de hoy. Además: puerto 3003 expuesto,
password admin con default inline en el compose, y puentes a CUATRO redes
(`monitoring`, `leads-crm_internal`, `goberna-escuela_internal`, `nexus_app_network`) — un solo
contenedor con vista a todo.

**Decisión del dueño**: «quita grafana» (el punto 2 del reporte — rotar
`GOBERNA_ESCUELA_DB_PASSWORD` — quedó explícitamente **pendiente, sin ejecutar**, por decisión del
mismo chat).

**Ejecutado (29-jul)**:
- ✅ Archivo en `/srv/backups/archivo/grafana-vps2-20260729/`: `inspect.json`,
  `grafana-config.tgz` (provisioning + dashboards) y el compose previo.
- ✅ El bloque `grafana:` del `docker-compose.yml` quedó **comentado** (marcador
  `#RETIRADO-20260729`, backup `.bak-retiro-20260729`): un `docker compose up -d` no lo resucita.
- ✅ `restart=no` → `stop` → `rm`. Verificado: puerto 3003 **cerrado**; prometheus, alertmanager,
  node_exporter y blackbox siguen `Up`.
- El volumen `grafana_data` (dashboards guardados) **se conserva** por ahora — es reversible y
  entra a la kill-list general del censo para su borrado final.

**La lección transversal** (la tercera vez que aparece este patrón en dos días): un tablero verde
sin edad del dato declarada es peor que ningún tablero — es el `/health` de Ivi que no delata la
proyección congelada, el `Up (healthy)` del bot muerto de ADR 0026, y ahora un Grafana sirviendo
abril como presente. **Regla para lo que se reconstruya**: todo panel de negocio declara la fecha
del dato más nuevo que muestra, o no se publica.

## Consecuencias

- VPS2 pierde dos servicios y un volumen de credenciales; nada de lo vivo se tocó.
- El monitoreo de VPS2 queda **sin visualización** (prometheus junta, nadie grafica). Si hace
  falta un tablero, se reconstruye apuntando a las fuentes CANÓNICAS (escuela-VPS1) y con la regla
  de edad del dato de arriba.
- La fila del censo se actualiza; el resto de la kill-list sigue esperando firma, servicio por
  servicio.
