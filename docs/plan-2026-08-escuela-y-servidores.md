# Plan 2026-08 — Escuela primero, y los servidores en orden

> ⚠️ **§2 (Plan SERVIDORES) se mudó a [`goberna-infra`](https://github.com/Goberna-Lab/goberna-infra/blob/main/docs/plan-2026-08-escuela-y-servidores.md)**
> junto con el censo — ver [ADR 0057](adr/0057-el-censo-de-servidores-se-muda-a-goberna-infra.md).
> Esa copia es la viva; ésta queda como estaba el 27-jul, de contexto histórico para §1. **§1
> (Plan ESCUELA) sigue siendo de acá** — es producto, no infraestructura.

> **Decisión de foco del dueño (27-jul-2026)**: ahora el frente es **Goberna
> escuela/eventos/ventas** — terminar esas herramientas e integrarlas (geografo/Ivi, Flux/Studio)
> **para Goberna como empresa primero**; los candidatos (plano B de
> [`dos-planos.md`](dos-planos.md)) vienen después.
>
> Este plan sale de datos, no de opinión: los **61 issues abiertos de hermes**, los PRs de
> `ceberusapp`, los commits de `goberna-dashboard`, y el **inventario en vivo de VPS1 y VPS2**
> (2026-07-27, por SSH). Cada afirmación con número tiene su fuente al lado.

---

## 0. Lo que dicen los repos — el análisis

### 0.1 hermes — 61 issues abiertos, en siete grupos

| Grupo | Issues | Lectura |
|---|---|---|
| **Puente Ivi** | #141 #142 #143 #144 | #141/#142 (dialecto snake_case, historial `{q,a}`) **ya los arregló ADR 0021** según CLAUDE.md — están abiertos por falta de cierre con evidencia. #143 (falta `IVI_URL` en prod) contradice a `estado.md` que la da por cargada: verificar y cerrar. #144 (el deploy puede secuestrar el `:4100` de meta-escuela) sigue real. **El bloqueo de fondo no es ninguno de estos: es que `POST /api/preguntar` no está desplegado en geografo** (da 404) y geografo despliega desde el checkout viejo de meta-escuela |
| **Seguridad** | #203 #107 #106 #94 #95 | #203: `.wa-media/` autenticado pero **no autorizado** — cualquier vendedora lee el archivo de cualquiera. #107: el webhook Cloud API **no verifica firma y `firma.ts` existe sin usarse**. #106: `sesionStore` es un Map — **cada deploy desloguea a las tres vendedoras** (crítico con el 3-ago encima). #94 CORS `*`. #95 credencial de servicio |
| **El lazo** | #185 #180 #187 #186 #196 | **#185 es urgente y está venciendo**: 6.906 interacciones sin línea, y el issue pedía atribuirlas *antes* de vincular a Walter — Walter ya está vinculado y las tres líneas escriben desde el 27-jul: cada día que pasa el backfill es más ambiguo. **#180 corrompe el lazo**: el `orden` de un paso se recalcula al guardar, así que el `12#3` estampado puede repuntar a otro paso. #196 quedó a medias (los commits `d4bdf0d`/`b99efaf` son parte) |
| **Eventos** | #145 | «No se puede registrar interés en el Foro» — el fix **está mergeado en ceberusapp (PR #3) desde julio y NADIE LO DESPLEGÓ**. El frente «eventos» entero está detrás de un botón de deploy |
| **Ventas/matrícula** | #159 #164 #156 #153 #128 #126 #140 | La cadena venta→matrícula→campus (#159, con 5 personas que pagaron hace +4 meses sin acceso), recompra en el Dashboard (#164 — la postventa es el 38,6% de las ventas), lista de espera (#156 — la objeción #1, 13%), y la palanca medida de #153: **responder en <5 min** |
| **Épicas estructurales** | #161 #169 #197 #50 #194 | #161 es el mapa maestro. #169 (piezas+Ivi) tiene a #180/#187 como hijos. #197 (libreta) está en vuelo. #50 quedó casi cerrado con las 3 líneas; #194 es su remate (`numeros_wa` como fuente en vez del `.env`) |
| **Higiene** | #202 #110 #111 #29 #10 #11 #6–#24 | #202 (main ramificable — el árbol está sucio HOY: `galeria-panel.html`, `galeria.tsx` sin trackear), archivar el código muerto con ADR (#110), docs desactualizados (#111), la cola tarda 3,8 s (#29), y el lote viejo de rediseño de Dashboard |

### 0.2 ceberusapp — cero issues, y eso es el problema

- **8 PRs, todos de la saga del panel de WhatsApp + la API de eventos.** Abiertos: **PR #8**
  (el proxy tiraba `numero_en_curso` — sin él no hay botón de cancelar vinculación) y PR #1 (docs).
- **No usa el tracker**: los hallazgos graves conocidos —endpoints que mutan correo y teléfono de
  cualquier cliente **sin sesión ni CSRF** (`users/views.py:825,845`), migraciones que corren solas
  al push— **no tienen issue**. Lo que no está en el tracker no existe para nadie más que para quien
  lo vio.
- **El deploy pendiente es la deuda más barata de pagar de toda la empresa**: PR #3 (eventos en la
  API pública) mergeado y sin desplegar destraba #145 de hermes.

