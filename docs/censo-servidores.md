# Censo de servidores — la tabla viva

> El plan y las reglas: [`plan-2026-08-escuela-y-servidores.md`](plan-2026-08-escuela-y-servidores.md) §2.3.
> **Nada muere sin censo, el censo es read-only, y la kill-list la firma el dueño** — los veredictos
> de acá son PROBABLES, no órdenes. El molde de retiro es el [ADR 0026](adr/0026-retiro-del-bot-de-baileys.md):
> censar → archivar con verificación → detener (reversible) → **preguntar** → borrar.

## Lote 1 — los stacks duplicados en ambos VPS (censado 29-jul-2026)

| Stack | VPS | Qué es | Dominio DNS | Último dato/tráfico real | Veredicto PROBABLE |
|---|---|---|---|---|---|
| goberna_escuela | **VPS1** | LMS de la Escuela (backend :4040, front :7020; pg 20 MB, 33 migraciones) | `escuela.institutogoberna.com` → VPS1, responde 200 | users 6.085 (alta 13-jul) · `progress` 24-jul | **QUEDA — es el canónico** |
| goberna_escuela | **VPS2** | Rewrite/import ABANDONADO (schema distinto, 1 migración; pg 16 MB) | ninguno (solo IP:7020; sin vhost) | users 6.056, último alta **30-abr** · backend sin log desde 13-may · solo scanners | **ARCHIVAR/APAGAR** (dump + repuntar Grafana ANTES, ver 🔴 abajo) |
| leads_crm api+ui | **VPS1** | CRM pre-Hermes (db 183 MB: 59.707 leads) | `crm.goberna.us/.club` · `ventas.goberna.us` | datos congelados **26-may**, pero la UI recibió **visitas humanas HOY** | **QUEDA congelado** → archivar tras export (alguien lo consulta aún) |
| leads_crm api+bot | **VPS2** | Mismo CRM + bot WhatsApp «kathy» (**Baileys**, ⚠️ ver abajo) | ninguno | datos 10-jun · bot **deslogueado de WA desde 16-jun** | **APAGAR** (dump previo) |
| nexus_backend | **VPS1** | Backend legacy del compose nexus | ninguno | solo su propio healthcheck cada 15 s | **APAGAR el backend** (la base NO) |
| nexus_postgres | **VPS1** | Clúster pg: `appdb` 1,7 GB + **`mail_prod` VIVA** | n/a | `campaign_events` **HOY 29-jul 09:01** (42.679) | **QUEDA — alberga el mail vivo** |
| nexus_backend+pg | **VPS2** | Compose duplicado, otro contenido (`appdb` 675 MB) | ninguno | `conversations` último **23-abr** · solo healthcheck | **ARCHIVAR/APAGAR** (dump previo) |
| nexus_mail_api | **VPS1** | API de mail :8091 delante del stack Mailu | `mail.goberna.club` → VPS1 | 0 logs 30 d, pero su base registra eventos HOY | **QUEDA** |
| nexus_mail_api | **VPS2** | Copia :8091 sin puerta de entrada (conf no incluido) | ninguno activo | `messages_log` congelado **16-may** | **APAGAR** |

### La pregunta crítica de `goberna_escuela`: respondida

**Hay dos bases con datos pero NO hay doble escritura**: VPS2 está congelada desde el 30-abr y ni
siquiera es el mismo software (schema distinto, 1 migración vs 33). VPS1 es el canónico: recibe el
DNS, escribe hasta el 24-jul. La ventana de divergencia que el plan temía no existe.

### 🔴 Lo que el dueño tiene que ver (tres cosas)

1. **El Grafana de VPS2 muestra cifras de ABRIL como si fueran de hoy**: su datasource «Escuela»
   (`/srv/monitoring/grafana/provisioning/datasources/business.yml`) apunta a la base CONGELADA de
   VPS2. Los paneles «Alumnos registrados» e «Inscripciones» mienten desde hace tres meses. Antes
   de apagar VPS2-escuela: dump + repuntar (o retirar) ese datasource. Es el mismo patrón del
   `/health` de Ivi: verde sin decir de cuándo es el dato.
2. **Incidente de secreto del propio censo**: un `grep -r` sobre `/srv/monitoring` devolvió el VALOR
   de `GOBERNA_ESCUELA_DB_PASSWORD` (estaba en un `.env` que el patrón no excluyó) en la salida de
   la sesión del agente censista. No se usó ni se copió a ningún archivo, pero quedó impreso una
   vez: **conviene rotarla**. Lección para los próximos lotes: los `grep` de censo llevan
   `--exclude='*.env*'` SIEMPRE.
3. **Otro bot Baileys**: `leads_crm_bot` («kathy») en VPS2 — la política del 2026-07-03 prohíbe
   Baileys para clientes y la lección del ADR 0026 era que una prohibición sin barrido es
   documentación. Este es el segundo hallazgo del barrido que nunca se hizo. Está deslogueado desde
   el 16-jun (sin tormenta activa), pero es capacidad instalada de la clase prohibida.

### El cableado que impide apagar a ciegas

`nexus_backend` está enchufado a la red `leads-crm_internal` **en los dos VPS**, y el scheduler de
`leads_crm_api` (VPS1) hoy falla autenticando como rol `nexus`. Apagar cualquiera de los dos stacks
sin mirar ese cruce puede romper al otro. Entra al plan de apagado como dependencia, no como nota.

### Lo que el lote 1 no pudo determinar

- Qué proceso escribe `mail_prod.campaign_events` en VPS1 (confirmarlo exigía leer valores de env —
  prohibido; candidatos: `goberna_mail_metrics` o webhooks de Mailu).
- Si alguien consume el backend escuela de VPS2 por IP directa (:4040 no loguea por request).
- Quiénes visitan `leads_crm_ui` hoy (IP interna de docker; solo se ve el referer).
- **Para el lote 2**: `meta_escuela_backend` (:4100) + `meta_escuela_prod_db` en VPS1 — el tercer
  stack con nombre de escuela, fuera del alcance de este lote; y por qué `/srv/app` (working_dir
  del compose nexus) es hoy un checkout de `maquina-electoral-goberna`.