### 0.3 goberna-dashboard — el BI de pauta, con un pecado original

- Django «satélite» que **lee y ESCRIBE la MySQL de Cerberus directo** (`managed=False`), sesión
  compartida por cookie de dominio. Hoy corre en VPS2 (`goberna_dashboard`, `:8002`,
  `dashboard.goberna.us`).
- Commits activos (20–22 jul): «Pautas y Ventas» — campañas Meta ↔ productos ↔ país destino,
  multi-producto por campaña, totales, filtros. **Es la herramienta de ventas/pauta de la Escuela**
  y está viva.
- El pecado: es **el segundo lector-escritor del schema interno de Cerberus** (el primero es
  Hermes). Cada cambio de schema en Cerberus ahora puede romper dos sistemas en silencio. No se
  arregla hoy; se registra: cuando exista el contrato de Cerberus (F4 del plan de plataforma), este
  dashboard es su segundo consumidor — **y esa es justamente la prueba del gate de generalización**.

### 0.4 La foto cruzada

**El cuello de botella de todo el frente escuela/eventos/ventas no está en hermes: está en que
`ceberusapp` no despliega y en que geografo corre un checkout viejo.** Hermes tiene 61 issues pero
sus tres dependencias externas (deploy de Cerberus, endpoint de Ivi, fan-out del webhook) son las
que traban los frentes de más valor.

---

## 1. El plan ESCUELA — terminar e integrar

Seis fases. Las reglas del orquestador de siempre: prohibiciones enumeradas en cada prompt de
agente, evidencia antes de «listo», WIP de 1 PR por repo, y los agentes proponen — el dueño decide.

### E0 — Esta semana (la del 3-ago). Todo lo demás espera

| Qué | Cómo | Con quién |
|---|---|---|
| **Desplegar `ceberusapp`** (destraba eventos #145) y mergear PR #8 | El runner `vps2-cerberus` ya existe; revisar ANTES el camino (las migraciones corren solas) y el cache de Cloudflare (30 días en estáticos — verificar contra el origen, no contra la URL) | `devops-engineer` revisa el camino; deploy con el dueño mirando |
| **#106 `sesionStore`**: persistirlo o congelar deploys de server la semana del 3-ago | Si un deploy el 4-ago desloguea a las tres vendedoras en plena adopción, la adopción sangra | fix chico: `typescript-pro`; **prohibido** crecer a «rediseñar auth» |
| **#185 backfill de línea** sobre las 6.906 interacciones | Cada día con 3 líneas escribiendo lo hace más ambiguo. Es SQL forense: se hace ya o no se hace nunca | `postgres-pro` con `dueno-exigente` verificando el reparto |
| **#202 main ramificable** | El árbol sucio de hoy (galería del panel) se commitea o se descarta | vos |
| **Higiene de tracker**: cerrar #141/#142 con evidencia (ADR 0021), verificar #143, abrir en `ceberusapp` los issues de seguridad que no existen | Sin tracker no hay plan que sobreviva | `Explore` junta la evidencia; los issues los abrís vos |
| **Checklist 3-ago por vendedora** (login, cola por línea, registrar venta) con evidencia Playwright | Regla dura #2 | vos + Playwright |

### E1 — Seguridad del perímetro (se solapa con «Servidores», §2)

- hermes: **#203** (autorización de `.wa-media`), **#107** (verificar firma — `firma.ts` ya existe,
  es cablearlo), #94 (CORS), #95 (credencial de servicio).
- ceberusapp: los endpoints sin auth de `users/views.py` — primero el issue, después el fix mínimo.
- Los puertos expuestos de §2.1 — mismo movimiento.
- Agentes: `security-auditor` (read-only, encuentra y rankea) → fixes chicos por
  `backend-developer`/`typescript-pro` → `code-reviewer` adversario. **Prohibido**: reescrituras;
  cada fix es el mínimo que cierra el agujero.

### E2 — El lazo cierra (la plata vuelve a la conversación)

1. **Fan-out del webhook en `ceberusapp`** (el emisor es mono-destino; agregar destino, 🚨 **jamás
   repuntar** `ICARUS_CERBERUS_WEBHOOK_URL` — icarus sirve a Tejada).
2. **#180**: el `orden` del paso estable — **prerrequisito del lazo**, porque `12#3` que repunta
   silencioso es exactamente el «cero filas en silencio» que ADR 0022 juró evitar.
3. #187 (descarte versionado) y #186 (edición no pisa el original).
4. `resultados/ventas.ts`: el `WHERE` cuando las conversiones fluyan.
5. Dashboard: **#164** (recompra — abre la postventa, 38,6% de las ventas) y #128 (por campaña).

Gate: primer webhook real proyectado en `conversiones_wa`, mostrado con su fila; `piezas:resultados`
con línea de base.

### E3 — Eventos y matrícula como productos de primera

- #145 queda destrabado por E0; cerrarlo con el catálogo trayendo el Foro.
- **#159**: matrícula en la ficha + alerta «pagó y no entró» (las 5 personas de +4 meses son la
  vergüenza silenciosa del negocio). Necesita el endpoint de matrículas de Cerberus → entra al
  contrato (F4 del plan de plataforma, adelantado a esta fase en su tajada mínima).
- **#156**: lista de espera (la objeción #1 medida: aplazamiento, 13%).
- #153: la palanca de <5 min — medirla por línea en el Dashboard de atención (#126).

### E4 — Ivi vivo en producción (geografo)

1. **Paridad de deploy**: geografo despliega desde `ivi-cerebro`, no desde el checkout viejo de
   meta-escuela (su propio `estado.md` lo declara pendiente).
2. **`POST /api/preguntar` desplegado** — hasta entonces todo el puente de Hermes responde su 502
   honesto y la superficie de la tecla `i` muestra errores.
3. #144 (que el deploy de hermes no pueda secuestrar el `:4100`).
4. `traza_id` de punta a punta (hoy nace, viaja y muere en los dos extremos).
5. El catálogo de piezas ya está servido (ADR 0023); conectar el consumo real de Ivi y el
   `contrato_hermes()` con fixture de los dos lados.
- Agentes: acá el trabajo es Python + systemd en geografo — `devops-engineer` para los servicios,
  y el gimnasio de Ivi (`--negocio --auditoria`) como gate: **no se declara vivo sin una corrida
  del gimnasio del CEO con su artefacto**.

### E5 — Flux/Studio para la empresa → **[`plan-flux-studio-catalogo.md`](plan-flux-studio-catalogo.md)**

El circuito es **Studio produce · el catálogo versiona · el lazo mide**, y dos de los tres tramos ya
existen. El diseño completo (cuatro huecos reales y cinco fases) está en su propio documento. Lo que
hay que saber acá:

- **FX-0 se adelanta y no espera a nada**: 🔴 hoy se puede mandar un flyer con **el precio vencido**
  y nada lo detecta — Hermes resuelve `{precio}` contra Cerberus en el instante, pero el flyer lleva
  el precio quemado en los píxeles. Es un bug de negocio en producción, se arregla **sin Flux, sin
  GPU y sin Studio**, y protege ingresos. Va en E0/E1, no en E5.
- El resto (imagen como pieza dentro de ADR 0025 · lease de GPU · Studio publicando al catálogo ·
  rotación medida) sigue en E5, después de que la estructura esté — regla del dueño del 27-jul.

### E6 — goberna-dashboard entra al contrato

Cuando el contrato de Cerberus exista (con la tajada de matrículas de E3 ya andando), el dashboard
se vuelve su **segundo consumidor** — y deja de escribir la MySQL directo. Es la prueba viva del
gate de generalización: si el contrato solo sirve a Hermes, no era un contrato.

---

## 2. El plan SERVIDORES — limpiar y condensar

**Inventario medido el 27-jul**: VPS1 = ~80 contenedores Docker, 14 runners de GitHub, 54 sites
nginx, disco 208/630G (35%). VPS2 = ~48 contenedores activos, 10 runners, ~55 dominios HestiaCP,
disco **388/484G (81%)** — y `/backup` = **199G**, `gh-runner` 25G, build cache Docker 12G.

### 2.1 🧊 CONGELADO por el dueño (28-jul) — puertos abiertos a internet

> **DECISIÓN: no se toca ninguna regla de firewall ni ningún puerto todavía.** Hay devs trabajando
> contra esas superficies y un corte los dejaría sin trabajar. Lo que sigue queda como **inventario
> vigente y deuda declarada**, no como tarea en curso.
>
> **Qué se hace mientras tanto**: (a) esta tabla se mantiene actualizada, (b) el censo (§2.3)
> identifica **quién** usa cada puerto —que es justamente lo que falta para poder cerrarlos sin
> romper a nadie—, y (c) cuando el censo diga «este puerto lo usa Fulano desde tal IP», la regla se
> escribe con whitelist en vez de con cierre. **El censo es el desbloqueante del firewall, no un
> trabajo paralelo.**

Medido en `docker ps`: estas superficies escuchan en `0.0.0.0` **hacia internet**:

| Puerto | Qué es | Gravedad |
|---|---|---|
| **5432** | `geografo_pg_proxy` — un proxy al Postgres de geografo **en el puerto estándar de Postgres** | 🔴🔴 la peor: es el puerto que todos los escáneres prueban primero |
| **55433** | `goberna_web_dev_db` — **la base compartida de Centurión + deck-form** | 🔴🔴 el core del plano B, expuesto |
| 5434 | `icarus_db` (issue icarus#63, conocido desde julio) | 🔴 |
| 5436 | `cartografia_db` (PostGIS) | 🔴 |
| 5433 | `atlas_goberna_db` | 🔴 |
| 3307 | `goberna_cert_db` (MySQL de certificaciones) | 🔴 |
| 4010 / 4030 | `leads_crm_api` + bot — **en los DOS VPS** | 🟠 |
| 4040 / 7020 | `goberna_escuela` backend/frontend — **en los DOS VPS** | 🟠 |
| 3900 | `nexus_sms` | 🟠 |
| 18096 / 18098 | plane-mm-bridge · uptime-kuma (VPS2) | 🟡 |

**Acción futura, cuando el dueño lo descongele**: la cadena `DOCKER-USER` de iptables **ya existe en
VPS1 con whitelist por subred** — se extiende esa misma política puerto por puerto, **con la IP del
dev que lo usa en la whitelist** (dato que sale del censo), se aplica de a una regla, y se verifica
el servicio después. Lo que necesite acceso remoto permanente va por **tailnet**, como ya hacen
meta-escuela e ivi_server. Nunca se toca el mail de nexus-mail (25/465/587/993/995 son legítimos).
Agentes: `devops-engineer` ejecuta, `security-auditor` verifica **desde afuera** (un escaneo desde
el propio VPS no prueba nada).

### 2.2 🟠 Disco de VPS2 (misma semana): recuperar ~80–100G sin matar nada

1. `/backup` **199G** → política de retención de HestiaCP (hoy parece acumular sin techo): quedarse
   con 2–3 por dominio; los viejos, a un tarball frío (VPS1 tiene 391G libres — `/srv/backups` de
   VPS1 ya cumple ese rol) o borrar. Solo esto baja el disco del 81% a ~45%.
2. Build cache de Docker 12G + imágenes colgantes 5G → `docker builder prune` + `image prune`
   (sin `-a` la primera vez).
3. `gh-runner` 25G → limpiar `_work` de runners de repos que ya no despliegan seguido.
**Prohibido**: `docker system prune -a` a ciegas (tira imágenes de servicios parados que quizá son
producción dormida), y tocar `/backup` sin listar primero qué dominios cubre cada archivo.

### 2.3 El censo — condensar sin romper (2–3 semanas, de fondo)

La regla: **nada muere sin censo, y el censo es read-only.** Cada servicio de los ~128 (80+48)
recibe una fila: `nombre · VPS · qué es · dominio DNS · último tráfico (logs nginx 30d) · dueño ·
veredicto`. Los veredictos posibles: **queda · se muda · se archiva (ADR + tarball) · se apaga**.

Candidatos ya visibles (el censo los confirma, no los ejecuta):

| Candidato | Evidencia | Veredicto probable |
|---|---|---|
| **Stacks duplicados en ambos VPS**: `goberna_escuela`, `leads_crm`, `nexus_backend`+`postgres`, `nexus_mail_api` | `docker ps` de los dos lados | El DNS decide cuál es prod; el otro se archiva. Que el LMS de la Escuela corra duplicado es además un riesgo de datos divergentes |
| `meta_partnert_*` (3 contenedores) | ECOSISTEMA lo declaró «referencia de diseño, consolidado en Centurión» hace un mes | Archivar con ADR (la decisión ya está tomada, falta ejecutarla) |
| `goberna_crm_*` (api+db+redis) | Hermes lo reemplazó | Archivar con ADR |
| `maquina_electoral_*` (4 contenedores) | Extraído a goberna-territorio | Censar datos vivos → archivar |
| ~~`goberna_bot` / bot-wspp~~ | ✅ **HECHO el 28-jul — es el caso 1 y el molde del censo.** Era Baileys con un tenant de cliente (`tejada`) y una tormenta de 7.716 reconexiones/día por la misma IP que las tres líneas de venta | **Archivado y detenido** — [ADR 0026](adr/0026-retiro-del-bot-de-baileys.md) |
| `leads_crm_*` (VPS1 **y** VPS2, 8.4G en /srv) | CRM viejo, expuesto en 0.0.0.0 | Censar → archivar |
| `jeri_wp`, `atlas_sanchez`, `power-ppt`, `n8n`, decks varios | Proyectos puntuales | Censar tráfico 30d |
| ~40 previews `*.preview.goberna.club` (VPS2) | `estudiodyl` solo pesa 5.3G | Los sin tráfico en 60d → tarball frío |
| **Dos sistemas de mail**: `nexus-mail` (stack completo en VPS1) y el mail de HestiaCP en VPS2 (`mail.goberna.us`) | puertos 25/465/587 abiertos en VPS1 | Decisión del dueño: uno solo. Dos mail servers = dos reputaciones IP que cuidar |
| **24 runners** (14+10), un servicio systemd por repo | `systemctl` de los dos lados | Consolidar en **runners de organización** con labels (self-hosted org-level es gratis): 24 servicios → 2–4. Menos RAM, un solo lugar que actualizar |

Agentes para el censo: `Explore` por lotes de contenedores (read-only, con la prohibición de no
tocar nada), `devops-engineer` arma la tabla, y **la kill-list la firma el dueño** — ningún agente
apaga nada. Cada apagado: tarball + ADR + DNS fuera + regla de firewall, en ese orden, y `curl` a
los servicios vecinos después.

### 2.4 El principio de condensación (para no volver a esto en seis meses)

- **VPS1 = producción de Goberna** (escuela + electoral + geo). **VPS2 = mail/chat + sitios de
  clientes + Cerberus.** Lo que no encaja en esa frase, no se despliega ahí.
- **Regla del alta**: ningún servicio nuevo sin (1) fila en el censo, (2) puerto en 127.0.0.1 o
  tailnet salvo decisión escrita, (3) runner de org, no runner propio.
- **geografo queda fuera de los dos**: es la caja de IA (tailnet), y el `geografo_pg_proxy`
  expuesto en VPS1 es exactamente lo que no puede volver a pasar.

---

## 3. Secuencia global (las tres pistas en paralelo real)

| Semana | Pista Escuela | Pista Servidores | Pista decisiones |
|---|---|---|---|
| **28 jul – 3 ago** | E0 entera (deploy ceberusapp, #106, #185, #202, checklist 3-ago) | Emergencias §2.1 + disco §2.2 | — |
| 4 – 10 ago | E1 (perímetro) + arranque E2 (fan-out, #180) | Censo arranca (read-only) | Las 6 de `dos-planos.md` §11, una por conversación |
| 11 – 24 ago | E2 cierra + E3 (eventos/matrícula) | Kill-list firmada; primeros archivados con ADR | Gate de generalización definido |
| 25 ago – 7 sep | E4 (Ivi en prod de verdad) + E5 (Studio→catálogo→lazo) | Runners de org; mail unificado | — |
| Después | E6 (dashboard al contrato) → **recién acá empieza el plano B** | Régimen permanente §2.4 | — |

Las tres pistas son paralelizables porque no comparten cuello: Escuela es código tuyo, Servidores
es censo+firewall (agentes read-only + fixes chicos), y las decisiones son conversaciones.

## 4. Qué NO entra en este plan

- Nada del plano B (Centurión/candidatos) salvo tapar el agujero del `55433` — la decisión de foco
  es explícita y este documento la respeta.
- Nada de IA nueva en Hermes antes de E4 (la regla del dueño del 27-jul: primero estructura,
  después potenciador).
- Ningún rediseño de Cerberus: fixes mínimos + contrato incremental. Cerberus se **rodea de
  contrato**, no se reescribe.
- Ningún apagado de servidor sin censo, ADR y tarball. La prisa acá es cómo se pierde una base
  que nadie sabía que era producción.

---

*Fuentes: `gh issue list` / `gh pr list` / `gh api` sobre Goberna-Lab/{hermes,ceberusapp,goberna-dashboard} y SSH read-only a VPS1 (`deploy@161.132.39.165`) y VPS2 (`root@75.119.138.200`), todo el 2026-07-27. Los planos y sus invariantes: [`dos-planos.md`](dos-planos.md). La foto de integración: [`sistemas-goberna.md`](sistemas-goberna.md).*
