# Rediseño integral de meta-escuela — 01: Auditoría consolidada

**Fecha:** 2026-07-16 · **Fuente:** 10 auditorías paralelas (código, app viva con screenshots desktop 1440×900 y mobile 390×844, datos en vivo por curl/SQL, rendimiento y robustez) fusionadas por el editor.
**Documentos hermanos:** `2026-07-16-rediseno-00-inventario-datos.md` (inventario del modelo de datos) · `2026-07-16-rediseno-02-benchmark.md`.

**Método de consolidación:** los hallazgos repetidos entre auditores se fusionaron en un único hallazgo con TODAS sus evidencias (el mismo problema visto desde el código y desde el screenshot es un hallazgo más fuerte, no dos). Cada hallazgo tiene un ID `#N` estable que usan todas las secciones y la tabla maestra (§8). La prioridad de un hallazgo fusionado es la más alta que le asignó cualquier auditor. Este documento **no propone soluciones de rediseño**: los "quick wins" (§6) son arreglos puntuales que los propios auditores identificaron como obvios y de bajo riesgo, y los "problemas estructurales" (§7) describen el problema, no el diseño de su solución.

---

## 1. Resumen ejecutivo

**Qué es el sistema.** meta-escuela es el dashboard de BI comercial y plataforma de gestión de Meta Ads del negocio educativo de Goberna (escuela de formación política, 6 países LATAM, captación casi 100% por Meta Ads). Cubre: el embudo completo del negocio en la home (ENTRA → CONVERSA → LEAD → COMPRA → META), el maestro/comparador/detalle de pautas sobre snapshots de Postgres, el feed de decisiones ordenado por plata en juego, la bandeja conversacional de 3 canales, la bandeja de leads de formulario, la persona 360 sobre un grafo de identidad, el análisis comercial/cartera, el Reloj de Tesorería, y el lazo CAPI que reporta ventas confirmadas a Meta — la misión que justifica el proyecto ("Goberna paga por traer gente y nunca le dice a Meta quién compró"). Corre 100% local en la laptop del operador: front React 19/Vite en `:5173`, API Express/Drizzle en `:4100`, Postgres 17 en Docker `:5434`; datos de Cerberus por dump SQL manual, datos de Meta por relojes de recolección cada 6 h.

**Estado general.** El sistema tiene una columna vertebral inusualmente buena: un modelo de datos maduro (capa canónica con USD/estado/país resueltos una vez, grafo de identidad reversible, lazo CAPI con fracasos contables, 37 meses de serie diaria de Meta ya en la base), una arquitectura de lectura correcta (BFF de una llamada solo-Postgres, "ninguna pantalla llama a Meta"), y una ética de honestidad del dato (null ≠ 0, recolecta limpia, vacíos que explican su causa) que casi ningún BI interno tiene. **Pero la capa de presentación y las costuras traicionan esa base exactamente donde se decide plata**: la superficie miente sobre frescura, mezcla monedas y ventanas temporales, sirve datos que su propio backend declara prohibidos, y ante cualquier fallo se pinta de verde. El producto además está partido en dos generaciones visuales y dos jerarquías paralelas de pauta, y en mobile es inutilizable.

**Los 5 problemas que más duelen:**

1. **La honestidad prometida está rota en la superficie, hoy, con datos vivos.** La home reporta "pauta ok · hace 7 h" cuando esa corrida trajo 0 campañas y 26 cuentas caídas y lo servido tiene 26 h (#2); 7 de las últimas 10 recolectas fallaron y ninguna pantalla lo dice (#3); la serie histórica grafica snapshots rotos que la propia regla de "recolecta limpia" prohíbe servir (#6). Es exactamente la clase de bug que ya produjo el incidente "Bolivia ROAS 10,08× · subí presupuesto" documentado en el código.
2. **Dos jerarquías paralelas para la misma campaña** — `/campanas/:id` lee Meta en vivo, `/pauta-maestro/:id` lee el snapshot — con números distintos verificados en pantalla (111 BOB vs 120,37 para la misma campaña y el mismo período), sin puente, sin aviso de fuente, y con las puertas de entrada repartidas sin criterio (#1).
3. **Aritmética entre monedas distintas en todo el módulo de pauta**: el score, el ranking, el orden por gasto, los heatmaps y los ejes comparan BOB contra USD como si fueran la misma unidad; una campaña boliviana de ~US$190 aparece "gastando" más que una peruana de US$895 (#8). Las tasas de cambio ya existen en el server y no se aplican.
4. **Controles que no controlan y fuentes de verdad duplicadas**: los botones de rango del maestro no cambian ningún número ("Hoy" muestra gasto de 90 días, #5); 4 de los 5 rangos del picker de la home degradan media pantalla con un copy falso (#4); y la tuerca de configuración escribe las cuentas en un localStorage que el job de análisis no lee (#9).
5. **Ante el fallo, el sistema afirma que todo está bien**: un 500 del server se renderiza como "la pauta está sana" en el feed de decisiones (#10) y como "No hay vouchers esperando" en Tesorería — la pantalla que recupera plata y que ya estuvo meses muda por una consulta rota (#14). Solo 1 de 14 páginas maneja `isError`; no existe ningún ErrorBoundary (#50).

Mención aparte: el CRM está a medio construir (leads sin ciclo de vida — 680/680 "sin contactar" para siempre, solo 200 alcanzables desde la UI, #34/#45), la ingesta de leads lleva muerta desde el 19-may sin que ningún endpoint lo registre (#16), y en mobile todas las rutas tienen min-width ~484–542 px sobre un viewport de 390: las columnas de plata quedan literalmente fuera de la pantalla (#18).

**Volumen de hallazgos (deduplicados):** 146 hallazgos únicos — 18 P0, 56 P1, 51 P2, 21 P3 — más ~30 fortalezas a preservar. La tabla maestra completa está en §8.

---

## 2. Contexto: usuarios, decisiones ya tomadas y restricciones

El rediseño no parte de cero: hay decisiones de producto ya tomadas (varias con incidentes reales detrás) y restricciones físicas/legales del mundo que ningún rediseño puede pisar a ciegas. Fuentes: docs/00-OVERVIEW, docs/01-MUNDO, docs/04-REALITY-GAPS, docs/07/08/10/12/13, PROYECTO-CONSOLIDADO, specs 2026-07-11/12/13/15, SESIÓN-PAUTAS-2026-07-15, en.md, CLAUDE.md.

### 2.1 Usuarios (personas)

| Persona | Qué necesita | Pantalla(s) |
|---|---|---|
| **El Pauteador** | Opera varias veces al día; velocidad para pausar, mover presupuesto, duplicar entre cuentas/países, subir creativos | Feed de decisiones, maestro, estructura |
| **El Estratega ("Alan")** | Entra 1-2 veces/semana; que le señalen QUÉ está mal sin operar ni buscar; entender en <10 s qué gana, qué pierde y por qué | /pauta-comparar, feed |
| **El Comercial / Ventas** | Dueño de LEAD y COMPRA: formularios sin contactar, costo por lead, ventas por país | /leads |
| **El Community Manager** | Dueño de CONVERSA: bandeja de 3 canales, cuántos esperan, cuánta ventana queda. OJO: RG-002 ("existe flujo de community manager") sigue UNKNOWN — nadie lo observó | /bandeja, /canal/:red |
| **Tesorería** | Confirma vouchers a mano. Dato corregido: su p90 real es **4 días, no 10**; el problema concentrado es "Tran Banco BCP Bolivia (Escuela)" con mediana de 30 días | /tesoreria |
| **Dirección** | COMPRA y META: ventas por país en USD, ROAS real, lo reportado a Meta | Home, /comercial, /cartera |
| **Creativos** | Dueño parcial de ENTRA: miniatura+copy, fatiga, futura /creativos | Home (panel creativos) |
| **Estephano (operador único hoy)** | Corre todo en su laptop, aprueba lotes ("una iteración por aprobación"), toma las decisiones de negocio pendientes (ej. B2) | Todo |

### 2.2 Decisiones ya tomadas (no pisarlas a ciegas)

**Arquitectura de lectura y honestidad:**
- **Snapshot en Postgres, CERO Meta en vivo en el camino de la pantalla** (principio "no negociable"). El reloj recolecta cada 6 h (INSERT acumulativo en pautaSnapshots), la pantalla lee el snapshot y declara su edad. Porqué: la página tardaba minutos consultando 19-24 cuentas y arriesgaba rate limit (error 17 real, 2 veces en una sesión). "Más rápido y más honesto que fingir estar en vivo" (PROYECTO-CONSOLIDADO Parte VIII; SESIÓN-PAUTAS §5).
- **"Recolecta limpia"** = trajo campañas Y cero cuentas caídas; solo esas corridas avanzan `ultimaOk` y alimentan la home. "Una corrida rota no es un dato viejo — es un dato falso, y no se sirve" (commit 9b0bedf). Las corridas rotas se guardan igual como bitácora. Motivo: la home mostró Bolivia ROAS 10,08× (real 4,28×) con recomendación "subí el presupuesto" sobre un snapshot con 26 cuentas caídas (docs/10 §6).
- **Honestidad del dato ausente: null nunca es 0.** Una acción de engagement ausente es null ("0 sería inventar un dato"); fatiga null = "no lo sé", nunca "está sano"; una etapa sin dato dice "sin conectar"/"sin revisar", jamás un cero que parezca hecho (spec home §Pruebas; engagement.ts, fatiga.ts).
- **Comparar "en el tiempo" usa el historial de snapshots de Postgres, NO insights diarios en vivo** — coherente con "no fingir en vivo" (SESIÓN-PAUTAS §5).
- **BFF:** la home lee de `GET /api/overview` — una llamada, solo Postgres; datos nuevos de Meta se agregan al job de pauta, nunca al camino del render (spec home §Arquitectura).

**Seguridad de escritura hacia Meta:**
- **`DECISIONES_MODO=simulacion` es el DEFAULT**: nada se escribe en Meta; `META_TEST_EVENT_CODE` manda todo a Test Events. Ejecución real requiere habilitación humana explícita, confirmación, y guarda el estado anterior (evento `decision_applied` reversible y auditable). Restricción textual del usuario: "respeta las configuraciones actuales de las pautas, no las toques… cuando tengamos algo seguro poder recién impactar" (spec feed 2026-07-11; CLAUDE.md).
- **El lazo CAPI usa la fecha de CONFIRMACIÓN de Tesorería como `event_time`**, nunca la `fecha_pago` autoreportada por el asesor (salvo históricos >30 días, HISTORICO_DIAS). Motivo: 3 eventos salieron con fecha tipeada por un asesor, 2 con pagos rechazables — "Meta ya aprendió que esa persona compró y no hay forma limpia de retractarlo" (docs/10 §3, commit 65e44c6).
- **Dedup propio del lazo:** `yaEnMeta()` filtra lo ya enviado leyendo `conversiones.enviado_at`; apoyarse en el dedup de 48 h de Meta habría mandado 44 Purchase duplicados/día (docs/10 §4, commit 04ac3a7).
- **Audiencias de valor:** se decidió subir TODOS los compradores (4.359) con LTV como value, no solo oro+plata (421). PERO está preparado y NO ejecutado: espera autorización explícita (docs/07).

**Ontología e identidad:**
- Principio rector: **"Este sistema no existe para tener una vista 360 de las personas. Existe para saber quién compró y poder decírselo a Meta."** Sustento: RCT NBER w32765 (70.000+ anunciantes): perder la señal de conversión encarece el cliente incremental 31% (spec Ontología 2026-07-12; docs/01 §6).
- Identidades **FUERTES** (email/teléfono de formulario, lead_id) fusionan solas; **DÉBILES** (psid, ig_user, wa_id, teléfono extraído del texto) nunca fusionan automáticamente; toda fusión es reversible (revocar, no borrar).
- **Tres capas separadas:** Capa 0 bitácora de ingesta (JSON crudo inmutable, explícitamente NO event sourcing), Capa 1 hechos (inmutables, sin opinión), Capa 2 inferencias (versionadas, firmadas, SIN autoridad sobre los hechos).
- **meta-escuela es la FUENTE DE VERDAD** (event store append-only, nada se borra), no un sensor que empuja a otro sistema; Icarus/goberna-crm se conectarán al event store (docs/08).

**Producto y UI:**
- **El home ES el embudo** (ENTRA → CONVERSA → LEAD → COMPRA → META), hub-and-spoke: cinco estaciones, cada una una "puerta" a su pantalla de detalle. "El home es el mapa, no el volcado de datos" (spec 2026-07-12, aprobado, en construcción).
- **El feed de decisiones ordena por PLATA EN JUEGO**, no cronológicamente; muestra solo lo que requiere atención (pantalla vacía = información); un hallazgo sin impacto en plata no aparece. Motivo: la tabla de 409 filas dejó invisible una fuga de presupuesto durante meses (spec 2026-07-11).
- **Bandeja de 3 canales honesta:** tres tarjetas lado a lado (IG solo comentarios públicos hasta App Review; FB privado solo en ventana de 7 días; WhatsApp "sin conectar" con explicación) — los canales no son intercambiables y esconderlo en una cola única mentía (spec home).
- **fuera_de_ventana mide NUESTRO atraso de envío**, no la lentitud de Tesorería. El p90 real de Tesorería es 4 días (no 10); 94,3% confirma dentro de la ventana. El cuello era un cron que no existía: 273 ventas / $32.926 USD que Meta nunca vio (docs/10 §1-§2). **Cualquier rediseño de /tesoreria debe partir de esta corrección.**
- **Rediseño de /pauta-comparar (2026-07-16):** DOS pestañas Campañas/Creativos con estado en URL (`?vista=`), pivote a nivel-anuncio con n=1; RadarCampanas ELIMINADO (pentágono plano engañoso); 9 clusters de redundancia borrados. Principio goberna-design-system: "simple, bajo cargo cognitivo, sin redundancia — cuando dudes, sacá".
- **Paleta de gráficos centralizada** (chartPalette.ts: azul/teal/magenta/oliva/marrón), validada con dataviz `--pairs all` (el violeta falló: ΔE 12,4); `colorForId` asigna color por posición ESTABLE — una campaña no cambia de color al filtrar.
- **Flujos separados:** "operar campañas en vivo" (/campanas/:id) vs "ver snapshot" (/pauta-maestro/:id); /campanas/:id no se borró porque lo usan otras pantallas de operación (SESIÓN-PAUTAS §4). *(La auditoría encontró que esta separación, sin puente ni etiquetas de fuente, es hoy el P0 #1.)*
- **El "curso" se deduce del nombre de campaña con heurística ORDENADA**: seminario → consultoría → consultor → dipcpol|diplomado → libros → Otro. "Consultor" == "Consultor Político" (indicación directa del usuario); consultor va ANTES que diplomado (server/src/pauta/curso.ts, SESIÓN-PAUTAS §1).
- **Fatiga de creativo** = frecuencia SUBE y CTR BAJA simultáneamente (nunca una sola), ≥14 días, umbral mínimo (+10% freq, −15% CTR rel.) — sin umbral daba ~25% de falsos positivos. El veredicto siempre lleva su evidencia numérica (fatiga.ts).
- **En Ivi (chat de BI) el LLM NUNCA calcula ni investiga** — el engine determinista produce la evidencia (HECHO/ESTIMACIÓN/SIN_EVIDENCIA), el modelo solo redacta (specs Ivi v2/v3).
- **NO replicar de goberna-dashboard/Cerberus:** flujos de escritura vía Graph API, reconciliación Excel/API, navegación sidebar del ERP, compliance SIEP, fulfillment vía tb_matricula (fuente incompleta: 20/20 ventas "sin matrícula" sí estaban matriculadas) (spec 2026-07-13).
- **Convención de trabajo:** trunk-based, commits directo a main sin PRs (confirmado con el usuario). Todo texto de UI en **español peruano neutro, sin argentinismos** (spec home).

### 2.3 Restricciones (leyes del mundo)

- **Ventanas de Meta:** Messenger 24 h sin `human_agent` (34.118 conversaciones inalcanzables); tag HUMAN_AGENT 7 días — NO otorgado; respuesta privada a comentario: 7 días y 1 solo intento (único canal con volumen usable hoy); `event_time` de CAPI acepta máximo 7 días hacia atrás; retención de audiencias: Página/IG 730 días, Lead Ads 90, Likes 0 (docs/01 §5).
- **Permisos de Meta faltantes:** `leads_retrieval`, `pages_read_user_content`, `pages_manage_metadata`, `human_agent`, `page_events`; App Review no hecho (bloquea DMs de IG). Bloquean la Fase 1 completa, la bandeja de Messenger y CAPI Business Messaging (docs/08).
- **Identidad fragmentada e irrecuperable:** NO hay clave común entre canales; comentarios FB ~99% anónimos; el ad_id de Messenger jamás se recupera (solo llega por webhook en el momento); el único puente real es el 23,7% de interacciones con teléfono escrito en el texto (docs/01 §3).
- **Frontera legal:** leads de formulario permitido; gente que escribió por Messenger defendible; comentaristas y reaccionantes PROHIBIDO perfilarlos. Ley 29733 (Perú) y equivalentes, Custom Audience Terms, derecho de baja (docs/01 §5, docs/07).
- **WhatsApp** — donde se cierra el 61% de las ventas y va el 77% de la inversión — corre por Baileys (no oficial, prohibido para clientes por política org 2026-07-03); no mide nada hasta migrar a Cloud API; la atribución ctwa_clid depende de esa migración.
- **Física del negocio:** ventas se confirman a MANO (voucher → Tesorería); Cerberus marca "vendido" solo cuando se pagan TODAS las cuotas; compra de alta consideración mediada por conversación humana.
- **Infraestructura:** corre LOCAL (front :5173, API :4100, Postgres :5434), sin deploy ni CI/CD; datos por dump SQL de Cerberus (VPS2 :8001) + webhook que hoy no llega a la laptop (0 recibidos).
- **Rate limit de Meta es real** (error 17 documentado 2 veces en una sesión): detectores y pantallas corren sobre snapshots, nunca una llamada por regla; recolecta con CUENTAS_EN_PARALELO=4; Custom Audiences NO cruzan de cuenta/país.
- **Esquema vía `drizzle-kit push`, SIN migraciones SQL versionadas;** el `schemaFilter` debe incluir `fuentes` y `ontologia` o esos esquemas no se crean, en silencio. Secretos solo en `server/.env`.
- **Testing asimétrico:** server con 141 tests puros (sin DB); frontend SIN script de test. Las zonas sin tests (`canales/`, `routes/`) son exactamente donde vivieron los 8 bugs de la auditoría previa (docs/06, docs/12).
- **Interruptores que no se cambian sin decisión humana:** `DECISIONES_MODO`, `META_TEST_EVENT_CODE`, `PAUTA_RELOJ`, `LAZO_RELOJ`.
- **Solo hay 5 meses de datos de confirmación** (`fecha_confirmacion` existe desde 2026-02); 5.239 pagos válidos no la tienen — ninguna métrica de latencia previa a feb-2026 tiene datos que la sostengan (docs/10 §1).
- **Datos de partida:** 24 cuentas publicitarias, 12.100 anuncios, 5.134 ventas (4.729 pagadas), 5.657 clientes, 94.371 interacciones, 680 leads, 7 monedas, 6 países LATAM.

### 2.4 Deuda ya conocida y pendientes de aprobación (no re-descubrir)

Estos ítems ya están diagnosticados y esperan el OK de Estephano; la auditoría los cita cuando se solapan con hallazgos nuevos pero NO los re-reporta como descubrimientos:

- **Lote A (URGENTE):** el webhook de Cerberus (`webhook/ruta.ts:143`) dispara Purchase REALES sin compuerta de simulación y sin `yaEnMeta()`. Hoy inofensivo (0 webhooks en la historia) pero hay 126 ventas en cuotas activas: cada cuota confirmada reenviaría el monto TOTAL. Arreglar ANTES de conectar Cerberus (docs/13).
- **Lote B (bugs vivos verificados, docs/12):** V1 país del lazo NULL desde siempre (`ontologia/ventas.ts:139` joinea `codigo_pais` que existe en 0/4.752 clientes; es `id_pais`); V2 `tb_pago.estado=1` "Procesando" contado como cobrado en /cartera (~$4.205) — requiere DECISIÓN DE NEGOCIO; V3 venta MXN pagada con USD $2.800 convertida como MXN (~$163); V4 `radio_divisor` de BOB podrido en Cerberus (BOB ~36% mal si se usa el divisor).
- **Lote C (endurecimientos, docs/12 L1-L8):** ingesta marca `ultimaOk` con dump vacío y salud no lee `ultimo_error`; `metaClient.getAll` no chequea `res.ok` en páginas 2+; `geoGasto` descarta mudo monedas sin tasa; `costoPorLead` omite campañas rate-limiteadas sin reportar; casts `::timestamptz` sin nullif; `verdad.ts` con TRES definiciones de "ventana abierta"; el lazo marca el lote como enviado sin comparar `events_received`.
- **Patrón raíz diagnosticado 3 veces:** "una regla correcta declarada en un comentario, y código que no la aplica" — 8 bugs en 2 días. Causa: `canales/` y `routes/` tienen UN test entre los dos y ahí vive todo el I/O.
- **Datos rancios operativos (estado al 16/07):** ingesta de interacciones parada 5 días (última 11/07); dump de Cerberus del 13/07; token de Meta expuesto en un transcript, **ROTADO el 2026-07-19 (RESUELTO)**; WIP de la sesión anterior sin commitear.
- **Pendientes de Pauta Comparar (en.md, Parte X):** stacked bars por país/objetivo, persistencia de selección entre sesiones, repurpose de Leaderboard.onSelect; engagement NO retroactivo (snapshots viejos muestran "—"); "alcance" no viene en el snapshot histórico.
- **Ivi:** vivo, pero lee BFF de pantalla con num_ctx 8k, no consume `governa.pauta.serie`, y su narrativa de "273 fuera de ventana" es la interpretación vieja que docs/10 §2 corrigió.
- **Diseñado sin implementar:** Ivi v3.0 (motor causal), pipeline CKF, CQ Engine (DO-001..DO-008 abiertas), olas 2-4 del roadmap Cerberus.
- **Menores anotados (docs/12):** `daily_budget/100` también en monedas sin decimales (CLP/COP 100× chicos); dos `aUsd` con contratos distintos; `webhook/firma.ts` (HMAC) código muerto; LIMIT 1 sin ORDER BY para email/teléfono del lazo; etiquetas de rango del maestro engañosas.
- **Deuda de repo:** frontend sin script test; doble lockfile; sin migraciones versionadas; sin CI/CD ni deploy.

---

## 3. Fortalezas

Lo que el rediseño debe **preservar** (y en varios casos, extender como patrón al resto del producto). Deduplicado de los 10 auditores:

**Arquitectura de lectura y honestidad del dato**

- **F1 — BFF de una sola llamada, solo Postgres, rápido.** Toda la home sale de `GET /api/overview` (87 KB en ~0,09 s medidos); la regla "ninguna pantalla llama a Meta" está escrita y (casi siempre, ver #91) cumplida. Reemplazó 4 llamadas, una de 2-4 min. *Evidencia: server/src/routes/overview.ts:21-44,66-101; curl /api/overview?rango=90d = 87.292 bytes / 0,094 s.*
- **F2 — "No medible ≠ cero" aplicado con disciplina en toda la plata.** ROAS null sin gasto, LTV null sin tasa (con conteo de compras no medibles), campañas sin tasa excluidas de totales y contadas en `sinTasa`; vacíos honestos ("Sin revisar" en helado, nunca un 0 que parezca logro). *Evidencia: server/src/analisis/roasPais.ts:14-16; server/src/canales/persona360.ts:145-154; server/src/routes/costoPorLead.ts:110-115; server/src/pauta/snapshot.ts:75-91; src/features/home/FichaEstado.tsx:43-44,66-70.*
- **F3 — Regla de "recolecta limpia" con el incidente documentado en el código.** Solo corridas limpias alimentan el último estado; las rotas quedan como bitácora; la regla existe en SQL y TS como espejo, con el postmortem de Bolivia 10,08× escrito en el archivo. *Evidencia: server/src/pauta/snapshot.ts:76-111,87-110.*
- **F4 — Ventana de ROAS anclada al snapshot, no a now():** un snapshot viejo no divide ventas de esta semana por gasto de otra. *Evidencia: server/src/sdk/herramientas/atribucion.ts:20-24,79-82.*
- **F5 — Honestidad estadística declarada:** la latencia de Tesorería declara su censura (5.239 pagos sin fecha invisibles al percentil, "el p90 real solo puede ser peor"); "la plata está en dólares con la tasa congelada de cada venta"; el mes en curso pintado gris. *Evidencia: server/src/analisis/comercial.ts:121-146; src/pages/ComercialPage.tsx:130-142; comercial-desktop-full.png; cartera-desktop-full.png.*

**Modelo de datos y backend**

- **F6 — Capa canónica con la semántica difícil resuelta UNA vez** (USD con tasa congelada, estadoSemantico, país del cliente, latencia), rebuild transaccional todo-o-nada. *Evidencia: server/src/db/canonico.ts:4-21; server/src/ontologia/proyectar.ts:250-260.*
- **F7 — 37 meses de serie diaria de Meta ya backfilleados e idempotentes:** pauta_serie con 96.131 filas (2023-06-18→2026-07-15, 3 niveles, UNIQUE(nivel,entidad,fecha)); backfill con troceo medido contra la API real, upsert idempotente, cuentas deshabilitadas con historia incluidas, huecos declarados. Es el activo de datos más valioso del repo (hoy sin consumidores de UI, ver #7). *Evidencia: server/src/db/operacion.ts:180-223; server/src/pauta/backfill.ts:44-264; server/src/pauta/ventanas.ts:1-104; query en vivo.*
- **F8 — Grafo de identidad des-fusionable con evidencia por arista:** regla fuerte/débil, evidencia jsonb, actor, confianza, revocación (unmerge = revocar); claveRaiz determinista → /gente/:id sobrevive rebuilds; claves vetadas contra el Frankenstein del correo compartido. *Evidencia: server/src/db/ontologia.ts:85-169; server/src/ontologia/poblarIdentidad.ts:13-19,71-86,141-155.*
- **F9 — El lazo CAPI hace contable el fracaso:** `conversiones.descarte` clasifica por qué una venta NO se mandó; 107 enviadas / 273 perdidas por ventana visibles en vivo; dedup determinista por event_id. *Evidencia: server/src/db/ontologia.ts:203-255; curl /api/overview/lazo.*
- **F10 — Recolección eficiente y tolerante a fallos:** 5 llamadas por cuenta en vez de 866 secuenciales, paginación completa, concurrencia acotada, errores por cuenta registrados. *Evidencia: server/src/pauta/recolectar.ts:6-25,186-207.*
- **F11 — SDK autodescriptivo separado del BFF:** 10 Herramientas con Zod→JSON Schema, Resultado discriminado que nunca lanza, "la Tool declara lógica que ya existe, no la implementa". *Evidencia: server/src/sdk/registro.ts:50-115; curl /api/sdk/catalogo.*
- **F12 — Cobranza que excluye ventas anuladas/reembolsadas** (mató un bug de $34.599 falsos) y agrupa deudores por cliente real. *Evidencia: server/src/analisis/cartera.ts:39-63,91-108.*
- **F13 — Detección de fatiga con doble condición material y evidencia numérica** (freq ≥+10% Y CTR ≤−15%, piso 14 días, null = "no lo sé"), con tests. *Evidencia: server/src/pauta/fatiga.ts:24-103.*

**Producto / BI**

- **F14 — ROAS por país con copiloto explicable:** veredicto, evidencia con tono, recomendación, "qué pasa si" y riesgos de un motor determinista; ordenado por plata en juego; ROAS global sin ventas orgánicas en el numerador. El mejor patrón BI del producto. *Evidencia: src/features/home/RoasPorPais.tsx:44-115; server/src/analisis/roasPais.ts:69.*
- **F15 — Motor de decisiones en lenguaje de plata con guardrail visible:** tarjetas con problema + cifras + campaña + acción propuesta visible antes de apretar; chip "Simulación — nada se escribe en Meta" siempre a la vista; conversión a USD para ordenar/sumar con exclusión explícita de lo inconvertible. *Evidencia: src/features/decisions/DecisionCard.tsx:100-165; server/src/decisions/detectors.ts:290-306; src/features/decisions/DecisionFeed.tsx:44-50; campanas-desktop-full.png.*
- **F16 — Simulación como default duro decidido en el server**, no en un botón: `DECISIONES_MODO=ejecucion` solo por variable de entorno; en ejecución solo "pausar" (la acción reversible) está implementado a propósito. *Evidencia: server/src/routes/decisions.ts:21,130-138; src/features/config/ConfiguracionPanel.tsx:131-149.*
- **F17 — La estructura de 3 niveles responde "dónde se gasta" de un vistazo** (share con barra, eficiencia relativa, banner de fuga, warning sin-exclusiones inline; todo se crea PAUSED). *Evidencia: src/features/campaigns/StructureTree.tsx:199-258; server/src/routes/campaigns.ts:249-252; server/src/routes/ads.ts:89-95.*
- **F18 — Reloj de Tesorería con jerarquía de urgencia correcta:** dos colas separadas (salvables por horas restantes, perdidas por antigüedad) con el razonamiento documentado; KPIs + anotación roja "7 días — Meta deja de aceptar". *Evidencia: src/features/tesoreria/RelojTesoreria.tsx:93-100,156-182; tesoreria-desktop-full.png.*
- **F19 — El riel del home hace estado + navegación + relato en una banda:** 5 estaciones ancladas (#panel-*), cada panel con CTA a su pantalla; la home responde "qué está pasando" sin scroll y en 1 salto. *Evidencia: src/features/home/FlujoEmbudo.tsx:160,229; src/pages/HomePage.tsx:93-177; snapshot page-2026-07-16T20-54-29.*
- **F20 — Bandeja conversacional madura:** orden por urgencia real de la ventana (lo más viejo dentro de ventana arriba), modelo de capacidades honesto ANTES de escribir (ahorra 14.437 llamadas), privado PRIMERO y abortar el público si falla (aprendido de incidente real), estado "respondida" persistido en el servidor. *Evidencia: server/src/routes/interactions.ts:39-43; server/src/routes/persona.ts:86-158; server/src/routes/responder.ts:100-130; src/features/canales/useInteracciones.ts:80-87.*
- **F21 — Persona 360 con LTV honesto e inferencias accionables** ("semilla de lookalike", "dormido", "se arrepintió"); contact merge parcial que declara el límite cuando Meta oculta la identidad. *Evidencia: server/src/canales/persona360.ts:143-183; src/pages/GentePage.tsx:112-126; src/features/canales/HistorialPersona.tsx:33-42.*
- **F22 — La temperatura del lead como concepto de negocio** (fresco/tibio/frío/helado) reutilizada coherentemente en leads, tesorería, riel y embudo. *Evidencia: src/features/leads/temperature.ts:1-25; src/index.css:50-67.*
- **F23 — Estados vacíos honestos con causa:** 4 estados en la card de decisiones (sin cuentas / nunca revisado / sana con edad / plata mal puesta); canales bloqueados explicados; 404 de persona con salida; "no hay vouchers (o no se sincronizó Cerberus — que no es lo mismo)". *Evidencia: src/features/decisions/DecisionesPendientesCard.tsx:22-127,39-77; src/pages/CanalPage.tsx:129-162; src/pages/GentePage.tsx:226-229; src/pages/PautaDetallePage.tsx:80-87.*
- **F24 — Lenguaje de negocio legible para dirección** ("cada voucher tardío es una venta que Meta nunca ve"); naming con voz propia. *Evidencia: src/pages/ComercialPage.tsx:120-128; src/pages/CarteraPage.tsx:213-216.*

**Sistema visual y front**

- **F25 — Tokens de marca centralizados con semántica propia** (navy #0E2A52, primary #2563EB, gold #FFC800/#CAA106, rampa temperatura documentada; el dorado como señal escasa). *Evidencia: src/index.css:10-67.*
- **F26 — Paleta de charts validada y reglas dataviz correctas escritas en el código:** 5 categóricos validados CVD (violeta descartado por ΔE 12,4), color por posición estable, tonos de estado fuera de la paleta de series; en toda la app no hay una sola torta ni un dual-axis; formas de gráfico correctas en casi todos (4 Recharts + 12 artesanales); FlujoEmbudo documenta por qué NO dibuja un embudo con ventanas incomparables. *Evidencia: src/features/pautaMaestro/chartPalette.ts:14-51; src/features/home/VentasPorPais.tsx:9-14; grep recharts → 4 archivos.*
- **F27 — Montserrat self-hosted con tres voces tipográficas** (heading/sans/mono como "voz instrumento"). *Evidencia: src/App.tsx:1-5; src/index.css:111-115.*
- **F28 — Capa de datos react-query bien diseñada (donde se usa):** QueryClient único (staleTime 30 s, gcTime 5 min, retry 1), claves centralizadas, wrapper api() con ErrorApi tipado, mutación optimista con rollback de libro, useInfiniteQuery en tandas de 30 sobre 94.371 interacciones, tablas paginadas. *Evidencia: src/lib/datos/cliente.ts:27-44,88-97; src/lib/datos/overview.ts:186-226; src/features/canales/useInteracciones.ts:42-59; src/features/pautaMaestro/PautaMaestroTable.tsx:112.*
- **F29 — useLocalStorage con useSyncExternalStore compartido** (una fuente por clave, sync entre componentes y pestañas). *Evidencia: src/lib/useLocalStorage.ts:20-107.*
- **F30 — Detalles de accesibilidad y patrones correctos dispersos:** filas interactivas como `<button>` reales, Escape cierra paneles, Volver como componente único en 11 de 14 páginas, config que se abre desde el punto del problema, PautaDetallePage con estado en URL (`?rango=`) como patrón de referencia, pivote inteligente del comparador con n=1, wizard con defaults seguros (todo PAUSED). *Evidencia: src/features/canales/FilaInteraccion.tsx:50-57; src/layout/Volver.tsx:5-8; src/layout/ConfigContext.tsx:4-11; src/pages/PautaDetallePage.tsx:47,103; src/pages/PautaCompararPage.tsx:83-102; campanas-nueva-desktop-full.png.*
- **F31 — El cruce plata→persona existe:** Cartera linkea deudores y top clientes al 360 de /gente/:id (el único puente real entre dominios; demuestra que el grafo funciona como columna de navegación). *Evidencia: src/pages/CarteraPage.tsx:128-136,261-263; scratchpad/cartera-snapshot.md:60-89.*

---

## 4. Debilidades

Hallazgos P1–P3 que no son críticos (§5) ni estructurales (§7). Cada uno conserva las evidencias fusionadas de todos los auditores que lo vieron. Los IDs `#N` son los de la tabla maestra (§8).

### 4.1 Prioridad P1

**#19 · El rango del home vive en localStorage, compartido por 3 pantallas** — Navegación · P1/M
El período que gobierna TODO el home (embudo, ROAS por país, ventana, decisiones) se guarda en `meta-escuela.rango` por navegador: la misma URL muestra 7d a una persona y 90d a otra; un link pegado en el chat de dirección no reproduce lo que vio el emisor. Además Home, CanalPage y DecisionFeed leen/escriben la misma clave: cambiar el rango mirando Instagram cambia en silencio el rango del home y del feed — dominios distintos acoplados por una preferencia que el usuario cree local. Para un dashboard cuyo trabajo es alinear a 5 tipos de usuario, el período es parte del dato, no una preferencia.
*Evidencia: src/pages/HomePage.tsx:41-42 (comentario "qué rango elegiste no le importa a nadie más" — falso para dirección/BI); src/pages/CanalPage.tsx:85; src/features/decisions/DecisionFeed.tsx:18; src/lib/useLocalStorage.*

**#22 · El maestro pierde rango, filtros y búsqueda al volver del detalle** — Navegación · P1/S
Rango en useState de la página; país/curso/búsqueda en estado interno de la tabla. El flujo real "revisar las campañas de Perú una por una" obliga a re-aplicar rango + filtro + búsqueda después de CADA campaña visitada. Con 116 campañas activas es el flujo más castigado del producto. El patrón correcto ya existe en PautaDetallePage (`?rango=`).
*Evidencia: src/pages/PautaMaestroPage.tsx:27; src/features/pautaMaestro/PautaMaestroTable.tsx:87-89; contraste src/pages/PautaDetallePage.tsx:47.*

**#23 · El comparador no persiste la selección: el link compartido llega vacío** — Navegación · P1/S
Lee `?ids=` solo al montar pero `setSeleccionados` nunca escribe de vuelta a la URL; rango y métrica también son locales. Inconsistencia interna: `vista` SÍ va a la URL. Un analista arma una comparación de 5 campañas y no puede compartirla ni recuperarla tras F5 — el caso de uso entero de la pantalla.
*Evidencia: src/pages/PautaCompararPage.tsx:48-57 vs :107-116; :54 (onChange sin setParams).*

**#25 · Los insights del home no drillean: la investigación muere en la card** — Navegación · P1/M
RoasPorPais dice "escalar"/"observar" por país pero el click solo expande in situ — no hay camino a las campañas de ese país. Creativos (top 9) y CostoPorLeadCard nombran anuncios sin link. "¿Qué campaña perdió plata en México?" exige: header Pautas → re-seleccionar rango → filtrar país a mano → adivinar la campaña (4-5 saltos con re-selección en cada nivel).
*Evidencia: src/features/home/RoasPorPais.tsx:146-151 (solo setAbierto); src/features/home/Creativos.tsx:41 (div sin Link); verificado en vivo: los botones de país no navegan.*

**#26 · Tesorería es un callejón sin salida** — Navegación/Tesorería · P1/S
La única pantalla que "recupera plata sin depender de nadie" no tiene Volver (rompe la regla declarada), ningún link interno (ni voucher→persona, ni a la latencia de /comercial que explica la causa), no está en el header, y el folio GOB-XXXXX es texto plano: el operario lo copia a mano a otro sistema.
*Evidencia: src/pages/TesoreriaPage.tsx:9-11; src/features/tesoreria/RelojTesoreria.tsx:249,242-258 (0 imports de Link); app viva /tesoreria (snapshot page-2026-07-16T20-54-49: únicos links = header).*

**#27 · Insights numéricos hardcodeados en el copy: afirmarán datos falsos cuando la realidad cambie** — Home/Comercial/Leads · P1/S
Tres casos del mismo defecto: (a) el panel Sedes afirma en texto estático que "'sin sede' tiene p90 de 64,8 días" — hoy coincide con la data viva, mañana no; (b) VentasPorPais dibuja el marcador fijo tras la 3.ª barra con "95% hasta acá" cuando el top-3 real es **65,3%** de $719.903 (Bolivia sola es #4 con $94.624) — un dato falso impreso dentro del gráfico, y el componente SÍ llega a pantalla (se renderiza cuando roasPais es null, o sea en cualquier rango ≠ 90d, ver #4); (c) LlegadaChart afirma "Ninguna fue contactada" como texto estático no derivado de datos.
*Evidencia: src/pages/ComercialPage.tsx:258-262; src/features/home/VentasPorPais.tsx:68-75 (vivo: top-3 = 65,3%); src/features/leads/LlegadaChart.tsx:49-53.*

**#28 · El nodo "A Meta" está verde mientras se pierde el 72% de las conversiones** — Home · P1/S
Los tonos de COMPRA y A META están hardcodeados en 'fresco' (verde). Con datos vivos, 273 conversiones caen por la ventana de 7 días contra 107 reportadas (72% perdido) y el propio salud() marca el lazo en 'atencion' — pero el riel y la ficha 05 lo pintan verde, con la fuga relegada a una nota gris de 10 px.
*Evidencia: src/features/home/FlujoEmbudo.tsx:110 y src/pages/HomePage.tsx:169 (tono='fresco' fijo) vs server/src/canales/salud.ts:78-84; vivo: lazo.reportadas=107, perdidasPorVentana=273.*

**#30 · Piezas en 'atencion' desaparecen de la Barra de Mando; el sello usa la pieza MÁS fresca** — Home · P1/S
La barra solo muestra 'ok' (FLUYE) y 'falta' (FALTA): hoy Cerberus (4 días viejo), interacciones (5 días) y el lazo (atención) no aparecen en ninguna línea. Los puntos fb/ig se pintan llenos con estado !== 'falta' (un feed muerto hace 5 días se ve igual que uno vivo). Y el "HACE 7 H" de la esquina es `Math.min` de las edades: la sincronización más nueva enmascara a las viejas.
*Evidencia: src/features/home/BarraDeMando.tsx:74-77,80-82,84-85,121-122; vivo: /api/overview/salud → cerberus y meta_ingesta en 'atencion', barra muestra solo "FLUYE pauta · FALTA WhatsApp".*

**#31 · La cola del ROAS no es expandible y esconde al 4.º país por gasto** — Home · P1/S
"+ 21 países más" es un `<p>` muerto. Bolivia — $1.642 de gasto (10% del total), acción "escalar" con confianza alta — queda en el índice 13 por el orden de oportunidad y es invisible desde la home.
*Evidencia: src/features/home/RoasPorPais.tsx:117-119,182-186; vivo: Bolivia idx 13, gasto $1.642 de $16.662.*

**#32 · El panel COMPRA/ROAS no muestra la edad del gasto** — Home · P1/S
`atribucionPorPais` devuelve revisadoAt/edadMinutos y el route los descarta: el panel de la decisión más cara de la pantalla (escalar/recortar países) no dice que el gasto es de un snapshot de 26 h — justo el dato cuya frescura ya falló históricamente.
*Evidencia: server/src/routes/overview.ts:100-101 (solo atribucion.roasPais); src/features/home/RoasPorPais.tsx:121-141 (sin marca de tiempo).*

**#33 · Series temporales con huecos dibujados como contiguos; el gráfico principal termina 5 días antes sin señal** — Home/Comercial · P1/S
(a) `flujoPorDia` hace GROUP BY sobre filas existentes: días sin interacciones no existen como bucket (el eje se comprime) y, con la ingesta parada desde el 11/07, el gráfico simplemente termina ahí sin marca; la línea de corte de ventana se posiciona por índice de barra asumiendo densidad uniforme. (b) La serie mensual de /comercial tiene un hueco de 2024-08→2025-03 (6 meses sin ventas cobradas) y el chart mapea el array directo a barras adyacentes: el eje del tiempo miente.
*Evidencia: server/src/canales/verdad.ts:245-259 (sin generate_series); src/features/home/FlujoVentana.tsx:122-127,160-168; vivo: flujo[-1].dia=2026-07-11 con hoy=2026-07-16; src/pages/ComercialPage.tsx:69-91; JSON vivo de /api/overview/comercial.*

**#34 · Los leads de formulario no tienen ciclo de vida: "sin contactar" no puede bajar nunca** — CRM · P1/M
`leads.status` tiene default 'nuevo' y NINGÚN código del server lo actualiza jamás (solo lecturas; routes/leads.ts sin PATCH/PUT/POST). La bandeja no ofrece ninguna acción: ni marcar contactado, ni wa.me/tel/mailto pese a tener teléfono y email a la vista. 'convertido' tampoco se setea nunca, aunque el grafo ya vincula lead↔persona↔cliente — la tasa de conversión de leads (la métrica que valida el CPL) es incalculable. Resultado: 680/680 "sin contactar" para siempre, la ficha LEAD en rojo eterno (una alarma siempre encendida deja de ser alarma), el trabajo real de los ejecutivos invisible. Encima `leadColdnessStats` calcula lead_mas_viejo y dias_promedio_frio y el BFF los tira.
*Evidencia: server/src/db/schema.ts:104; server/src/routes/leads.ts:42; src/features/leads/LeadsInbox.tsx:62-112; server/src/routes/overview.ts:120; grep 'convertido' sin UPDATE; vivo: leads {total:680, sinContactar:680}; src/pages/HomePage.tsx:158.*

**#36 · Solo se recolectan campañas ACTIVE: las pausadas/terminadas desaparecen del sistema** — Pautas · P1/M
`recolectar.ts` pide `effective_status=['ACTIVE']`. Verificado en vivo: el maestro solo contiene ACTIVE. Una campaña que quemó presupuesto y fue pausada ayer no existe más en ninguna pantalla; "Mes pasado" jamás mostrará una campaña terminada. "¿Qué campaña perdió plata?" es incontestable por diseño, y el maestro promete "todas las campañas de todas las cuentas". pauta_serie sí guarda la historia a nivel insights; falta la metadata de campañas no activas.
*Evidencia: server/src/pauta/recolectar.ts:50-56; curl: estados=['ACTIVE'] únicamente; promesa en src/pages/PautaMaestroPage.tsx:48-51.*

**#37 · Veredictos "Escalar/Desperdicia" sobre un score relativo al set con umbrales absolutos** — Pautas · P1/M
`norm()` reescala resultados/CPA/CTR contra el min-max de las campañas SELECCIONADAS: con 2 campañas la mejor da ~100 y la otra ~0-30 aunque ambas sean rentables. `veredicto()` aplica cortes fijos (≥75 "Escalar", <50 "Revisar"/"Desperdicia") sobre esa escala relativa: la segunda de dos campañas excelentes recibe "Desperdicia". Agregar o sacar una campaña de la selección cambia el veredicto de las demás. Un gerente que obedece el badge pausa plata buena. Los pesos 45/35/20 viven solo en un comentario.
*Evidencia: src/features/pautaMaestro/analisis.ts:55-57,76-95,85-94,168-176; pesos en :90.*

**#40 · Maestro plano y pobre: sin totales, sin tendencia, sin fatiga, sin Δ, números a la izquierda, orden alfabético** — Pautas · P1/M
7 columnas en tabla plana paginada de a 25, orden default alfabético por país (la campaña que más plata mueve no está primera). Sin fila de totales del filtro activo, sin % del total, sin sparkline (TrendSpark existe en spark.tsx y no se usa), sin conteo de creativos quemados por campaña, sin comparación contra período anterior. El encabezado promete "por país y curso" pero no agrupa: solo ordena. Y Gasto/Resultados/CPR van alineados a la IZQUIERDA (th text-left), impidiendo comparar magnitudes de un vistazo — HeatmapTabla y RelojTesoreria sí alinean a la derecha.
*Evidencia: src/features/pautaMaestro/PautaMaestroTable.tsx:27-77,87,112,165,183 (sin totales); spark.tsx:19-39 sin uso; screenshot maestro.png; pauta-maestro-desktop-full.png.*

**#41 · El detalle de campaña no responde "¿qué hago con esta pauta?"** — Pautas · P1/M
Muestra contexto + 4 tiles + evolución (sobre la serie contaminada, ver #6/#7) + desglose. Sin veredicto/acción (el motor `veredicto()` existe y solo se usa en comparar), sin presupuesto ni fechas, el desglose por anuncio descarta CTR/CPC/CPM/frecuencia/engagement/thumbnail que la API SÍ envía (solo gasto, resultados y badge de fatiga), sin benchmark contra el promedio del curso/país, sin link a Ads Manager. Los públicos se muestran como conteo ("3 incluidos") sin nombres, aunque el server los manda.
*Evidencia: src/pages/PautaDetallePage.tsx:221-263,239-241 vs src/features/pautaMaestro/types.ts:23-48.*

**#44 · `ultimoSnapshot()` sin rango sirve el último snapshot limpio de CUALQUIER rango** — Datos · P1/S
El maestro y /pauta-maestro/:id lo piden sin argumento: si la última recolecta limpia fuera de '7d', el maestro mostraría 7 días de gasto como "todas las pautas" sin ninguna marca. Hoy no explota solo porque todas las corridas son 90d — una bomba de semántica armada en la pantalla donde se compara plata.
*Evidencia: server/src/pauta/snapshot.ts:97-110; server/src/routes/pautaMaestro.ts:238,320,339.*

**#45 · Solo 200 de 680 leads son alcanzables desde la UI, y el hallazgo central está relegado** — CRM · P1/S-M
El cliente pide una sola vez con limit=200 y el server clampa a 200 (aunque soporta offset que el front nunca usa). El header dice "680 personas" pero el botón "Ver más" solo pagina client-side dentro de las 200 descargadas (orden fecha DESC): los 480 leads más viejos —justamente los más fríos— no aparecen nunca salvo por búsqueda. Ventas cree que ve toda la cola y no la ve. Además el dato más grave de la pantalla ("680 leads, ninguno contactado", 58-60 días) está en una nota chica del sidebar en vez de ser el titular.
*Evidencia: src/features/leads/api.ts:15; server/src/routes/leads.ts:80,93; src/features/leads/LeadsInbox.tsx:119-131; curl /api/leads → total 680, leads 200; leads-desktop-full.png.*

**#46 · Éxito parcial reportado como éxito total al responder** — CRM · P1/S
El server devuelve type:'enviado' si CUALQUIERA de los dos mensajes salió (`algoSalioBien = publico || privado`), con los errores del otro adentro. El cliente, ante 'enviado', muestra "Respondido — Ya está publicado en Facebook" e ignora `res.errores`. Si el privado salió pero el público falló (o viceversa), el ejecutivo cree que hizo las dos cosas y la persona quedó a medio atender.
*Evidencia: server/src/routes/responder.ts:142-150; src/features/canales/ResponderPanel.tsx:93-98,169-176.*

**#48 · El reloj de urgencia de la tarjeta Facebook puede mostrar la urgencia de un comentario de Instagram** — CRM · P1/S
`horasRestantesMasUrgente` se calcula con el min(occurred_at) GLOBAL sobre todos los canales dentro de ventana (que en verdad.ts incluye Instagram), pero la UI lo muestra únicamente en la tarjeta de Facebook: el ejecutivo ve un countdown que corresponde a otra persona en otro canal — y prioriza mal.
*Evidencia: src/features/canales/BandejaCanales.tsx:180-182; server/src/canales/verdad.ts:126-151.*

**#49 · ResponderPanel: si la red falla, el botón queda en "Enviando..." para siempre** — CRM/Robustez · P1/S
`enviar()` y `borrar()` hacen `await fetch(...).then(r => r.json())` sin try/catch: un fallo de red o un body no-JSON rechaza la promesa, `setEnviando(false)` nunca corre y el panel queda bloqueado sin mensaje — con el texto del operador escrito y sin saber si la respuesta salió. En el flujo más delicado del producto (responder antes de que cierre la ventana de 7 días), la incertidumbre "salió o no salió" es exactamente lo que el diseño dice evitar.
*Evidencia: src/features/canales/ResponderPanel.tsx:77-99,101-114.*

**#50 · Manejo de errores casi inexistente: pantallas en blanco silenciosas, cero ErrorBoundary** — Robustez · P1/M
En todo src/ la ÚNICA pantalla que maneja isError es PautaMaestroPage (grep confirmado). Home, Comercial, Cartera, Gente, Bandeja y Canal renderizan `{isPending && 'Cargando...'}{data && contenido}`: si el API falla, el spinner desaparece y queda el título con la página vacía, sin mensaje ni retry. No existe ningún ErrorBoundary ni Suspense (grep = 0): un throw en render deja la app entera en blanco. Para un tablero de dirección, el silencio ante error es indistinguible de "no hay datos". (Los dos casos donde el error se disfraza de estado FALSO-SANO — feed de decisiones y Tesorería — son P0: #10 y #14.)
*Evidencia: grep isError → solo src/pages/PautaMaestroPage.tsx:29,72; src/pages/HomePage.tsx:45,70-76; src/pages/ComercialPage.tsx:199-206; src/pages/CarteraPage.tsx:169-176; src/pages/BandejaPage.tsx:33; src/features/home/BarraDeMando.tsx:65-71; grep ErrorBoundary/Suspense → 0.*

**#51 · LeadsInbox/LeadsPage sin catch: "cargando..." eterno o sidebar que desaparece** — Robustez · P1/S
`fetchLeads` sin catch: si falla, loading queda true para siempre. `fetchLeadStats().then(setStats)` tampoco: el aside de perfil/países simplemente no aparece, sin explicación. Ninguno pasa por react-query pese a que la capa existe.
*Evidencia: src/features/leads/LeadsInbox.tsx:25-36; src/pages/LeadsPage.tsx:25-27.*

**#52 · El aging de cobranza se renderiza en orden aleatorio** — Cartera · P1/S
La query no tiene ORDER BY: el orden depende del hash agg de Postgres. Confirmado en vivo: la UI muestra "91-180 días, más de 180, al día, 31-90, 1-30" — el envejecimiento de la deuda al revés y salteado, y puede cambiar entre requests. Es el panel del que depende a quién perseguir primero.
*Evidencia: server/src/analisis/cartera.ts:76-89; scratchpad/cartera-snapshot.md:41-56; cartera-desktop-full.png.*

**#55 · Reloj de tesorería: monedas mezcladas sin normalizar y sin plata en riesgo** — Tesorería · P1/M
La columna Monto muestra "900.00 BOB", "170.00 PEN" y "135.00 USD" juntas (data viva): no se puede comparar ni sumar. Los 3 KPIs cuentan pagos pero nunca dicen cuántos dólares están por perderse ("1 urgente" informa menos que "$X en riesgo"). La priorización es solo por edad, nunca por monto. `ontologia.pago` ya tiene monto_usd a un JOIN de distancia.
*Evidencia: src/features/tesoreria/RelojTesoreria.tsx:250-252,112-154; JSON vivo de /api/overview/tesoreria (12 pagos BOB/PEN/USD); server/src/db/canonico.ts:182-186.*

**#56 · En modo ejecución: sin badge, sin confirmación, y botones que prometen acciones no implementadas** — Campañas · P1/S
El badge solo aparece en simulación; en ejecución nada avisa que el clic escribe en Meta y no hay diálogo de confirmación. El botón muestra accion.descripcion ("Mover presupuesto de X a Y") pero el server responde 400 no_implementado para todo lo que no sea pausar.
*Evidencia: src/features/decisions/DecisionFeed.tsx:57-63; src/features/decisions/DecisionCard.tsx:139-150 vs server/src/routes/decisions.ts:132-138.*

**#57 · Errores de red silenciados en todo el front del área campañas** — Campañas/Robustez · P1/S
fetchCampaigns/fetchInsights/fetchPages/fetchAdsetOptions/fetchAdImages no chequean res.ok ni capturan rechazos: server caído o sin token = "No hay campañas en las cuentas elegidas" y selects vacíos en el wizard sin explicación. DecisionCard sin try/catch: si /aplicar falla en red, el botón queda "Aplicando..." para siempre.
*Evidencia: src/features/campaigns/api.ts:45-103 (22 fetch fuera de cliente.ts, ver #71); src/features/decisions/DecisionCard.tsx:83-97.*

**#58 · El total "en juego" mezcla plata cierta con estimaciones y doble-cuenta; dos lógicas contradictorias de "plata sobre la mesa"** — Campañas · P1/M
USD 748 suma gasto real desperdiciado + un heurístico arbitrario (15% del gasto en sin-exclusiones) + extrapolaciones lineales desde gasto ínfimo (en vivo: "gastó 8.61… traería ~576 resultados más"). La misma campaña genera 3 tarjetas solapadas (mover EEUU→BOL, mover PAN→BOL, subir BOL) cuya plata se suma como independiente. Además el banner de la estructura (`resultadosPerdidos`) usa OTRA lógica (extrapola al mejor CPR de TODOS los conjuntos, sin filtrar ACTIVE ni gasto mínimo) que contradice a los detectores (umbral 1.5×, gasto≥20, solo activos): "~255 resultados sobre la mesa" vs otras cifras del feed para la misma campaña.
*Evidencia: server/src/decisions/detectors.ts:163 (0.15), 239-274; app /campanas: 3 tarjetas de «[JUL] OPERACIONES CLANDESTINAS»; src/features/campaigns/efficiency.ts:37-50 vs server/src/decisions/detectors.ts:96-135.*

**#59 · Decisión → estructura no conservan la ventana: los números nunca cuadran** — Campañas · P1/S
La decisión se calcula sobre el rango del snapshot (default 90d) pero "Ver en «campaña»" abre /campanas/:id en last_30d. Verificado en vivo: la tarjeta dice "EEUU gastó 57.01 a 2.28" y la estructura muestra 62.59 a 2.24. El usuario no puede verificar la decisión que le piden tomar.
*Evidencia: src/features/decisions/DecisionCard.tsx:117-123 (link sin rango); src/pages/CampaignStructurePage.tsx:10 (default last_30d).*

**#60 · El umbral de relevancia (GASTO_MINIMO_RELEVANTE=20) se aplica en moneda cruda** — Campañas · P1/S
20 significa US$20 en Perú pero ~US$0.005 en COP y ~US$3 en BOB: en cuentas de moneda débil TODO pasa el filtro (ruido) y el criterio de "plata que vale la pena mover" cambia por país. La conversión a USD se arregló para ordenar y sumar, pero el filtro de entrada quedó sin convertir — sesga qué decisiones existen según el tipo de cambio.
*Evidencia: server/src/decisions/detectors.ts:76-77,98,150,187,219.*

**#61 · El presupuesto tipeado puede descartarse en silencio: campaña creada con presupuesto distinto al que el usuario cree** — Campañas · P1/S
El server parsea dailyBudget con `Number(replace(',','.'))` y si da NaN o ≤0 NO falla: crea la campaña SIN presupuesto. "1,000.50" → NaN → descartado; "10.000" (diez mil, formato LATAM) → 10.00. El front marca `hasBudget=Boolean(string cruda)`, así que con presupuesto inválido el paso 2 oculta el campo del conjunto y manda undefined → estructura sin presupuesto en ningún nivel → error críptico de Meta, o una campaña con 10 en vez de 10.000.
*Evidencia: server/src/routes/campaigns.ts:257-263; src/features/campaigns/CampaignStep.tsx:56; src/features/campaigns/AdsetStep.tsx:65.*

**#65 · Gráficos sistemáticamente mudos: sin ejes ni valores, tooltips solo por `title=`, evolución vacía con eje roto** — Visual · P1/M
(a) "EL TIEMPO" ($693.575 en 19 meses): sin eje Y y sin etiquetas de mes salvo los extremos — imposible cuantificar la caída reciente, que es LA pregunta de negocio; ídem "Cuándo llegaron", "La puerta cerrándose" (leyenda 9/1/1059 que no se corresponde con nada visible) y el histograma de vouchers. (b) Serie mensual, mix, sedes, aging e histograma son divs artesanales cuyo único "tooltip" es el atributo `title` (retraso ~1 s, invisible en táctil, inaccesible), con Recharts instalado y usado en otras pantallas. (c) En /pauta-maestro/:id "Evolución en el tiempo" renderiza ejes (0-120) sin NINGUNA serie visible y el eje X repite "13 jul" ×4 (solo existen ~3 días de snapshots y nada lo dice: parece un chart roto); en /pauta-comparar el mismo eje repite "13 jul" ×5 y la leyenda toma el color de la serie.
*Evidencia: comercial-desktop-full.png; home-desktop-full.png; leads-desktop-full.png; tesoreria-desktop-full.png; src/pages/ComercialPage.tsx:69-91,215-283; src/features/tesoreria/RelojTesoreria.tsx:297-329,316; src/features/home/FlujoVentana.tsx:175-180; pauta-detalle-desktop-full.png; pauta-comparar-desktop-full.png; src/features/pautaMaestro/CompararChart.tsx:60,77-83.*

**#66 · La columna RESULTADOS compara indicadores heterogéneos como iguales, con etiquetas crudas en inglés** — Pautas · P1/L
Mezcla "Messaging conversation started 7d", "Conversión personalizada", "Leads" y "Mixed" (etiquetas crudas de la API, en inglés, en una UI 100% español). Comparar 2.339 conversaciones contra 11 compras en la misma columna ordenable no responde "qué campaña rinde" — la distorsiona. COSTO/RESULTADO hereda el problema. (La versión de este defecto dentro de los detectores es el P0 #11.)
*Evidencia: campanas-todas-desktop-full.png; pauta-maestro-desktop-full.png; server/src/routes/structure.ts:110-133 (suma results de indicators distintos).*

**#68 · Cero estilos de focus en toda la app; `--ring` definido y nunca usado** — Visual/A11y · P1/S
grep de focus-visible/focus:ring/focus:outline sobre src devuelve VACÍO. El token `--ring` #2563EB existe y ningún componente lo aplica; GentePage elimina el outline del buscador (`outline-none`) sin reemplazo. Con solo 4 atributos aria en toda la app, la navegación por teclado es de facto inexistente.
*Evidencia: src/index.css:46; src/pages/GentePage.tsx:63; grep focus-visible src/ → 0.*

**#69 · Contraste insuficiente sistémico: micro-rótulos navy/40-45 a 10 px y texto ámbar como texto** — Visual/A11y · P1/M
El patrón EYEBROW (font-mono 10 px text-navy/40-45) carga información real (dueño de etapa, índices, timestamps) con contraste ~2.5-3:1, bajo el 4.5:1 exigido. `text-warning` (#F59E0B, ~2.2:1 sobre blanco) se usa como color de TEXTO en 10+ lugares, incluyendo errores de carga y badges "Revisar"/"Sin resultados", cuando `--warning-foreground` #78350F existe exactamente para eso y nadie lo usa. Y los metadatos de decisión del home (dueños de etapa, "273 caen · ventana 7 días", montos vta/pauta del ROAS, marcador del 95%) van en font-mono de 9-10 px — la información de la fuga del lazo está en el tamaño más chico de la pantalla.
*Evidencia: src/pages/ComercialPage.tsx:21; src/features/pautaMaestro/analisis.ts:174; src/features/campaigns/CampaignsDashboard.tsx:120; src/features/home/FlujoEmbudo.tsx:186,198,210; src/features/home/RoasPorPais.tsx:165-168; src/features/home/VentasPorPais.tsx:72.*

**#70 · "pico: N/día" miente cuando el gráfico agrupa por semana o mes** — Visual · P1/S
FlujoVentana agrupa por semana en 90d y por mes en 1y/todo (GRANO), pero el rótulo del pico siempre dice "/día". En el home con 90 días muestra "pico: 144/día" cuando 144 es el máximo SEMANAL — infla la percepción ×7 en la pantalla de dirección. Verificado en pantalla.
*Evidencia: src/features/home/FlujoVentana.tsx:143 con GRANO en :42-48,81; home-full.png (panel "La puerta cerrándose", rango 90 días).*

**#73 · Formato numérico bilingüe: coma y punto decimal mezclados** — Visual · P1/S
La tabla del maestro usa coma decimal ("110,81 BOB"), las cards de decisiones punto ("251.18", "0.49"), el home mezcla "$42.943" (punto = miles) con "$5920" y "7.1×". En una misma página (/campanas) conviven "4136,18" y "233.42". Riesgo real de leer 42.943 como 42 mil o como 43.
*Evidencia: campanas-todas-desktop-full.png; campanas-crop-orden.png; home-desktop-full.png.*

### 4.2 Prioridad P2

**#75 · El titular de COMPRA pierde 279 ventas en silencio** — Home · P2/S — El riel dice "$719.903 · 6.448 ventas" (suma por país) mientras el sistema conoce 6.727 (lazo.ventasConocidas): las ventas sin país o sin tasa desaparecen del titular sin nota; dos verdades del mismo total en el mismo screen. *Evidencia: src/features/home/FlujoEmbudo.tsx:53-54; vivo lazo.ventasConocidas=6727 vs riel 6448.*

**#76 · En el rango default (90d) la "línea del negocio" del gráfico no existe** — Home · P2/M — corteVentana solo se dibuja con grano 'dia' (7d/30d); con 90d el grano es 'semana' y la línea "← cerrado · abierto →" desaparece: la vista por defecto pierde el mensaje central del gráfico. *Evidencia: src/features/home/FlujoVentana.tsx:42-48,122-127; src/pages/HomePage.tsx:42; home-full2-1440.png.*

**#77 · El panel "los creativos" no muestra ni el anuncio ni el copy en la mayoría de las cards** — Home · P2/M — En pantalla, 6 de 9 dicen "sin texto" y 3 no tienen miniatura: el panel cuyo trabajo es "qué anuncio funciona (lo que la persona VE y LEE)" muestra rectángulos grises con precios; la tasa de fallo de extracción aguas arriba (adjuntarCreativos) nadie la mide. *Evidencia: home-full2-1440.png; src/features/home/Creativos.tsx:55-66.*

**#78 · "Qué escribe la gente" y "Meta cerró" son históricos totales, inmunes al rango** — Home · P2/S — loCerrado() y loQuePreguntan() se llaman sin filtro de fecha: 94.361 cerradas y "19,9% solo teléfono" son sobre TODO el histórico; el insight de copy no se puede correlacionar con la campaña vigente. *Evidencia: server/src/routes/overview.ts:76-78; vivo cerrado.total=94.361.*

**#80 · CanalPage siempre vuelve a '/', aunque vengas de /bandeja** — Navegación · P2/S — El loop natural del community es bandeja→canal→bandeja, pero el Volver del canal apunta fijo al inicio: cada canal terminado te expulsa al home. *Evidencia: src/pages/CanalPage.tsx:136; src/pages/BandejaPage.tsx:33; src/features/canales/BandejaCanales.tsx:150.*

**#81 · "¿Qué creativo convirtió más?" no tiene pantalla directa** — Navegación/Pautas · P2/M — El home muestra top 9 sin drill; la vista Creativos del comparador exige seleccionar campañas primero. No existe un ranking global de creativos navegable: una de las preguntas de negocio requiere conocer de antemano en qué campañas buscar. *Evidencia: src/pages/PautaCompararPage.tsx:119-120; src/features/home/Creativos.tsx:33 (slice(0,9) sin link).*

**#82 · Default engañoso de Volver** — Navegación · P2/S — texto='Volver a la bandeja' con a='/' hace que /leads diga "Volver a la bandeja" y navegue al home (la bandeja es /bandeja). *Evidencia: src/layout/Volver.tsx:8; src/pages/LeadsPage.tsx:31.*

**#83 · "Mes pasado" en la serie incluye snapshots de este mes** — Pautas · P2/S — rangoHasta devuelve solo la fecha PISO sin techo: la query gte() trae también el mes en curso. El parámetro `_orden` está muerto. *Evidencia: server/src/routes/pautaMaestro.ts:25-45,250-253.*

**#84 · CTR/CPC/CPM de campaña son promedios simples, no ponderados** — Pautas · P2/S — Un anuncio de 200 impresiones pesa igual que uno de 100.000, sesgando el CTR que alimenta el score y el "Mejor CTR". Igual en fatiga.ts (ad.ctr = promedio de CTRs diarios) y aplanarAdsets. *Evidencia: src/features/pautaMaestro/analisis.ts:42-52,265-277; server/src/pauta/fatiga.ts:171-172.*

**#85 · Veredicto "Escalar" de creativo con umbral CTR≥1 hardcodeado y ciego al CPA** — Pautas · P2/S — Marca "Escalar" a cualquier anuncio con resultados>0 y CTR≥1%, sin importar si el CPA es 3× el del resto; `(costoPorResultado ?? Infinity) < Infinity` solo verifica existencia. Un creativo con CTR 0.22% figura "EFICIENTE" sin declarar umbral (ver también #124). *Evidencia: src/features/pautaMaestro/comparar/CreativeCards.tsx:10-11.*

**#86 · El score se muestra sin explicación en ninguna parte de la UI** — Pautas · P2/S — "Score 62" sin tooltip ni leyenda de qué lo compone ni de que es relativo a la selección: un número de decisión no interpretable se obedece a ciegas o se ignora. *Evidencia: src/features/pautaMaestro/analisis.ts:90; src/features/pautaMaestro/Leaderboard.tsx:71-79; CompararTabla.tsx:43.*

**#87 · El reloj no corre al arrancar y nadie reintenta tras corridas rotas** — Pautas · P2/S — setInterval sin corrida inicial: tras un reinicio el primer snapshot tarda 6 h; combinado con que las corridas rotas no disparan reintento, el sistema quedó 26 h sin dato limpio sin que nada lo remedie ni lo escale. *Evidencia: server/src/pauta/reloj.ts:44-47; curl edadMinutos:1555.*

**#88 · Selector de campañas del comparador: búsqueda solo por nombre, sin selección de grupo** — Pautas · P2/S — No filtra por curso/país/cuenta y no hay "seleccionar todo el grupo": comparar un curso entero exige clickear campaña por campaña entre 116. *Evidencia: src/features/pautaMaestro/CampaignMultiSelect.tsx:17,51-91.*

**#89 · La estructura trunca en silencio y pierde el gasto de anuncios borrados** — Campañas · P2/M — adsets.limit(50) y ads.limit(50) sin paginación: campañas grandes suman de menos sin aviso; los insights de anuncios BORRADOS en la ventana se descartan → el "gastado" del header no cuadra con Ads Manager. *Evidencia: server/src/routes/structure.ts:77-81,93-110.*

**#90 · "Ignorar" decisiones es permanente, por navegador, e invisible para el equipo** — Campañas/Estado · P2/M — Ignoradas en localStorage con id estable: dirección ignora una fuga y marketing la sigue viendo; si la fuga crece 10× sigue oculta en ese navegador para siempre; el total de "plata en juego" difiere entre máquinas. Sin registro de quién/por qué. Es la clase de bug que el propio repo documenta como resuelto para las cuentas de pauta. *Evidencia: src/features/decisions/DecisionFeed.tsx:19,44; src/features/decisions/DecisionCard.tsx:151-157; regla en src/lib/datos/cliente.ts:14-16.*

**#91 · Dos rutas del camino de render violan "ninguna pantalla llama a Meta"** — Datos · P2/M — GET /api/structure/:campaignId (CampaignStructurePage) y GET /api/leads/costo hacen llamadas Graph en vivo al cargar; /api/leads/costo hace N llamadas (una por campaña con leads), candidato a rate limit. *Evidencia: server/src/routes/structure.ts:61-91; server/src/routes/leads.ts:14-25; server/src/routes/costoPorLead.ts:93-104; regla en overview.ts:41-43.*

**#93 · /pauta-maestro/snapshots y /comparar leen TODOS los snapshots sin LIMIT** — Datos · P2/S — Cada snapshot trae ~116-129 campañas en jsonb; ambas rutas cargan todos los del rango ('todo'=3650 días) en memoria. A 4 corridas/día el response crece sin tope; el comentario promete "~60 snapshots" pero no hay LIMIT. *Evidencia: server/src/routes/pautaMaestro.ts:249-254,296-316.*

**#94 · Datos proyectados que nadie consume** — Datos · P2/M — venta.vendedor, venta.medioVenta, venta.origenVenta se proyectan y nadie los agrega (grep: solo derivarHechos los copia); tb_matricula (1.758 filas) se espeja y jamás se proyecta; leads.formId/formName sin corte; 'porPerfil' solo en /api/leads/stats. Inventario muerto que responde preguntas reales (asesor, canal de venta, matrícula). *Evidencia: grep vendedor|medioVenta|origenVenta server/src → solo ontologia/derivarHechos.ts:91-92; server/src/fuentes/cerberus.ts:58.*

**#97 · La cancelación de requests está prometida pero no cableada** — Robustez · P2/S — El docstring de api() afirma que recibe la signal de react-query ("lo que mata las races"); es falso: grep de 'signal' devuelve solo ese comentario; ningún queryFn la pasa y api() nunca la reenvía a fetch. *Evidencia: src/lib/datos/cliente.ts:63 vs src/lib/datos/overview.ts:154; src/features/canales/useInteracciones.ts:45-54.*

**#98 · Races reales en los fetch crudos con useEffect** — Robustez · P2/M — LeadsInbox debouncea 200 ms pero no aborta (la respuesta lenta de "a" puede pisar "ab"); HistorialPersona y QuePuedoHacer pueden renderizar la persona anterior sobre la nueva; CanalPage puede aplicar el estado del rango viejo — exactamente el bug que useInteracciones.ts:20-25 documenta haber arreglado migrando a TanStack Query, en un fetch que quedó fuera de la migración. *Evidencia: src/features/leads/LeadsInbox.tsx:25-36; src/features/canales/HistorialPersona.tsx:24-29; src/pages/CanalPage.tsx:97-109.*

**#99 · Invalidación muerta: ['canal'] no existe como query** — Robustez · P2/S — useInvalidarBandeja invalida ['canal'] pero ninguna query usa esa clave (CanalPage usa fetch crudo): tras responder desde un canal, sus contadores no se refrescan. claves.canal, claves.persona y claves.cuentasMeta están huérfanas. *Evidencia: src/features/canales/useInteracciones.ts:85 vs src/pages/CanalPage.tsx:97-109; src/lib/datos/cliente.ts:93-96.*

**#100 · BandejaPage descarga el overview más pesado (375 KB) para pintar 3 tarjetas** — Robustez · P2/S — useOverview('todo') — medido 375 KB / 0,49 s — solo para las tarjetas de canal y el accionable; y usa una clave distinta a la del home, así que el ping-pong home↔bandeja garantiza dos descargas completas. *Evidencia: src/pages/BandejaPage.tsx:19; curl /api/overview?rango=todo = 375.765 bytes / 0,49 s.*

**#101 · Búsqueda de gente: un request por tecla y sin feedback de vacío** — Robustez · P2/S — useBuscarGente dispara una query por keystroke desde 2 caracteres, sin debounce; el Buscador solo renderiza si personas.length > 0 (sin coincidencias no aparece nada); un 500 en usePersona360 se muestra como "No encontramos a esa persona". *Evidencia: src/lib/datos/gente.ts:37-43; src/pages/GentePage.tsx.*

**#102 · Búsquedas sin normalizar teléfono/acentos; leads no busca por teléfono** — CRM · P2/S — El ilike de leads cubre fullName/email/campaignName: el teléfono —el dato de contacto principal del negocio— no es buscable, así que encontrar al lead desde un chat de WhatsApp entrante es imposible. En gente, las identidades guardan el teléfono solo-dígitos pero el término no se normaliza ("+51 987 654 321" no matchea "51987654321"); "Maria" no encuentra "María". *Evidencia: server/src/routes/leads.ts:84-88; server/src/canales/persona360.ts:196-210; server/src/ontologia/poblarIdentidad.ts:27-31.*

**#103 · /gente: página vacía sin arranque** — CRM · P2/S — Solo un buscador centrado en una página 80% blanca: sin recientes, sin top clientes, sin ejemplos; un gerente no sabe qué puede escribir. buscarPersonas ya ordena por compras DESC y podría servir la lista inicial. *Evidencia: gente-desktop-full.png; server/src/canales/persona360.ts:196-210; src/pages/GentePage.tsx:204-218.*

**#104 · Rebuild del grafo de identidad sin transacción** — CRM · P2/M — UPDATE persona_id=NULL, DELETEs e inserts secuenciales sin transacción: mientras corre, /api/gente sirve 360s rotos (sin identidades, sin lazo, LTV desaparecido); si muere a la mitad, el estado roto queda persistido. *Evidencia: server/src/ontologia/poblarIdentidad.ts:148-238.*

**#105 · El vendedor responde sin contexto de curso/campaña y sin plantilla para el mensaje que importa** — CRM · P2/M — El panel muestra el texto del post pero no qué curso/campaña hay detrás, y el privado —"la información de verdad: fecha, lugar, precio"— arranca vacío y se tipea desde cero en cada respuesta; solo el público tiene plantilla. *Evidencia: src/features/canales/ResponderPanel.tsx:22-24,145-149,206-217.*

**#106 · Filtro "Les puedo escribir hoy" ofrecido en canales donde nunca puede matchear** — CRM · P2/S — En /canal/instagram siempre da vacío (VENTANA_ABIERTA exige canal='facebook') y el mensaje culpa a los filtros, cuando la causa es que ese canal no tiene ventana de privados. *Evidencia: src/pages/CanalPage.tsx:63-67,218-234,246-249; server/src/canales/consultas.ts:25.*

**#109 · KPIs del reloj de tesorería calculados sobre una muestra LIMIT 100** — Tesorería · P2/S — total/yaPerdidos/urgentes se computan en JS sobre la lista truncada a 100: el día que la cola pase de 100, el header dirá "Esperando: 100" y subcontará urgentes y perdidos sin señal de truncamiento. *Evidencia: server/src/canales/tesoreria.ts:118,157-162.*

**#110 · Ninguna exportabilidad en toda el área comercial/cartera/tesorería** — Comercial · P2/M — Cero hits de csv/exportar/descargar en src/: cobranza no puede llevarse los deudores, dirección no puede llevarse la serie, tesorería no puede imprimir la cola. *Evidencia: grep -rn 'csv|exportar|descargar' src/ → 0.*

**#111 · Barras del mix: el ancho codifica unidades pero el ranking es por plata** — Comercial · P2/S — tope=mix[0].ventas con mix ordenado por USD: el "Diploma Élite" ($16.370, 108 uds) se ve 4× más chico que el "Certificado con Portadiploma" ($23.442, 480 uds) aunque casi lo iguala en plata; si un producto barato masivo no es mix[0], el ancho supera 100% y desborda. El server arregló exactamente esta confusión en el ORDER BY y el front la reintrodujo en el encoding. *Evidencia: src/pages/ComercialPage.tsx:218-220 vs server/src/analisis/comercial.ts:76-79.*

**#112 · tasaCuotas no mide lo que el copy dice** — Comercial · P2/S — La UI dice "1,9% paga en cuotas — la cartera de crédito que nadie mide", pero en_proceso es el estado ACTUAL (cobrándose ahora): una venta en cuotas terminada cuenta como cobrada. Mide stock vivo, no modalidad — subestima cuánto del negocio es a crédito. *Evidencia: server/src/analisis/comercial.ts:110; server/src/db/canonico.ts:90-98; src/pages/ComercialPage.tsx:305-306.*

**#113 · Segmentos LTV excluyen clientes sin persona vinculada, sin declararlo** — Cartera · P2/S — segmentosValor filtra cl.persona_id IS NOT NULL: todo cliente no vinculado queda fuera del LTV y de la "semilla lookalike" sin que la UI mencione la cobertura — en el área que sí declara su censura (latencia). *Evidencia: server/src/analisis/cartera.ts:156,180; src/pages/CarteraPage.tsx:219-280.*

**#116 · El mismo control segmentado existe en 4 variantes visuales** — Visual · P2/M — (1) RangoPicker pill activo bg-primary; (2) PautaMaestroPage botones sueltos activo bg-navy; (3) MetricToggle/Rankings grupo unido activo bg-navy; (4) CanalPage pills activo bg-primary. El color de "activo" alterna entre navy y azul según la página para el mismo gesto: el usuario no puede formar hábito visual. *Evidencia: src/features/canales/RangoPicker.tsx:35-40 vs src/pages/PautaMaestroPage.tsx:60-65 vs src/features/pautaMaestro/MetricToggle.tsx:33-38.*

**#117 · Loading = texto plano "Cargando..." en todas partes, sin skeletons, con layout shift completo** — Visual/Robustez · P2/M — Cada página resuelve la carga con un párrafo distinto ("Cargando...", "Cargando pautas...", "Cargando detalle…"); al llegar la data el bento entero aparece de golpe. No existe skeleton ni placeholder dimensionado. *Evidencia: src/pages/HomePage.tsx:70-74; src/pages/PautaMaestroPage.tsx:78-79; src/features/tesoreria/RelojTesoreria.tsx:70-76; src/pages/ComercialPage.tsx:199; src/pages/CarteraPage.tsx:169.*

**#119 · La paleta categórica cicla tras 5 series pese a garantizar lo contrario** — Visual · P2/S — colorForId hace CATEGORICAL[idx % 5]: con 6+ campañas en /pauta-comparar dos series comparten color en el chart, el scatter y la tabla, sin aviso; el docstring promete "orden fijo — nunca se cicla" y el multiselect no limita la selección. *Evidencia: src/features/pautaMaestro/chartPalette.ts:42 vs :15-17.*

**#120 · Accesibilidad de interacción: sorting solo con mouse, drawers sin focus trap, pseudo-checkboxes sin semántica** — Robustez/A11y · P2/M — Headers ordenables como `<th onClick>` sin botón/tabIndex/aria-sort; el drawer móvil de comparar (role=dialog aria-modal) no maneja Escape ni atrapa el foco; overlays de ResponderPanel/ConfiguracionPanel dejan escapar el foco; el multiselect no expone aria-pressed/checked. *Evidencia: src/features/pautaMaestro/PautaMaestroTable.tsx:162-173; src/pages/PautaCompararPage.tsx:269-286; src/features/canales/ResponderPanel.tsx:118-120; src/features/pautaMaestro/CampaignMultiSelect.tsx:62-78.*

**#121 · Bundle único de 1.014 KB (296 KB gzip) sin code splitting** — Robustez · P2/M — Build medido: dist/assets/index-CKOhSXxZ.js = 1.014 KB con warning explícito de Vite. Recharts se usa solo en 4 archivos de pauta y react-table en 2, pero todo se descarga para abrir el home. *Evidencia: salida de npx vite build; grep recharts → 4 archivos de pautaMaestro + PautaDetallePage.*

**#122 · Truncamientos que destruyen la distinción entre ítems** — Visual · P2/S — "Diploma internacional del ..." DOS veces (productos distintos indistinguibles); "Transferencia BC..." dos veces; sidebar de /leads trunca 4 de 6 segmentos ("fuerzas armadas y poli…"); "sede sin se..."; "Estados ...". Sin tooltips visibles. *Evidencia: comercial-desktop-full.png; cartera-desktop-full.png; leads-desktop-full.png.*

**#124 · Semáforos con criterio opaco** — Home · P2/S — Honduras tiene el mejor ROAS visible (65.2×) y es la única fila "OBSERVAR" mientras todo lo demás dice "ESCALAR" (probablemente por muestra chica, $33 de pauta — nada en pantalla lo explica); los chips CARO/MEDIO/EFICIENTE de creativos tampoco declaran umbral. *Evidencia: home-desktop-full.png.*

**#125 · Comparador: alertas sin drill-down, burbujas anónimas, seleccionadas invisibles** — Pautas · P2/M — La GANADORA muestra "ALERTAS 8" en rojo sin listar ninguna; el Mapa de eficiencia no etiqueta las burbujas (hay que inferir por color contra la leyenda de OTRO gráfico); el panel dice "3 seleccionadas" pero ningún checkbox visible está marcado (quedan scrolleadas fuera del sidebar). *Evidencia: pauta-comparar-desktop-full.png.*

### 4.3 Prioridad P3 (menores)

**#126 · Params de URL casteados sin validar** — `?rango=` se castea con `as RangoFiltro`/`as DatePreset` sin whitelist: un deep link con typo o con el vocabulario de otra pantalla va tal cual a la API; el mismo nombre de param transporta vocabularios distintos según la ruta. *Evidencia: src/pages/PautaDetallePage.tsx:47; src/pages/CampaignStructurePage.tsx:10.*

**#127 · Back ad-hoc distinto de Volver en estructura y creación** — CampaignStructurePage y NewCampaignPage arman su propio link de retorno en vez de usar Volver: la única señal de orientación pierde consistencia justo en la jerarquía live. *Evidencia: src/pages/CampaignStructurePage.tsx:14-20; src/pages/NewCampaignPage.tsx:8-14; src/layout/Volver.tsx:8-17.*

**#128 · La búsqueda de Gente se pierde al volver del perfil** — El query es useState local: para revisar 3 homónimos hay que retipear 3 veces. *Evidencia: src/pages/GentePage.tsx:50,202.*

**#129 · Metadatos de canal duplicados en 3 lugares y ya divergentes** — FICHAS existe en CanalPage y BandejaCanales con textos distintos para el mismo hecho (WhatsApp: "77% de la inversión" vs "decisión pendiente Cloud API vs CRM"); el mapa de colores de canal se repite una tercera vez. *Evidencia: src/pages/CanalPage.tsx:31-55 vs src/features/canales/BandejaCanales.tsx:33-57 vs src/features/canales/FilaInteraccion.tsx:5-9.*

**#130 · Anónimos de Instagram etiquetados "Usuario de Facebook"** — `persona_nombre ?? 'Usuario de Facebook'` sin mirar el canal; el ternario etiquetaría "Instagram" a un futuro WhatsApp. *Evidencia: src/features/canales/ResponderPanel.tsx:127-133.*

**#131 · Campo custom del formulario hardcodeado en dos capas** — '¿cuál_es_tu_cargo?' literal en el SQL del server y en el front: cualquier formulario nuevo deja el perfil vacío en silencio en ambas pantallas. *Evidencia: server/src/routes/leads.ts:70; src/features/leads/LeadsInbox.tsx:66.*

**#132 · CanalPage no muestra los dos números más accionables del canal** — EstadoCanal trae sin_atender y ventana_abierta y no se renderizan en ningún lado de la página. *Evidencia: src/pages/CanalPage.tsx:164-185 vs src/features/canales/types.ts:20-30.*

**#133 · Decisiones aplicadas guardadas dentro del event store de ingesta** — POST /aplicar inserta en events con source='decision_applied': mezcla auditoría interna con el espejo crudo de eventos externos; contamina la fuente de verdad y complica re-proyecciones. *Evidencia: server/src/routes/decisions.ts:146-153 vs server/src/db/schema.ts:14-24.*

**#134 · Lógica de análisis viviendo en routes/ e importada por pauta/** — routes/costoPorLead.ts no registra rutas: es cálculo de negocio que pauta/snapshot.ts:12 importa desde routes/ — inversión de capas. *Evidencia: server/src/routes/costoPorLead.ts:38; server/src/pauta/snapshot.ts:12.*

**#135 · diasMora puede salir negativo** — coalesce solo atrapa NULL: si todas las cuotas impagas vencen a futuro, max() da negativo y la UI mostraría "-12d de mora". *Evidencia: server/src/analisis/cartera.ts:101.*

**#136 · Forecast y serie diaria calculados en cada request y descartados** — /api/overview/comercial computa regresión + 120 días de serie por llamada; el front no tiene esos campos y nadie importa forecastVentas. El método regresiona sobre días CON ventas (sesgo); en vivo r²=0.002. *Evidencia: server/src/analisis/comercial.ts:258-301,314-326 vs src/lib/datos/comercial.ts:29-36.*

**#137 · Paneles numerados fuera de orden y copy que promete 4 y muestra 6** — Renderizan 01, 02, 03, 05, 06, 04; el header dice "cuatro cosas" con seis paneles. *Evidencia: src/pages/ComercialPage.tsx:193-196,207-308.*

**#138 · Textos generados rotos** — "21 decisiónes" (concatenación 'decisión'+'es', visto en vivo), "Incluye 1 públicos", "1 países", "revisar ahoraVer qué hacer →" (elementos inline pegados), "CTR ++30%" (doble '+' en el badge de fatiga). *Evidencia: src/features/decisions/DecisionFeed.tsx:96; src/features/campaigns/StructureTree.tsx:128; src/features/decisions/DecisionesPendientesCard.tsx:83-99,177-183; src/features/pautaMaestro/comparar/CreativeCards.tsx:78-80; home-full2-1440.png; campanas-desktop-full.png.*

**#139 · Iconografía mixta** — lucide + glifos unicode ('●'/'▲'/'✕'/'◌') + flechas de texto ('Responder →') conviven para el mismo significado. *Evidencia: src/features/home/BarraDeMando.tsx:93-105 vs src/features/home/FichaEstado.tsx:90; src/features/canales/BandejaCanales.tsx:153.*

**#140 · index.html declara lang='en' y título 'meta-escuela'** — Afecta lectores de pantalla, corrección ortográfica y la pestaña de todos los usuarios. *Evidencia: index.html:2,7.*

**#141 · Paleta muerta en PautaDetallePage** — COLORES incluye rojo/verde de estado y el violeta #7c3aed que chartPalette descartó; solo se usa COLORES[0]; grid hardcodeado #e5e7eb. *Evidencia: src/pages/PautaDetallePage.tsx:21,196.*

**#142 · Misma data cacheada bajo dos claves; clave sensible al orden de ids** — ['pauta-maestro'] vs ['pauta-maestro','todo'] para la misma llamada (doble caché + refetch); ['pauta-comparar', ids.join(',')] hace que A,B y B,A sean dos entradas. *Evidencia: src/pages/PautaCompararPage.tsx:45,62-66 vs src/pages/PautaMaestroPage.tsx:30.*

**#143 · ConfiguracionPanel confunde vacío con cargando; CampaignsDashboard loading eterno** — "Cargando cuentas..." mientras disponibles.length===0 && !error (0 cuentas válidas = cargando eterno); Promise.all sin catch deja loading=true para siempre. *Evidencia: src/features/config/ConfiguracionPanel.tsx:88-90; src/features/campaigns/CampaignsDashboard.tsx:41-50.*

**#144 · Selector de cuentas duplicado que un comentario dice haber eliminado** — CampaignsListPage documenta que elegir cuentas "ya NO se elige acá", pero la pestaña "Todas las campañas" mantiene su AccountsPicker inline editando la misma clave: tres UIs para el mismo ajuste contando la tuerca. *Evidencia: src/pages/CampaignsListPage.tsx:12-16 vs src/features/campaigns/CampaignsDashboard.tsx:84-113.*

**#145 · Código muerto y features fantasma** — ObjectivePicker, BudgetFields, CampaignDetailsFields y CampaignResults sin imports (wizard viejo); el detector 'pais-sin-replicar' y la acción 'duplicar-a-cuentas' tipados y estilados pero ningún detector los produce; "Usar los 11 que ya pautas" hace slice(0,11) de 15 países hardcodeados; webhook/firma.ts (HMAC) muerto (§2.4). *Evidencia: src/features/campaigns/ObjectivePicker.tsx; src/features/decisions/DecisionCard.tsx:54-59 vs server/src/decisions/detectors.ts:290-298; src/features/campaigns/AdsetStep.tsx:133-138.*

**#146 · Columna "RELOJ DE META" repetida 9 veces en las vencidas** — En "Meta ya no las va a ver (9)" la columna repite el mismo texto gris; ese espacio podría mostrar teléfono/canal del cliente. *Evidencia: tesoreria-desktop-full.png.*

---

## 5. Problemas críticos (P0)

Los 18 hallazgos que inducen decisiones de plata erradas HOY o rompen el contrato central del producto ("honestidad del dato"). Verificados en código Y en la app viva donde fue posible.

**#1 · Dos jerarquías paralelas para la MISMA campaña, con fuentes distintas, números distintos y sin puente** — Pautas/Navegación · L
`/campanas/:id` (CampaignStructurePage→StructureTree) consulta Meta Graph EN VIVO; `/pauta-maestro/:id` (PautaDetallePage) lee el snapshot de Postgres (hasta 6 h viejo; en vivo se vio "revisado hace 1555 min" ≈ 26 h). Las puertas de entrada se reparten sin criterio visible: DecisionCard→/campanas/:id, maestro→/pauta-maestro/:id, header "Pautas"→maestro, home "ver la pauta"→/campanas. **Verificado en la app viva:** la campaña 120252253947880341 con "30 días" muestra GASTO 111 BOB · 6 resultados · 18 BOB c/u en /pauta-maestro/:id, y 120,37 · 6 resultados · 20,06 c/u en /campanas/:id — ~9% de diferencia sin ninguna señal de cuál manda. Además ambas familias duplican lista, detalle, drill a adsets/ads, fatiga y pickers de período, y el naming amplifica la confusión: header "Pautas" → /pauta-maestro (snapshot); home "ver la pauta" → /campanas (live), cuya h1 es "Pauta". Dos usuarios (o el mismo en dos momentos) discuten con números que no cuadran y apagan/escalan la pauta con el dato viejo.
*Evidencia: src/features/campaigns/StructureTree.tsx:179 + server/src/routes/structure.ts:2 (MetaGraphClient, graph.facebook.com) vs src/pages/PautaDetallePage.tsx:100 ("según el último snapshot"); entradas: src/features/decisions/DecisionCard.tsx:118 vs src/features/pautaMaestro/PautaMaestroTable.tsx:41; src/App.tsx:47-53 (ambas familias de rutas); naming: src/layout/AppShell.tsx:56-62, src/pages/HomePage.tsx:148, src/pages/CampaignsListPage.tsx:28; app viva: pauta-detalle-desktop-full.png vs campana-detalle-desktop.png.*

**#2 · La frescura que la home reporta es falsa AHORA: "hace 7 h" sobre datos de 26 h** — Home/Datos · M
`sincronizaciones['pauta:90d']` tiene ultima_ok=2026-07-16 13:34 (hace ~7 h) CON ultimo_error='26 cuenta(s) fallaron' y cursor '0 campañas' EN EL MISMO instante — la fila quedó envenenada por el código pre-fix (commit 9b0bedf no repara lo ya escrito) y `salud()` confía ciegamente en ultima_ok sin validarla contra el snapshot servible. El snapshot realmente servido es de 2026-07-15 18:59 (~26 h). Resultado visible: BarraDeMando dice "FLUYE pauta · HACE 7 H" y salud "ok · revisada hace 7 h" mientras el ROAS, las decisiones y los creativos son de ayer. Es exactamente la clase de bug (frescura fingida) que ya costó el "Bolivia 10,08× · subí presupuesto" falso.
*Evidencia: server/src/canales/salud.ts:135-144 + server/src/pauta/snapshot.ts:164-178; vivo: /api/overview/salud → edadMinutos 438 vs /api/overview?rango=90d → pauta.edadMinutos 1553; DB: fila 2026-07-16 13:34 con n_camp=0, n_err=26, ultima_ok==ultimo_error_at; curl /api/pauta-maestro → edadMinutos 1557.*

**#3 · 7 de las últimas 10 recolectas de pauta fallaron y la UI no lo dice en ningún lado** — Home/Pautas · M
Como ultimoSnapshot solo sirve corridas limpias (errores=0 por definición de RECOLETA_LIMPIA_SQL), `pauta.errores` llega SIEMPRE vacío al front: el aviso "Meta no dejó leer N cuentas" de DecisionesPendientesCard es código muerto desde el fix. Y salud() lee ultima_ok pero nunca ultimo_error ("26 cuenta(s) fallaron" está en la base, invisible). El sistema puede pasar días sirviendo un snapshot congelado sin que dirección se entere de que la recolección está rota. (Se solapa con la deuda conocida L1 de docs/12 — acá verificado con datos vivos: 7/10 últimas filas de pauta_snapshots con 14-34 errores.)
*Evidencia: server/src/pauta/snapshot.ts:87 (errores=0 obligatorio); src/features/decisions/DecisionesPendientesCard.tsx:80,103-108 (código muerto); server/src/canales/salud.ts:135-144; DB: 7/10 últimas filas con 14-34 errores.*

**#4 · El sistema rango↔snapshot está roto: 4 de los 5 rangos del picker rompen media home y mienten el porqué** — Home · M (raíz L)
Con 7d/30d/1y/todo, `ultimoSnapshot(rango)` devuelve null porque el reloj solo genera snapshots '90d' (RANGO_POR_DEFECTO). La home muestra entonces "Sin revisar" + "Conecta las cuentas de pauta" + CTA "crear campaña" (falso: está conectada y revisada), y el panel COMPRA pierde el ROAS. Verificado vivo: los 4 rangos devuelven pauta:null y roasPais:null. Un gerente que toca "30 días" concluye que la pauta no está conectada; toda la sección ENTRA/creativos/costo desaparece en silencio. De fondo, los snapshots se guardan por clave de rango pero solo el reloj de 90d corre: el picker ofrece opciones que apuntan a claves que nunca existirán — lo peor de los tres mundos posibles (snapshot único derivado / reloj que cubra todo / picker que solo ofrezca lo que existe).
*Evidencia: server/src/pauta/reloj.ts:14 + server/src/routes/overview.ts:74 + src/pages/HomePage.tsx:138-150; vivo: curl /api/overview?rango=30d → pauta:null con cuentas configuradas y snapshot 90d existente; DB: pauta_snapshots solo tiene rango='90d'; picker: src/features/canales/RangoPicker (5 opciones).*

**#5 · Los botones de rango del maestro no cambian ningún número: "Hoy" muestra gasto de 90 días** — Pautas/API · S
`recortarPorRango` aplica EXACTAMENTE el mismo filtro (spend>0 || results>0) para hoy/7d/30d/mes/mesPasado — las variables inicio/fin/dias se calculan y nunca se usan. Verificado en vivo: rango=hoy y rango=7d devuelven las mismas 36 campañas con el mismo gasto total (7.119,93); rango=todo solo agrega las 80 campañas con gasto 0. El gasto mostrado es siempre el de la ventana de recolección del snapshot (90d). Quien mira "Hoy" y ve $7.119 cree que hoy se gastó eso: decisión de plata sobre un número falso.
*Evidencia: server/src/routes/pautaMaestro.ts:53-64 (filtro idéntico; inicio/fin muertos), :346-354; curl /api/pauta-maestro?rango=hoy vs ?rango=7d (idénticos).*

**#6 · La serie histórica sirve snapshots ROTOS: el gráfico dibuja desplomes que no existieron** — Pautas/API · S
/snapshots y /comparar leen pauta_snapshots sin el filtro RECOLETA_LIMPIA que el propio snapshot.ts declara obligatorio ("una corrida rota no es un dato viejo: es un dato falso"). Verificado en vivo en la serie de 7 días: punto del 16/07 13:34 con 0 campañas, punto del 16/07 08:12 con 1 campaña/$14,02 (el mismo incidente narrado en snapshot.ts:83), punto del 14/07 11:07 con 12 campañas/$1.507 (parcial). "Evolución en el tiempo" en comparar y en el detalle muestra precipicios falsos: el usuario lee "la campaña se murió" donde lo que murió fue la recolección.
*Evidencia: server/src/routes/pautaMaestro.ts:250-254,298-302 (sin filtro limpia) vs server/src/pauta/snapshot.ts:87-91; curl /api/pauta-maestro/snapshots?rango=7d.*

**#7 · "Evolución en el tiempo" no es evolución: acumulados de ventana móvil mezclados — y la serie diaria real (37 meses) no tiene NINGÚN consumidor de UI** — Pautas/Datos · L
Cada snapshot guarda el gasto ACUMULADO de su ventana de recolección — 90d el reloj, o el rango arbitrario que alguien pasó al botón "Revisar ahora" (decisions.ts:81-83 acepta 7d/30d/90d/1y/todo). La serie grafica esos acumulados heterogéneos contra la fecha del snapshot: no es gasto diario y dos puntos consecutivos pueden ser ventanas distintas (dientes de sierra sin significado). Mientras tanto, `pauta_serie` tiene 96.131 filas de serie diaria real (37 meses, 3 niveles: 15 cuentas, 1.567 campañas, 4.677 anuncios) y su único lector es una Tool del SDK: la gráfica de comparar pinta 10 snapshots (3 días) teniendo 3 años al lado. Este modelo hace imposibles los rangos reales, la comparación de períodos, el CPL en el tiempo y "el mejor creativo del mes".
*Evidencia: server/src/pauta/reloj.ts:14; server/src/routes/decisions.ts:81-83; server/src/pauta/backfill.ts:10-23 (diagnóstico "3,1 días de historia"); server/src/pauta/ventanas.ts:93 ("el día de hoy lo trae el reloj"); grep pauta_serie → único lector server/src/sdk/herramientas/historia.ts:100,118-171; query en vivo: 96.131 filas.*

**#8 · BOB y USD mezclados en score, ranking, orden, heatmap, ejes y tablas — todo el módulo de pauta compara plata incomparable** — Pautas/Visual · M-L
En vivo conviven Goberna Bolivia (BOB) y 6 cuentas en USD. (a) El score compuesto normaliza CPA crudo entre monedas (70 BOB ≈ $10 rankea peor que 15 USD). (b) El comparador etiqueta TODOS los charts/tooltips con la moneda de la PRIMERA campaña seleccionada. (c) Los heatmaps de CPA/CPC/CPM comparan valores multi-moneda con fmtMoney(v,'') sin unidad. (d) Ordenar el maestro por Gasto ordena números crudos: 732,29 BOB ordena sobre 425,55 USD. (e) La tabla "Todas las campañas" (2.474 filas) NI SIQUIERA muestra la moneda por fila y su sort default es spend desc cruzando cuentas: "PACK LIBROS WSP · 1320,65" (BOB, ~USD 190) aparece arriba de "[JUN] BICAMERAL 3 · 895,69" (USD) — ranking de inversión falso a primera vista. (f) La estructura muestra "480,62 gastado" sin símbolo ni código (en cuentas BOB/COP se lee como USD). (g) El ranking de decisiones mezcla badges "USD 153" y "BOB 108". `tasasDeCambio` ya existe en el server (la usa geoGasto) y no se aplica en nada de esto; CampaignsDashboard ya hace totales por moneda (el patrón correcto). Induce directamente a escalar/pausar la campaña equivocada entre países.
*Evidencia: src/features/pautaMaestro/analisis.ts:82-91; src/pages/PautaCompararPage.tsx:74; src/features/pautaMaestro/comparar/Rankings.tsx:9-16; src/features/pautaMaestro/PautaMaestroTable.tsx:53-77; src/features/campaigns/CampaignsTable.tsx:41-57,66 + campaignRows.ts:22-35 (sin currency); src/features/campaigns/efficiency.ts:29-30; curl: monedas ['BOB','USD']; screenshots maestro.png, campanas-todas-desktop-full.png, campanas-crop-orden.png (USD 12 → BOB 108 → USD 9); patrón correcto: src/features/campaigns/CampaignsDashboard.tsx:70-78; tasas: server/src/analisis/tasas.ts, server/src/pauta/snapshot.ts:129, backfill.ts:153.*

**#9 · Dos fuentes de verdad para "qué cuentas se analizan": la tuerca escribe en la que nadie lee** — Campañas/Estado · M
ConfiguracionPanel (el único lugar de config según el diseño) guarda las cuentas SOLO en localStorage 'meta-escuela.dashboardAccounts'. Pero el snapshot job, el feed de decisiones y la card de la home leen la config de la DB (cuentas_pauta vía /api/config/cuentas-pauta). El hook `useGuardarCuentasPauta` que persiste al server existe y NADIE lo usa (grep confirmado; su propio docstring explica que se movió al servidor "porque el job de fondo no tiene localStorage"). Consecuencias: cambiar cuentas en la tuerca no cambia lo que se analiza; el PUT que dispararía el re-snapshot nunca se llama; /campanas gatea el feed con localStorage mientras la home gatea con la DB — pueden contradecirse ("elige tus cuentas" en una pantalla, feed lleno en la otra). Además DecisionFeed manda accountIds que el server ignora por completo. Decisiones de pauta sobre el conjunto de cuentas equivocado.
*Evidencia: src/features/config/ConfiguracionPanel.tsx:22 vs src/lib/datos/overview.ts:236-257 (useGuardarCuentasPauta sin usuarios); server/src/pauta/snapshot.ts:35-43; src/pages/CampaignsListPage.tsx:19,55 vs src/pages/HomePage.tsx:46,189; server/src/routes/decisions.ts:42-44 (ignora accountIds).*

**#10 · Error del server o rango sin snapshot se pinta como "la pauta está sana"** — Campañas/Robustez · S
api.ts tira error en !res.ok justamente para que "un 500 no sea 'no hay decisiones'", pero DecisionFeed lo traga con `.catch(() => setLoading(false))` sin estado de error y cae al vacío verde con CheckCircle: "No hay nada que decidir — Revisé N campañas y no encontré plata mal repartida". Peor: un rango nunca snapshoteado devuelve decisiones:[] con snapshot:null y el feed celebra "Revisé 0 campañas activas". Verificado en vivo: GET /api/decisions?rango=7d → {decisiones:[], campanasAnalizadas:0, snapshot:null}; tocar "7 días" muestra pauta sana falsa. Es exactamente la mentira que DecisionesPendientesCard documentó y arregló en la home — el feed no heredó el arreglo. Un servidor caído se lee como pauta perfecta y nadie recorta ni escala nada.
*Evidencia: src/features/decisions/DecisionFeed.tsx:38,66-87; src/features/decisions/api.ts:8-11; server/src/routes/decisions.ts:46-57; curl vivo rango=7d.*

**#11 · Detectores mezclan indicadores de resultado: tarjetas "USD -8 en juego" y "1109.5× el promedio, contra 0.00" publicadas en producción** — Campañas · M
anuncioCaro compara el CPR de cada anuncio contra el promedio de la campaña sin verificar que midan lo mismo (leads vs conversaciones vs clics) y solo guarda promedio===0 exacto, no ~0. En vivo hoy: «Flyer - Grupo» "cuesta 1109.5× el promedio… contra 0.00", «750.3× el promedio… contra 0.00», y «Flyer 2026» con "USD -8 en juego" — plata NEGATIVA mostrada como decisión y RESTADA del total USD 748. El ranking por plata y el total del feed y de la home quedan contaminados; presupuestoMalRepartido y la agregación de structure.ts (suma results de indicators distintos) comparten el defecto. Tres cards absurdas destruyen la credibilidad de las 18 buenas.
*Evidencia: server/src/decisions/detectors.ts:175-212; server/src/routes/structure.ts:110-133; app /campanas en vivo: campanas-desktop-full.png (refs de accesibilidad f10e430 "USD -8 en juego", f10e272 "1109.5×", f10e432 "750.3×").*

**#12 · Heatmap comparativo ilegible: texto blanco sobre fondo pastel en los valores extremos** — Visual · S
heatClass asigna 'bg-success/15 text-success-foreground' y 'bg-destructive/15 text-destructive-foreground' a los mejores/peores valores del set — y ambos *-foreground son #FFFFFF. Texto blanco sobre verde/rojo al 15% = invisible. Verificado en pantalla: en "Detalle comparado" de /pauta-comparar las celdas extremas de Gasto, CPA y CTR ("140 BOB", "732 BOB", "9.06%") no se leen. Son exactamente los valores que deciden qué campaña escalar o cortar.
*Evidencia: src/features/pautaMaestro/comparar/HeatmapTabla.tsx:24,26 + src/index.css:36,39; screenshot comparar-full.png.*

**#13 · El scatter de eficiencia dibuja los anuncios SIN resultados como los más baratos** — Visual/Pautas · S
EficienciaChart mapea `x: costoPorResultado ?? 0`: un anuncio/campaña que gastó plata y no produjo NI UN resultado tiene CPA null → se plotea en x=0, la posición que la propia leyenda define como "← más barato" y el comentario como "candidato a escalar". El peor desempeño posible aparece en el cuadrante de escalar, y además corre la mediana de referencia. Induce la decisión inversa a la correcta.
*Evidencia: src/features/pautaMaestro/comparar/EficienciaChart.tsx:62,76 (x: ?? 0), :101-102 (leyenda), :48-52 (comentario de cuadrantes).*

**#14 · Tesorería: un error del API (o una consulta rota) se muestra como "No hay vouchers esperando"** — Tesorería/Robustez · S-M
RelojTesoreria hace `if (!data || data.total === 0)` → tarjeta "No hay vouchers esperando confirmación". Si la query falla (tras el único retry), data es undefined y la pantalla afirma que la cola está vacía: no destructura isError y no hay ErrorBoundary. Y el estado vacío legítimo tampoco es distinguible de una consulta rota: dice "(o todavía no se sincronizó Cerberus — que no es lo mismo)" sin ofrecer forma de distinguirlo (ni fecha de última sync ni conteo del espejo). Este exacto modo de falla YA ocurrió: los JOINs usaban claves inexistentes (id_* en vez de codigo_*) y la bandeja devolvió lista vacía DESDE EL PRIMER DÍA con 12 pagos reales esperando (3 aún salvables) — post-mortem documentado en el propio archivo. Un falso "no hay nada" hace que Tesorería no confirme y las ventas se pierdan para el lazo.
*Evidencia: src/features/tesoreria/RelojTesoreria.tsx:63-67 (useQuery sin isError), :78-89 (vacío ambiguo); server/src/canales/tesoreria.ts:32-46 (post-mortem del bug 2026-07-16).*

**#15 · El flujo por defecto de responder puede publicar la promesa pública de un DM que nunca se escribió** — CRM · S
Cuando el privado es posible, el panel PREFILLEA el público con "Te acabamos de escribir por mensaje privado con toda la información 📩", pero el botón Enviar se habilita con solo el público (`disabled={!publico.trim()}`) y el privado arranca vacío. Si el ejecutivo aprieta enviar sin escribir el privado, el server recibe privado='' (no lo intenta, así que su guard de abortar no se dispara) y publica en público una promesa falsa bajo la marca del cliente — exactamente el incidente que el código dice haber aprendido. Es el camino de MENOR esfuerzo del usuario, no un caso raro.
*Evidencia: src/features/canales/ResponderPanel.tsx:22,64-68,86-88,240 + server/src/routes/responder.ts:57-62,121-130 (el guard solo aplica si el privado fue intentado y falló).*

**#16 · La ingesta de leads está muerta desde el 19-may y ningún endpoint lo dice** — Datos · M
leads: 680 filas, max(created_time)=2026-05-19 (~2 meses). sincronizaciones solo tiene filas 'cerberus' y 'pauta:90d' — la frescura de leads e interactions (max 2026-07-11) no se registra en ningún lado, y /api/overview/salud no tiene pieza 'leads'. La home sirve leads.total/sinContactar como estado actual del embudo cuando es una foto congelada de mayo: la estación LEAD del funnel miente por omisión.
*Evidencia: query en vivo: SELECT max(created_time) FROM leads → 2026-05-19; SELECT fuente FROM sincronizaciones → solo 2 filas; curl /api/overview/salud (piezas sin 'leads').*

**#17 · Home: $719.903 histórico en dorado gigante junto a cifras de 90 días, sin distinción visual** — Home · M
El número más grande y dorado de la pantalla (COMPRA $719.903, acumulado de siempre) convive con la card 04 COMPRA que dice "$118.479 en ventas" (90 días) y con un selector de período que solo aplica a parte de los números. El riel mezcla 4 ventanas temporales con la misma tipografía: 21 (decisiones del snapshot), 9 (ahora mismo), 680 (acumulado histórico), $719.903 (histórico), 107 (acumulado) — el propio comentario del código lo admite ("ventanas y sistemas distintos"); la única aclaración es una frase de subtítulo que nadie lee. Un director que mira el embudo con "7 días" activo cree que vendió $719.903 esa semana.
*Evidencia: src/features/home/FlujoEmbudo.tsx:14-19,52-113 + src/pages/HomePage.tsx:61-65; screenshots home-desktop-full.png, home-desktop.png, scratchpad/audit-home/home-fold-1440.png.*

**#18 · Mobile roto: la plata queda fuera de la pantalla** — Visual/Responsive · L
Todas las rutas tienen ancho mínimo real de ~484 px (542 px en /pauta-comparar) sobre viewport 390: paneo horizontal global. En /pauta-maestro solo se ven PAÍS/CURSO/CAMPAÑA — GASTO, RESULTADOS y COSTO/RESULTADO no existen para un usuario móvil (incluso al ancho completo de 484 px la tabla sigue cortada). En /tesoreria las columnas CLIENTE, MONTO y MÉTODO se cortan a mitad de letra (la tabla vive en un contenedor overflow-hidden SIN overflow-x-auto, a diferencia de PautaMaestroTable/HeatmapTabla que sí lo tienen): no se puede saber a quién llamar ni por cuánto. El header (marca + 4 links + tuerca) no colapsa: a 375 px scrollWidth medido 484 px, con "PAUTAS" y Configuración fuera de pantalla y sin menú hamburguesa; AppShell no tiene un solo breakpoint. Gerencia comercial vive en el teléfono.
*Evidencia: src/layout/AppShell.tsx:34-71 (sin breakpoint); medición document.scrollWidth=484 vs clientWidth=375; src/features/tesoreria/RelojTesoreria.tsx:202-210 (overflow-hidden sin overflow-x-auto); screenshots home-mobile.png (nav cortada), home-mobile-full.png, comercial-mobile-full.png, tesoreria-mobile-full.png (484px), pauta-maestro-mobile.png y pauta-maestro-mobile-full.png (484px), pauta-comparar-mobile-full.png (542px).*

---

## 6. Quick Wins

Arreglos puntuales identificados por los auditores como obvios, de bajo riesgo y alto retorno. Cada uno referencia el hallazgo que mitiga (no lo cierra necesariamente: varios P0 tienen además una raíz estructural en §7).

| QW | Arregla | Qué es | Evidencia | Prioridad/Esfuerzo |
|---|---|---|---|---|
| QW-01 | #2 #3 | salud() debe leer `ultimo_error` y validar `ultima_ok` contra el snapshot servible; reparar la fila `pauta:90d` envenenada (UPDATE puntual o que salud use `ultimoSnapshot()`) | server/src/canales/salud.ts:135-144; DB fila 13:34 | P0/S |
| QW-02 | #6 | Aplicar `RECOLETA_LIMPIA_SQL` (ya exportada) al where de /snapshots y /comparar | server/src/routes/pautaMaestro.ts:250-254,298-302; server/src/pauta/snapshot.ts:87 | P0/S |
| QW-03 | #4 | Mientras llega el arreglo estructural: si existe snapshot de OTRO rango, decir "la pauta se revisó con ventana 90d — mirala ahí" en vez de "Conecta las cuentas" + CTA "crear campaña" | src/pages/HomePage.tsx:138-150 | P0/S |
| QW-04 | #5 | Usar los inicio/fin ya calculados contra la serie, o quitar las pastillas de rango que no filtran | server/src/routes/pautaMaestro.ts:53-64 | P0/S |
| QW-05 | #9 | Conectar ConfiguracionPanel a useCuentasPauta + useGuardarCuentasPauta (ya escritos, con invalidación de overview incluida) | src/features/config/ConfiguracionPanel.tsx:22; src/lib/datos/overview.ts:236-257 | P0/S |
| QW-06 | #10 #14 | Estado de error explícito en DecisionFeed y RelojTesoreria ("no se pudo leer — reintentar") antes de caer al empty state; en el feed, bifurcar con snapshot:null → "falta revisar este rango" | src/features/decisions/DecisionFeed.tsx:38,65-87; src/features/tesoreria/RelojTesoreria.tsx:63-67 | P0/S |
| QW-07 | #12 | Cambiar text-success-foreground/text-destructive-foreground por texto oscuro en heatClass (los fondos al 15% ya comunican) | src/features/pautaMaestro/comparar/HeatmapTabla.tsx:24,26 | P0/S |
| QW-08 | #13 | Excluir CPA null del scatter (o banda aparte "sin resultados: X gasto" con marcador distinto) | src/features/pautaMaestro/comparar/EficienciaChart.tsx:62,76 | P0/S |
| QW-09 | #15 | Si puedePrivado y el público contiene la plantilla que promete DM, exigir privado no vacío (o cambiar a PLANTILLA_PUBLICA_SOLA al enviar) — condición en el disabled + validación en el server | src/features/canales/ResponderPanel.tsx:240; server/src/routes/responder.ts:57-62 | P0/S |
| QW-10 | #11 | Filtro de sanidad en detectar(): descartar plataEnJuego ≤ 0 y ratios con promedio < epsilon hasta arreglar la mezcla de indicadores | server/src/decisions/detectors.ts:290-306 | P1/S |
| QW-11 | #8 | Mientras llega USD: aviso "estás comparando BOB con USD — el ranking de CPA no es válido" al mezclar monedas; moneda por fila en "Todas las campañas" y sidebar del comparador; código de moneda en money() de la estructura | src/features/pautaMaestro/analisis.ts:82-91; src/features/campaigns/CampaignsTable.tsx:41-57; src/features/campaigns/efficiency.ts:29-30 | P1/S |
| QW-12 | #1 | Cross-link entre los dos detalles de la misma campaña con etiqueta de fuente ("snapshot de hace X h" / "Meta en vivo") — el campaignId ya es el mismo en ambas rutas | src/App.tsx:49,52; src/pages/PautaDetallePage.tsx:95-107 | P1/S |
| QW-13 | #16 | Registrar frescura de leads/interactions en sincronizaciones (2 filas al ingerir) + pieza 'leads' en salud | server/src/canales/salud.ts | P1/S |
| QW-14 | #38 #2 | Humanizar "revisado hace 1557 min" con el humano() que ya existe; frescura siempre en horas; ámbar/rojo cuando supere 2 ciclos del reloj (12-24 h); mostrar frescura también en /pauta-comparar (hoy ausente) y snapshot.edadMinutos + errores[] en el feed (ya llegan en el response; useRefrescarPauta ya existe) | src/pages/HomePage.tsx:143; src/features/home/BarraDeMando.tsx:34-39; src/pages/PautaMaestroPage.tsx:82-84; src/features/decisions/DecisionFeed.tsx:26-37; src/lib/datos/overview.ts:264-270 | P1/S |
| QW-15 | #30 | Línea ámbar "A MEDIAS ventas hace 4 días · interacciones hace 5 días" en la Barra de Mando y Math.max (o sello por pieza) en vez de Math.min | src/features/home/BarraDeMando.tsx:74-82 | P1/S |
| QW-16 | #32 | Dejar de descartar revisadoAt/edadMinutos en el route y mostrar "gasto revisado hace X" en el panel COMPRA | server/src/routes/overview.ts:100-101; src/features/home/RoasPorPais.tsx:121-141 | P1/S |
| QW-17 | #31 | "+ 21 países más" como botón expandible (o corte por % de gasto acumulado) | src/features/home/RoasPorPais.tsx:117-119,182-186 | P1/S |
| QW-18 | #27 | Calcular el marcador de concentración (índice real donde la suma acumulada cruza el umbral, % real en el texto); leer el p90 de "sin sede" de data.latencia.porSede; derivar "ninguna fue contactada" de /api/leads/stats.sin_atender | src/features/home/VentasPorPais.tsx:68-75; src/pages/ComercialPage.tsx:258-262; src/features/leads/LlegadaChart.tsx:49-53 | P1/S |
| QW-19 | #33 | generate_series en flujoPorDia (o relleno en front) + marca "sin datos desde el 11/07"; rellenar meses vacíos de la serie mensual | server/src/canales/verdad.ts:245-259; src/pages/ComercialPage.tsx:69-91 | P1/S |
| QW-20 | #34 | Links wa.me/tel:/mailto: en la fila del lead + PATCH /api/leads/:id/status + botón "contactado" | src/features/leads/LeadsInbox.tsx:88-99; server/src/routes/leads.ts | P1/M |
| QW-21 | #45 | "Ver más" que pida offset al servidor (el endpoint ya lo soporta); titular "680 leads, ninguno contactado" como KPI hero | src/features/leads/LeadsInbox.tsx:119-131; server/src/routes/leads.ts:80-93 | P1/S |
| QW-22 | #46 #49 | try/finally en enviar()/borrar() (resetear enviando, error visible) + mostrar res.errores también cuando type='enviado' | src/features/canales/ResponderPanel.tsx:77-114 | P1/S |
| QW-23 | #48 | horasRestantesMasUrgente por canal (un GROUP BY más) y cada reloj en su tarjeta | server/src/canales/verdad.ts:126-151; src/features/canales/BandejaCanales.tsx:180-182 | P1/S |
| QW-24 | #52 | ORDER BY por tramo en el aging (CASE/array_position, o sort fijo en front como ya hacen los segmentos LTV en cartera.ts:186-190) | server/src/analisis/cartera.ts:76-89 | P1/S |
| QW-25 | #55 | Sumar plata en riesgo al header del reloj ("se vencen N pagos por $X") — monto_usd está a un JOIN | src/features/tesoreria/RelojTesoreria.tsx:112-154; server/src/db/canonico.ts:182-186 | P1/S |
| QW-26 | #14 | Sello "espejo de Cerberus actualizado hace X min · N pagos totales" en el estado vacío del reloj | src/features/tesoreria/RelojTesoreria.tsx:78-89 | P1/S |
| QW-27 | #26 | Volver + link "por qué tardamos"→/comercial + voucher→/gente/:id en Tesorería | src/pages/TesoreriaPage.tsx:9-11; src/features/tesoreria/RelojTesoreria.tsx:249 | P1/S |
| QW-28 | #22 #23 | Mover rango/país/curso/búsqueda del maestro y ids/rango/métrica del comparador a useSearchParams (patrón ya existente en PautaDetallePage.tsx:47; 'vista' ya lo hace) | src/pages/PautaMaestroPage.tsx:27; src/pages/PautaCompararPage.tsx:54,107-116 | P1/S |
| QW-29 | #25 | Link "ver las campañas de este país" en RoasPorPais → /pauta-maestro?pais=X (depende de QW-28) | src/features/home/RoasPorPais.tsx:146-151 | P1/S |
| QW-30 | #40 | Fila de totales (por moneda) del filtro activo + orden default por gasto desc + números a la derecha con tabular-nums (también en CampaignsTable) | src/features/pautaMaestro/PautaMaestroTable.tsx:87,165,179-190; src/features/campaigns/CampaignsTable.tsx:41-57 | P1/S |
| QW-31 | #39 | Agregar patrones reales a REGLAS de curso.ts (las 74 campañas "Otro" están listadas) + diccionario chico accountName→país canónico antes de servir 'pais' | server/src/pauta/curso.ts:11-17; server/src/routes/pautaMaestro.ts:359 | P1/S |
| QW-32 | #59 | Propagar el rango del snapshot al link "Ver en «campaña»" (mapear al datePreset más cercano; structure ya acepta 'maximum') | src/features/decisions/DecisionCard.tsx:117-123; server/src/routes/structure.ts:6 | P1/S |
| QW-33 | #65 | Eje Y + tooltips en "EL TIEMPO" (Recharts ya instalado); deduplicar ticks de fecha (día único u hora si ventana <7d); "historial desde el 13 jul" cuando solo hay 3 días; formatter en la Legend para que el nombre no tome el color de la serie | src/pages/ComercialPage.tsx:69-91; src/features/pautaMaestro/CompararChart.tsx:60,77-83 | P1/S |
| QW-34 | #68 | Regla global `:focus-visible { outline: 2px solid var(--ring) }` + quitar el outline-none de GentePage | src/index.css:46; src/pages/GentePage.tsx:63 | P1/S |
| QW-35 | #70 | Rotular "pico: N/{día\|semana\|mes}" según el grano ya calculado | src/features/home/FlujoVentana.tsx:81,143 | P1/S |
| QW-36 | #64 | Espejar tb_usuario y tb_local (2 entradas en TABLAS + 2 lookups en proyectar): nombre de asesor y sede, habilita el ranking por asesor | server/src/fuentes/cerberus.ts:35-59 | P1/M |
| QW-37 | #7 | Exponer pauta_serie por REST (governa.pauta.serie ya agrupa por día/mes con moneda separada) | server/src/sdk/herramientas/historia.ts:118-171 | P1/S |
| QW-38 | #50 | Manejar isError de useOverview con mensaje + botón reintentar (hoy API caída = home en blanco) | src/pages/HomePage.tsx:45,70-76 | P2/S |
| QW-39 | #56 | Deshabilitar/etiquetar "aún manual" los botones de acciones no implementadas + confirmación antes de escribir en Meta | src/features/decisions/DecisionCard.tsx:139-150 | P2/S |
| QW-40 | #86 | Tooltip del score: "resultados 45% + CPA 35% + CTR 20%, relativo a las campañas seleccionadas" | src/features/pautaMaestro/Leaderboard.tsx:78; CompararTabla.tsx:43 | P2/S |
| QW-41 | #97 | Pasar la signal de react-query a api(): `({signal}) => api(ruta, {signal})` — una línea por query | src/lib/datos/cliente.ts:63-78 | P2/S |
| QW-42 | #100 | BandejaPage: compartir el rango del home (cache hit) o endpoint liviano de canales+accionable | src/pages/BandejaPage.tsx:19 | P2/S |
| QW-43 | #101 | Debounce ~250 ms + estado "sin resultados" en el buscador de Gente | src/lib/datos/gente.ts:37-43 | P2/S |
| QW-44 | #103 | Estado inicial de /gente con top clientes (buscarPersonas sin filtro ya ordena por compras DESC) | server/src/canales/persona360.ts:196-210 | P2/S |
| QW-45 | #102 | Buscar leads/gente por teléfono normalizando dígitos en ambos lados | server/src/routes/leads.ts:84-88; persona360.ts:198 | P2/S |
| QW-46 | #105 | Plantillas del mensaje privado por curso (select de snippets: fecha, precio, link) | src/features/canales/ResponderPanel.tsx:206-217 | P2/M |
| QW-47 | #106 | Ocultar/deshabilitar el filtro "puedo-escribirle" donde nunca aplica, con la explicación que la página ya sabe dar | src/pages/CanalPage.tsx:63-67,218-234 | P2/S |
| QW-48 | #110 #114 | Export CSV de deudores completos (servir la lista entera, no LIMIT 10) + "ver los 159" bajo QUIÉN DEBE | server/src/analisis/cartera.ts:107-108 | P2/M |
| QW-49 | #111 | Escalar las barras del mix por USD con máximo real (elimina el desborde >100% latente) | src/pages/ComercialPage.tsx:218-220 | P2/S |
| QW-50 | #54 | Delta mes actual vs anterior junto a la serie ("julio va $19.989 vs $38.403 de junio") | src/pages/ComercialPage.tsx:61-66 | P1/M |
| QW-51 | #82 | Default de Volver a "Volver al inicio" o exigir props | src/layout/Volver.tsx:8; src/pages/LeadsPage.tsx:31 | P2/S |
| QW-52 | #1 | Desambiguar "Pautas" vs "Pauta" (p.ej. "Maestro de pautas" vs "decisiones de pauta") | src/layout/AppShell.tsx:61 vs src/pages/CampaignsListPage.tsx:28 | P2/S |
| QW-53 | #66 | Traducir etiquetas crudas de Meta ("Messaging conversation started 7d" → "Conversaciones iniciadas (7d)", "Mixed" → "Mixto") — texto de mapeo, no lógica | campanas-todas-desktop-full.png | P2/S |
| QW-54 | #92 | .toISOString() en el borde para fechas de SQL crudo; unificar rangoDe (borrar copias locales de overview/decisions) | server/src/canales/verdad.ts:89-109; server/src/lib/rangos.ts:21 | P2/S |
| QW-55 | #122 | title/tooltip en toda etiqueta truncada + ensanchar columnas de label del catálogo y medios de pago | comercial-desktop-full.png; cartera-desktop-full.png | P2/S |
| QW-56 | #61 | Link interno "Ver la estructura" → /campanas/:id en la pantalla final del wizard | src/features/campaigns/CampaignWizard.tsx:44-66 | P2/S |
| QW-57 | #136 | Sacar forecastVentas() y serieDiaria() del Promise.all (nadie los consume) o exponerlos de verdad | server/src/analisis/comercial.ts:314-326 | P3/S |
| QW-58 | #138 | Corregir pluralización generada, separador "revisar ahora · Ver qué hacer", y el doble '+' de fatiga | DecisionFeed.tsx:96; StructureTree.tsx:128; CreativeCards.tsx:78-80 | P3/S |
| QW-59 | #140 | lang='es' y título real en index.html | index.html:2,7 | P3/S |
| QW-60 | #141 #142 | Borrar la paleta muerta (usar CATEGORICAL[0] y CHROME.grid); unificar clave ['pauta-maestro','todo'] y ordenar ids en la clave de comparar | src/pages/PautaDetallePage.tsx:21,196; src/pages/PautaCompararPage.tsx:45,62-66 | P3/S |
| QW-61 | #146 | Reemplazar la columna "RELOJ DE META" repetida por teléfono/canal del cliente | tesoreria-desktop-full.png | P3/S |

---

## 7. Problemas estructurales

Problemas cuya causa no es un bug puntual sino un contrato, modelo o arquitectura ausente. Un quick win los mitiga; no los cierra.

### 7.1 Raíces estructurales de los P0 (detalle en §5)

- **#1 — Las dos jerarquías de pauta son dos productos dentro del mismo producto.** Cuatro superficies de lo mismo (/campanas "Todas" en vivo con DatePreset, /campanas "Qué hacer" snapshot con Rango, /pauta-maestro + /pauta-comparar snapshot con RangoFiltro, /campanas/:id en vivo con DatePreset) duplican lista, detalle, drill, fatiga y pickers, con números que no cuadran entre sí por ventana Y por fuente. Mientras existan dos rutas de detalle sin fuente única declarada, toda cifra de pauta es discutible. *Evidencia: src/App.tsx:47-53; src/layout/AppShell.tsx:56-62; src/pages/PautaMaestroPage.tsx:17-24 vs src/features/canales/RangoPicker.tsx:3-9 vs src/features/campaigns/constants.ts:23-29.*
- **#4 — El sistema rango↔snapshot está roto por diseño:** snapshots por clave de rango, pero solo el reloj de 90d corre; el picker ofrece claves que nunca existirán. Hay una decisión pendiente (snapshot único con ventanas derivadas / reloj que cubra todos los rangos / picker que solo ofrezca lo que existe) — el estado actual degrada la pantalla en silencio. *Evidencia: server/src/pauta/reloj.ts:14; server/src/routes/overview.ts:74.*
- **#7 — El modelo "graficar fotos acumuladas cada 6 h" no puede responder ninguna pregunta con eje de tiempo.** La materia prima correcta (pauta_serie, 37 meses, 3 niveles) ya existe y ninguna ruta de UI la consume; el diseño ya contempla que "el día de hoy lo trae el reloj". Es el desbloqueo de casi todas las preguntas de negocio pendientes (rangos reales, comparación de períodos, CPL en el tiempo, mejor creativo del mes). *Evidencia: server/src/pauta/backfill.ts:10-23; ventanas.ts:93; único lector server/src/sdk/herramientas/historia.ts:100.*
- **#8 — No hay sistema transversal de moneda.** El problema BOB/USD no se arregla celda por celda: requiere decidir normalización a USD con la tasa del negocio (el backend ya la usa en plataEnJuegoUsd, geoGasto y CostoPorLead; pauta_serie guarda a propósito sin convertir: "eso es análisis") o segmentación por moneda en toda tabla, orden, heatmap y eje. CampaignsDashboard ya lo hace bien para totales (spendByCurrency); /cartera ya declara la regla de tasa congelada. *Evidencia: server/src/pauta/backfill.ts:153; snapshot.ts:129; src/features/campaigns/CampaignsDashboard.tsx:70-78.*
- **#9 (+#90, #19) — El estado del equipo vive en el navegador.** El repo ya enunció la regla (estado del servidor → caché compartido; preferencias de UI → localStorage) y la violó tres veces: cuentas de pauta (la tuerca escribe localStorage), decisiones ignoradas (decisión de negocio que difiere por máquina y altera el total de "plata en juego") y el rango del home (parte del dato para dirección). Requiere modelar "config de equipo" en el servidor (la tabla y el endpoint de cuentas-pauta ya existen como precedente) y deprecar las claves con migración. *Evidencia: src/lib/datos/cliente.ts:14-19 (la regla) vs src/features/config/ConfiguracionPanel.tsx:22, src/features/decisions/DecisionFeed.tsx:19, src/pages/CampaignsListPage.tsx:19.*
- **#18 — No hay estrategia responsive.** El shell no tiene un solo breakpoint, no existe patrón tabla→cards ni columnas prioritarias, y los controles segmentados de 6 opciones desbordan. Para un tablero que dirección mira desde el teléfono, hace falta definir qué columnas sobreviven en móvil y una nav colapsable — no parches por página. *Evidencia: src/layout/AppShell.tsx:34-71; mediciones 484-542 px vs 390.*

### 7.2 Estructurales de navegación y estado

**#20 · El modelo de navegación sirve a un solo rol de los cinco** — Navegación · P1/L
El hub-and-spoke puro ("se sale del home y se vuelve al home", "arriba solo la marca y la tuerca") ya se rompió a medias: el header tiene 4 links (Comercial, Cartera, Gente, Pautas) — los analíticos — mientras las pantallas de trabajo diario (Bandeja del community, Leads de ventas, Tesorería, Campañas/decisiones) NO están en el header y solo se alcanzan desde cards del home. La tesorera o el ejecutivo pasan por el home en cada ciclo; dirección/BI necesita lateralidad (cruzar comercial↔pauta↔cartera sin pasar por el home). Falta decidir la navegación primaria completa (por rol o por tarea) e incluir Bandeja, Leads y Tesorería.
*Evidencia: src/layout/AppShell.tsx:8-16 (filosofía "arriba solo dos cosas") vs :28-62 (4 links analíticos); src/App.tsx:32-36 (rutas operativas huérfanas); scratchpad/cartera-snapshot.md:6-15.*

**#21 · No existe un contrato único de período** — Navegación · P1/L
Tres vocabularios (Rango '7d|30d|90d|1y|todo'; RangoFiltro 'hoy|7d|30d|mes|mesPasado|todo'; DatePreset 'last_30d…') en 5 pickers, cero propagación en el drill-down (home→maestro→detalle→estructura obliga a re-seleccionar en cada nivel; si no, se comparan ventanas distintas sin saberlo), la MISMA página /campanas mezcla dos sistemas según la pestaña, /comercial y /cartera no tienen selector, y ningún número agregado lleva badge de período (los KPIs del detalle no declaran ventana; las métricas all-time no se marcan "histórico"). Elimina de raíz el P0 #17 y las dos escalas de /campanas.
*Evidencia: src/features/canales/types.ts:51; src/features/pautaMaestro/types.ts:112; src/features/campaigns/types.ts:54; pickers en HomePage.tsx:42, PautaMaestroPage.tsx:17-27, PautaDetallePage.tsx:36-47, PautaCompararPage.tsx:21-28, CampaignStructurePage.tsx:10; campanas-todas-desktop.png; pauta-detalle-desktop-full.png.*

**#24 · El grafo de identidad no es la columna vertebral de navegación que podría ser** — CRM/Navegación · P1/L
Leads, interacciones de canales, vouchers de tesorería y deudores deberían resolver todos a /gente/:id — hoy solo Cartera lo hace. Las filas de LeadsInbox son divs sin link (para saber "¿esta persona ya compró?" hay que copiar el nombre y buscarlo a mano: 3 saltos + retipeo); el lead no queda anclado a persona (leads sin persona_id) aunque el grafo YA lo une por email/teléfono al construirse; el 360 no muestra ni el evento "llegó por el formulario de la campaña X" (campaignName/adName existen en `leads`) ni las interacciones de Meta. Cerrar esto convierte a /gente en la respuesta a "¿qué campaña trajo a este cliente que pagó $1.350?" — el payoff completo de la matriz.
*Evidencia: src/features/leads/LeadsInbox.tsx:69-111 (div sin Link) vs src/pages/CarteraPage.tsx:128-136 (único cruce); server/src/ontologia/poblarIdentidad.ts:114-123 (claims de leads sin ancla); server/src/canales/persona360.ts:98-140 (timeline sin evento lead); src/pages/GentePage.tsx:186-190; src/features/tesoreria/RelojTesoreria.tsx:249.*

### 7.3 Estructurales de la home y el análisis temporal

**#29 · La home no tiene capa de dirección** — Home · P1/L
"¿Por qué bajaron las ventas?", "¿qué canal tiene mejor ROI?", "¿qué asesor vende mejor?" no tienen respuesta en la pantalla principal: ningún KPI tiene comparación temporal, meta ni tendencia (sin delta vs período anterior, sin objetivo, sin sparkline — la home no puede decir si $719.903 es bueno ni si el ROAS 7,1× subió); el único gráfico temporal es de operación de community; la serie mensual de ventas existe en el backend (/api/overview/comercial) y solo la consume ComercialPage.
*Evidencia: src/features/home/FlujoEmbudo.tsx:52-113; src/features/home/RoasPorPais.tsx:123-141; server/src/routes/overview.ts:191-199 + src/pages/HomePage.tsx (sin uso de comercial).*

**#72 · El riel no es un embudo** — Home · P1/L
Mezcla unidades por etapa (21 campañas-decisiones, 9 conversaciones, 680 leads, $719.903 dólares, 107 eventos CAPI), los números CRECEN hacia abajo (21→680→6448), la etapa 4 es plata mientras el resto son conteos, y el rail gráfico es decorativo: no comunica conversión ni caída. "ENTRA 21" ni siquiera es una entrada: es la cantidad de decisiones pendientes de pauta. Las cards 01/03/05 de abajo repiten los mismos números del rail: media pantalla de redundancia. El propio código admite que dibujar conversión con estas ventanas "fingiría una conversión que no existe" — la respuesta honesta es construir la cohorte de UNA ventana (entradas → conversaciones → leads → ventas) con tasas entre etapas, no renunciar al embudo.
*Evidencia: src/features/home/FlujoEmbudo.tsx:13-23,68 (numero = decisiones.length); home-desktop-full.png; scratchpad/audit-home/home-fold-1440.png.*

**#79 · El puesto de trabajo del community y el tablero de análisis están mezclados** — Home · P2/L
La bandeja de respuestas, "la puerta cerrándose" y "qué escribe la gente" son el puesto de trabajo del community; el ROAS, decisiones y costo por lead son análisis de dirección. En el mismo bento, cada audiencia scrollea por encima de la mitad que no le sirve, y la jerarquía actual (operación 2/3 del ancho, plata 1/3) contradice al usuario declarado del sistema.
*Evidencia: src/pages/HomePage.tsx:85-129 (CONVERSA col-span-8 vs COMPRA col-span-4); home-full2-1440.png.*

**#54 · Comercial y cartera son 100% acumulado histórico: el área responde "¿cuánto?" pero nunca "¿mejoró?"** — Comercial · P1/L
/comercial y /cartera ignoran el parámetro rango del BFF; embudo, mix, latencia, sedes, bundles, medios de pago, segmentos LTV y "fuera de ventana" (116 pagos de TODA la historia, sin poder ver si el problema es de este mes o de 2024) son acumulados totales. Las sub-rutas usan ventanas fijas (24 meses/120 días) y el payload no declara la ventana de cada bloque (acumulados e intervalos conviven sin marca — no se autodescribe). Imposible responder "¿este mes vs el anterior?", "¿la mora creció?", "¿la latencia mejora tras las acciones?".
*Evidencia: server/src/routes/overview.ts:197-208 (handlers sin rango), :80-87,103-137; server/src/analisis/comercial.ts:51,92-99,130-139,228.*

### 7.4 Estructurales de datos e ingesta

**#42 · El puente lead→venta no está materializado: sin ROAS por campaña, el área de pautas juzga solo por costo** — Pautas/Datos · P1/L
Todas las piezas existen y nadie las cruza: leads trae adId/campaignId, identidades tiene tipo lead_id, el grafo une persona↔cliente↔venta. Falta la atribución (venta.campaignId derivada + reglas de ventana/multi-touch) para tener ROAS por campaña y creativo, tiempo lead→venta y tasa de conversión por anuncio. FilaPauta y PautaDetalle no tienen ningún campo de revenue; "Resultados" son leads/acciones de Meta, no ventas de Cerberus. Hasta entonces "¿qué campaña perdió plata?" sigue sin respuesta y los veredictos de escalar/pausar se toman a ciegas del lado del ingreso. Es LA capacidad que separa este dashboard de un espejo de Ads Manager, y requiere decisiones de diseño de atribución, no solo un join.
*Evidencia: server/src/db/schema.ts:82-88; server/src/db/ontologia.ts:111-124; src/features/pautaMaestro/types.ts:1-13; server/src/routes/pautaMaestro.ts:75-87; ausencia total de ROAS por campaña en analisis/.*

**#43 · La ingesta no es un pipeline: dumps manuales, webhook que nunca llegó, relojes in-process, scripts muertos** — Datos · P1/L
webhooks_recibidos tiene 0 filas y la última ingesta de Cerberus es del 2026-07-13: toda venta nueva es invisible para el lazo hasta el próximo dump manual — y la ventana CAPI es de 7 días: el retraso de ingesta consume la ventana que el sistema existe para no perder. index.ts:34 promete "Cerberus manda cada venta acá → Meta, en vivo" y la base demuestra que ese flujo nunca ocurrió. Leads/interacciones se ingieren por scripts sueltos (muertos desde mayo/julio, ver #16); los relojes son in-process sin persistencia de jobs ni reintentos. Ojo: antes de activar el webhook hay que cerrar el Lote A (§2.4 — dispara Purchase reales sin compuerta ni dedup).
*Evidencia: query: webhooks_recibidos=0; sincronizaciones.cerberus.ultima_ok=2026-07-13; server/src/index.ts:34,58-66; scripts/ingestLeads.ts manual.*

**#74 · La jerarquía de pauta (campaña/adset/ad/creativo) no existe como entidades: vive dentro del jsonb del snapshot** — Datos · P1/L
La decisión "no modelamos la jerarquía hasta que haya una pregunta" (operacion.ts:35-38) ya venció: comparar, fatiga, engagement y el detalle por campaña son preguntas vivas que se responden buscando por id dentro de blobs jsonb de 129 campañas, sin historia consultable ni identidad de creativo transversal a campañas. pauta_serie ya da el eje temporal; faltan las entidades dimensionales para joinearlo.
*Evidencia: server/src/db/operacion.ts:29-56; server/src/routes/pautaMaestro.ts:244-286 (find sobre jsonb por snapshot).*

**#39 · País, curso y sede son heurísticas sobre strings, no dimensiones administradas** — Pautas/Datos · P1(P2 raíz)/L
país = accountName crudo (el filtro ofrece "Goberna PE" Y "Goberna Perú" como países distintos, más "México Alternativo", "GOBERNA MEXICO"/"GOBERNA MX", "Goberna Uruguay"/"Uruguay Goberna", "goberna chile"); curso = 5 regex que dejan 74/116 campañas (y 23/36 con gasto) en "Otro" — "CPL por curso" es imposible con 2/3 del dinero en una bolsa sin nombre; el 74% de las ventas está "sin sede". Sin una tabla de mapeo mantenida (cuenta→país canónico; campaña→curso con override manual; asignación de sede), los filtros y la columna PAÍS seguirán mintiendo.
*Evidencia: server/src/pauta/curso.ts:1-24; server/src/routes/pautaMaestro.ts:359; curl Counter({'Otro': 74, 'Consultor': 21, 'Libros': 16, …}) y paises ['Goberna PE','Goberna Perú',…]; campanas-todas-desktop-full.png; pauta-maestro-desktop-full.png; comercial-desktop-full.png (LAS SEDES).*

**#38 · La frescura/confiabilidad del dato no tiene contrato de primera clase** — Transversal · P1/M
Cada superficie la resuelve a su manera: la barra con Math.min, la ficha en minutos crudos ("hace 1557 min"), DecisionesPendientesCard en horas, el ROAS sin nada, salud con una ultima_ok envenenable, el maestro con "25 h 57 min" en texto gris sin alarma, /pauta-comparar sin frescura EN ABSOLUTO, el feed ignorando snapshot.edadMinutos y errores[] que ya llegan en el response. Dado que el bug histórico del producto es exactamente "dato viejo/roto presentado como vivo", la frescura merece un componente y un contrato de API únicos (fuente, edad, última corrida ok/fallida, confiabilidad) que toda card consuma — generalizar el patrón pauta.edadMinutos.
*Evidencia: src/features/home/BarraDeMando.tsx:80-82 vs src/pages/HomePage.tsx:143 vs server/src/routes/overview.ts:100-101 vs server/src/canales/salud.ts:135-144; src/pages/PautaMaestroPage.tsx:9-15,82-84; src/features/decisions/DecisionFeed.tsx:26-42 vs types.ts:41-46.*

**#47 · Tres definiciones divergentes de "ventana/accionable" producen números contradictorios en la misma pantalla** — CRM · P1/M
verdad.ts define DENTRO_DE_VENTANA sin restricción de canal (incluye Instagram); consultas.ts e interactions.ts definen VENTANA_ABIERTA solo-Facebook (interactions.ts la DUPLICA localmente pese a que consultas.ts existe para tener una sola definición); VENTANA_META además da 24 h a los mensajes. Consecuencias visibles: la tarjeta de Instagram en /bandeja dice "N esperan respuesta" pero la cola con el filtro default "Les puedo escribir" no muestra ninguno; loCerrado cuenta como cerrados TODOS los mensajes nuevos mientras flujoPorDia cuenta los <24 h como abiertas — el mismo mensaje es cerrado y abierto en el mismo payload; el home dice "Quedan 9" (IG 4 + FB 5) y /bandeja con "Les puedo escribir" dice "5 en total". consultas.ts nació para esto ("si esas reglas cambian, cambian en un lugar") y la promesa está incumplida: consolidar la matriz canal×tipo×plazo en un módulo único que verdad/consultas/interactions/overview consuman. Sin esto, cada número nuevo del home nace con riesgo de contradecir a los demás. (Se solapa con la deuda conocida "verdad.ts tres definiciones", docs/12.)
*Evidencia: server/src/canales/verdad.ts:18,30-33,162-175 vs server/src/canales/consultas.ts:17,25 vs server/src/routes/interactions.ts:16,25; home-desktop-full.png vs bandeja-desktop-full.png (9 vs 5).*

**#92 · Contrato de API fragmentado** — Datos · P2/M
Cuatro formatos de error ({type,message} vs {type,errors:[]} vs {type} sin mensaje vs {ok,motivo,detalle} del SDK; tipos en inglés vs motivos en español); el BFF filtra snake_case crudo al front (persona_nombre, occurred_at en bandeja e historial) mientras el resto es camelCase; fechas en formato Postgres crudo ("2026-07-13 03:22:55.289+00" — new Date() sobre eso es comportamiento no estándar) mezcladas con ISO en el mismo payload; el default de 'rango' cambia según la ruta (lib/rangos 'todo' vs overview/decisions '90d' con funciones locales duplicadas vs pautaMaestro que mapea 90d/1y→'30d' en silencio). Sin un envelope único (errores, camelCase, ISO, paginación, ventana y frescura declaradas), cada pantalla nueva del rediseño hereda los adaptadores ad-hoc.
*Evidencia: server/src/routes/overview.ts:142-155; server/src/routes/gente.ts:24; server/src/routes/sdk.ts:52-62; server/src/routes/decisions.ts:163-170; server/src/canales/verdad.ts:89-109; server/src/lib/rangos.ts:21-24 vs overview.ts:49-52 vs pautaMaestro.ts:346-349.*

**#95 · Todo el API y el SDK sin autenticación** — Datos · P2/L
Reconocido en el propio código ("cuando el server salga del portátil, esto va detrás de auth"). Aceptable hoy en localhost; bloqueante para el destino declarado (dirección, gerencia, ventas): cualquier proceso local lee PII de clientes y deudores y puede POSTear a Meta. Auth + roles (lectura vs acciones sobre pauta) es prerequisito de despliegue.
*Evidencia: server/src/routes/sdk.ts:29-31; server/src/index.ts:27 (cors abierto); /api/overview/cartera expone deudores con nombre.*

**#96 · Las transiciones de estado de venta se destruyen al pisar el payload** — Datos · P2/M
Cerberus no registra cuándo una venta se anuló/reembolsó (gap documentado en hechos.ts:37-51) y el espejo PISA el payload en cada re-ingesta (onConflictDoUpdate), destruyendo la única evidencia posible del cambio. Guardar el diff al pisar (o versionar el payload) habilitaría VentaAnulada/VentaReembolsada como hechos con timestamp honesto.
*Evidencia: server/src/db/hechos.ts:37-51; server/src/fuentes/cerberus.ts:85-93.*

**#64 · No hay identidad de operador ni dimensión asesor/sede: medio CRM es incontestable** — Datos/CRM · P1/L
No hay auth ni concepto de usuario: registrar() guarda la respuesta sin quién la envió; venta.vendedor existe en el espejo de Cerberus y ninguna consulta ni pantalla lo lee (grep sin SELECT ni UI); tb_usuario y tb_local no se espejan (las sedes se muestran como '2', '3'). "¿Qué asesor vende mejor?", "¿quién respondió a quién y en cuánto tiempo?" — preguntas de la misión — son imposibles hoy.
*Evidencia: server/src/routes/responder.ts:31-42; server/src/db/canonico.ts:105-107 + server/src/ontologia/proyectar.ts:160; server/src/fuentes/cerberus.ts:35-59 (13 tablas, sin tb_usuario/tb_local); curl /api/overview/comercial → sedes '2','3'.*

### 7.5 Estructurales del CRM y la operación

**#35 · Dos mundos de lead desconectados** — CRM · P1/L
El formulario (LeadsPage: temperatura, sin acciones, orden por fecha) y el comentario pide-info (BandejaPage: reloj de ventana, con acciones) viven en pantallas, lenguajes y colas distintas. El negocio los trata como lo mismo ("la diferencia es de formato, no de intención", dice el propio código) pero la UI no: el formulario —el lead más caliente, con teléfono entregado— está ausente de la bandeja de urgencia. Requiere una cola única con ciclo nuevo→contactado→convertido/descartado y una prioridad que combine ventana de Meta y frescura del formulario.
*Evidencia: server/src/routes/interactions.ts:104-107 (formularios como canal) vs src/features/canales/BandejaCanales.tsx:33-57 (solo IG/FB/WA); src/pages/LeadsPage.tsx.*

**#107 · Sin asignación ni concurrencia en la bandeja multi-ejecutivo** — CRM · P2/M
No existe "lo estoy trabajando yo": dos ejecutivos pueden abrir el mismo comentario y responderle dos veces (el status pasa a 'contactado' recién después del envío exitoso). Tolerable con un operador; colisión garantizada con el equipo comercial que la misión describe.
*Evidencia: server/src/routes/responder.ts:38-42 (única transición, post-envío); src/features/canales/Bandeja.tsx (sin dueño de conversación).*

**#108 · La bandeja del canal no agrupa por conversación ni marca spam** — CRM · P2/L
/canal/facebook lista cada mensaje suelto como fila ("Ok", "Si", "Confirma", "Muchas gracias" — la misma conversación) cada uno con su botón "Abrir chat": 25+ botones idénticos por página; spam evidente (link de temu.com) y un teléfono crudo como mensaje aparecen sin marcar; no hay acciones masivas ni "dar por atendido". Requiere agrupar por persona/conversación con estados de atención y reconciliar los conteos entre home, /bandeja y /canal/:red (ver #47).
*Evidencia: canal-facebook-desktop-full.png; bandeja-desktop-full.png.*

**#53 · La promesa lookalike no tiene ninguna acción detrás** — Cartera · P1/L
El panel dice "el plumbing ya existe (SHA-256) — falta tu visto bueno para subirla", pero no existe botón, flujo, export ni código de creación/upload de Custom Audiences en el server (solo lectura de audiencias existentes y asignación de targeting; el hasheo del lazo es para eventos CAPI). Si dirección da el "visto bueno", no pasa nada. El flujo real (selección de segmentos → export hasheado o creación vía Graph API con aprobación humana, respetando DECISIONES_MODO y la autorización pendiente de docs/07) no está diseñado ni construido — la "Ola 2" termina en un párrafo azul.
*Evidencia: src/pages/CarteraPage.tsx:244-256 vs server/src/routes/audiences.ts:48 (solo GET) y server/src/routes/adsets.ts:134-137 (solo targeting); grep custom_audience → sin código de creación.*

**#114 · La cobranza es una vitrina, no un módulo operable** — Cartera · P2/L
Hay 180 cuotas en mora ($14.312) y la pantalla muestra 6 nombres read-only (el server manda top 10, la UI corta a 6, orden solo por saldo — el deudor con 146 días de mora aparece quinto): sin total de deudores, sin "ver todos", sin orden monto×edad, sin filtros por tramo, sin estado de gestión (contactado/promesa/incobrable), sin export. Nadie puede ejecutar la cobranza desde acá.
*Evidencia: src/pages/CarteraPage.tsx:107-146,111 (slice(0,6)); server/src/analisis/cartera.ts:94-109 (LIMIT 10, ORDER BY saldo); cartera-desktop-full.png.*

**#62 · El wizard escribe en Meta en cada paso y solo un camino funciona** — Campañas · P1/L
Cada paso escribe inmediatamente en Meta con estado en useState: abandonar/refrescar en el paso 2-3 deja campañas y conjuntos huérfanos pausados, sin retomar, sin limpiar y sin paso atrás (los PASOS son divs sin onClick). Para todo optimizationGoal ≠ LEAD_GENERATION el server arma promoted_object con pixel_id:'undefined' (no hay selector de píxel): "Ventas" es imposible de crear; Tráfico/Interacción/Reconocimiento mandan 'undefined' a Meta; cada intento fallido deja basura en la cuenta. AdStep sin imágenes es un callejón sin salida ("Subí una desde Ads Manager y volvé" — pero al volver el estado se perdió y la campaña+conjunto ya existen). Y el wizard escribe SIEMPRE: DECISIONES_MODO=simulacion no lo gobierna (mitigado porque nace PAUSED, pero el CLAUDE.md promete "nada se escribe en Meta"). Requiere creación diferida con review final o draft persistido con reanudación y detección de huérfanos, y decidir si la simulación gobierna la creación.
*Evidencia: src/features/campaigns/CampaignWizard.tsx:32-44,74-110; server/src/routes/campaigns.ts:228-280 (POST sin guard de modo); server/src/routes/adsets.ts:100-114; src/features/campaigns/AdsetStep.tsx:27-77 (sin estado pixelId); src/features/campaigns/AdStep.tsx:72-75.*

**#63 · /api/decisions/aplicar ejecuta lo que diga el body** — Campañas · P1/L
Confía en la accion del cliente: en modo ejecución pausa CUALQUIER lista de IDs (accion.objetivos) sin verificar que correspondan a una decisión real del snapshot, sin identidad de quién lo pidió (el evento guarda payload pero no usuario), sin vigencia (puede aplicarse horas después sobre un estado que cambió); el comentario promete "deshacer y auditar" pero solo guarda el payload del cliente. Hoy lo salva la simulación; es prerrequisito duro para prender DECISIONES_MODO=ejecucion: re-derivar la decisión en el server por decisionId, validar vigencia contra datos frescos, registrar quién, guardar el estado anterior real.
*Evidencia: server/src/routes/decisions.ts:104-160 (objetivos del body, insert sin usuario).*

**#58/#11/#60 (raíz común) · Detectores conscientes de unidad y moneda, con deduplicación por campaña** — Campañas · P1/L
Toda comparación de CPR debe exigir mismo resultIndicator (y structure.ts no debe sumar results de indicadores distintos); todos los umbrales (GASTO_MINIMO_RELEVANTE, 1.5×) deben evaluarse en USD; las oportunidades solapadas de una misma campaña deben fusionarse en una decisión con una sola plata en juego; y las dos lógicas de "plata sobre la mesa" (banner de estructura vs detectores) deben ser una. Sin esto el total del feed seguirá siendo una cifra que dirección no puede citar.
*Evidencia: server/src/decisions/detectors.ts:76-77,96-135,163,175-212,239-274,290-306; server/src/routes/structure.ts:108-133; src/features/campaigns/efficiency.ts:37-50.*

**#37 (raíz) · El score necesita referencias absolutas por curso/país** — Pautas · P2/M
Un score min-max relativo a la selección nunca será interpretable ni estable: cambia con cada campaña agregada y produce veredictos absurdos con sets chicos o parejos. La referencia natural del negocio es el CPA objetivo por curso/país o el histórico propio de la campaña (pauta_serie): "estás 30% por encima de tu CPA de los últimos 30 días" es accionable; "score 38 contra estas otras 2" no.
*Evidencia: src/features/pautaMaestro/analisis.ts:55-57,76-95,168-176.*

### 7.6 Estructurales del sistema visual y el front

**#67 · Dos lenguajes visuales de superficie sin capa de componentes base** — Visual · P1/L
No existe src/components: cada feature re-implementa card, botón, tab, input, badge, tabla y empty-state. Conviven la generación "barra navy" (styles.ts: cardClass rounded-2xl + header bg-navy texto blanco — LeadsInbox, PautaMaestroTable, CampaignsDashboard, CostoPorLeadCard) y la generación "eyebrow + riel" (Panel/PanelFaena/FichaEstado, rounded-xl, riel de color inset — Home, Comercial, Cartera, Gente), con radios, sombras y encabezados opuestos: el producto se ve como dos apps pegadas. Extraer primitivas (Card/Panel, SegmentedControl, Table con alineación numérica, Badge, EmptyState, ErrorState, Skeleton) con estados hover/focus/disabled es la condición para que cualquier rediseño no herede la fractura.
*Evidencia: src/lib/styles.ts:1-8 vs src/pages/ComercialPage.tsx:23-49 vs src/features/home/PanelFaena.tsx:17-47 (tres contenedores para el mismo rol).*

**#115 · Tokenizar de verdad: TEMP/GOLD/META_BLUE duplicados a mano en 9+ archivos y dos dorados de texto** — Visual · P2/M
`const TEMP = {...}` copiado literal en BarraDeMando, FlujoEmbudo, FichaEstado, RoasPorPais, PanelFaena, Creativos, GentePage, CarteraPage y ComercialPage; GOLD_INK='#B58900' (5 archivos) difiere del token --gold-ink #CAA106 de index.css — dos "oros de texto" en el mismo producto — y #CAA106 además ES temp-tibio: "dinero" y "dato enfriándose" comparten color según la pantalla. Los tokens ya existen en CSS y los SVG resuelven var() (chartPalette lo demuestra).
*Evidencia: grep 'const TEMP' → 9 archivos; src/pages/ComercialPage.tsx:20, CarteraPage.tsx:20, GentePage.tsx:28, FlujoEmbudo.tsx:201, VentasPorPais.tsx:23 (#B58900) vs src/index.css:53 (--gold-ink #CAA106).*

**#118 · El semáforo heatmap se aplica a toda métrica: la señal reservada se volvió textura** — Visual · P2/M
HeatmapTabla colorea cada celda de cada columna (gasto, CTR, CPM, frecuencia…) con el divergente verde/rojo, incluso métricas donde "más" no es ni bueno ni malo: con 8 columnas coloreadas, la alerta real no destaca — contradice la regla "estado reservado a veredicto" que el propio chartPalette declara. Falta definir cuándo una tabla merece heatmap y cuándo basta ordenar.
*Evidencia: src/features/pautaMaestro/comparar/HeatmapTabla.tsx:15-28 aplicado a 8 columnas en Rankings.tsx:8-17 vs chartPalette.ts:45.*

**#71 · La mitad del front vive fuera de la capa de datos, y no hay patrón de estados** — Robustez · P1/L
~12 fetch crudos con useEffect+useState (leads api.ts, decisions api.ts, campaigns api.ts completo con 10 endpoints, persona/link, puede-privado, historial, canal-stats, structure, audiences): sin caché (hub-and-spoke = refetch total al volver), sin cancelación (races reales, #98), sin errores tipificados. Es la mitad de la app fuera del sistema que cliente.ts declara "la única puerta al servidor". Migrarlos revive las claves huérfanas y la invalidación muerta (#99). Junto con esto: un ErrorBoundary por ruta y un patrón único de tres estados (skeleton dimensionado → error con causa y reintento → vacío honesto) — hoy cada pantalla improvisa y la mayoría omite el error (#50, #117).
*Evidencia: grep fetch( → 22 llamadas fuera de cliente.ts: src/features/leads/api.ts:5,16; src/features/decisions/api.ts:5,15; src/features/campaigns/api.ts:22-97; src/features/canales/ResponderPanel.tsx:51,82,104; src/pages/CanalPage.tsx:99; src/features/campaigns/StructureTree.tsx:179; src/features/campaigns/AudiencePicker.tsx:33; grep ErrorBoundary/Suspense = 0.*

**#123 · El naming poético impide orientarse (y encontrar)** — Producto · P2/M
El nav dice COMERCIAL pero la página se titula "Lo que Cerberus siempre supo"; /tesoreria se titula "Vouchers esperando" mientras la sección rotulada TESORERÍA (cobranza, medios de pago) vive en /cartera; el detalle de campaña se llama "Las tres etapas"; "La matriz", "El riel", "La puerta cerrándose". Simpático la primera vez, impuesto cognitivo la décima — y sin nombres findables, la consolidación del mundo pauta (#1, #20) no puede comunicarse.
*Evidencia: comercial-desktop-full.png; tesoreria-desktop-full.png; campana-detalle-desktop.png.*

**#65/#110 (raíz común) · Sistema de visualización unificado con export** — Visual/Comercial · P2/L
Serie mensual, mix, sedes, aging e histograma son divs artesanales con title= como único tooltip y sin ejes, cada panel con su propia gramática, y ningún dato sale de la pantalla (cero export en el área). Recharts ya está en el stack y se usa en 4 archivos. Los charts necesitan además tooltip táctil y aria (4 usos de aria en toda la app).
*Evidencia: src/pages/ComercialPage.tsx:69-91,215-283; src/features/tesoreria/RelojTesoreria.tsx:297-329; grep export → 0.*

**#121 (nota) · Code splitting por ruta** — Robustez · P2/M — El chunk único de 1.014 KB (296 KB gzip, warning de Vite) se descarga entero para abrir el home; Recharts/react-table solo se usan en pauta. React.lazy por ruta + Suspense bajaría el chunk inicial a menos de un tercio; va junto con los skeletons (#117) para matar el layout shift.
*Evidencia: npx vite build → index-CKOhSXxZ.js 1.014,04 kB / gzip 295,79 kB.*

---

## 8. Tabla maestra de prioridades

Los 146 hallazgos únicos (fortalezas excluidas), ordenados P0→P3. La columna Evidencia lista las referencias primarias; la evidencia completa fusionada está en la sección donde cada hallazgo se detalla (§5 para P0; §4 debilidades; §7 estructurales; §6 mapea los quick wins). Prioridad = la más alta asignada por cualquier auditor. Esfuerzo: S/M/L.

| # | Hallazgo | Área | Prioridad | Esfuerzo | Evidencia |
|---|---|---|---|---|---|
| 1 | Dos jerarquías paralelas para la misma campaña (live vs snapshot), números distintos (111 BOB vs 120,37), sin puente ni etiqueta de fuente | Pautas/Navegación | P0 | L | StructureTree.tsx:179 + routes/structure.ts:2 vs PautaDetallePage.tsx:100; DecisionCard.tsx:118 vs PautaMaestroTable.tsx:41; App.tsx:47-53; pauta-detalle-desktop-full.png vs campana-detalle-desktop.png |
| 2 | Frescura falsa hoy: salud "ok · hace 7 h" sobre corrida con 26 cuentas caídas; lo servido tiene 26 h | Home/Datos | P0 | M | canales/salud.ts:135-144; pauta/snapshot.ts:164-178; DB fila 13:34 n_camp=0 n_err=26; /salud edad 438 vs pauta.edadMinutos 1553 |
| 3 | 7/10 recolectas fallaron y la UI no lo dice (errores[] siempre vacío; salud no lee ultimo_error) | Home/Pautas | P0 | M | snapshot.ts:87; DecisionesPendientesCard.tsx:80,103-108; salud.ts:135-144; DB 7/10 filas con 14-34 errores |
| 4 | Sistema rango↔snapshot roto: 4/5 rangos degradan media home con copy falso ("Conecta las cuentas" + CTA crear campaña) | Home | P0 | M–L | reloj.ts:14; overview.ts:74; HomePage.tsx:138-150; curl rango=30d → pauta:null; DB solo rango='90d' |
| 5 | Filtros de rango del maestro decorativos: hoy = 7d = todo (mismo gasto 7.119,93) | Pautas/API | P0 | S | routes/pautaMaestro.ts:53-64,346-354; curl ?rango=hoy vs ?rango=7d idénticos |
| 6 | La serie histórica sirve snapshots ROTOS: desplomes falsos en "Evolución en el tiempo" | Pautas/API | P0 | S | routes/pautaMaestro.ts:250-254,298-302 vs snapshot.ts:87-91; curl /snapshots?rango=7d (puntos 0/1/12 campañas) |
| 7 | "Evolución" = acumulados de ventana móvil mezclados; pauta_serie (37 meses, 96.131 filas) sin un solo consumidor de UI | Pautas/Datos | P0 | L | reloj.ts:14; decisions.ts:81-83; backfill.ts:10-23; único lector sdk/herramientas/historia.ts:100 |
| 8 | BOB/USD/COP mezclados en score, ranking, orden, heatmap, ejes y tablas de todo el módulo pauta; "Todas las campañas" sin moneda por fila | Pautas/Visual | P0 | M–L | analisis.ts:82-91; PautaCompararPage.tsx:74; Rankings.tsx:9-16; PautaMaestroTable.tsx:53-77; CampaignsTable.tsx:41-57; efficiency.ts:29-30; maestro.png; campanas-todas-desktop-full.png; campanas-crop-orden.png |
| 9 | Dos fuentes de verdad para las cuentas de pauta: la tuerca escribe localStorage que el job/feed/home no leen; useGuardarCuentasPauta sin usuarios | Campañas/Estado | P0 | M | ConfiguracionPanel.tsx:22; lib/datos/overview.ts:236-257; snapshot.ts:35-43; CampaignsListPage.tsx:19,55 vs HomePage.tsx:46,189; decisions.ts:42-44 |
| 10 | Error del server o rango sin snapshot pintado como "la pauta está sana" (vacío verde con 0 campañas) | Campañas/Robustez | P0 | S | DecisionFeed.tsx:38,66-87; decisions/api.ts:8-11; routes/decisions.ts:46-57; curl rango=7d → snapshot:null |
| 11 | Detectores mezclan indicadores de resultado: "USD -8 en juego", "1109.5×/750.3× contra 0.00" publicados en producción y sumados/restados del total | Campañas | P0 | M | detectors.ts:175-212; structure.ts:110-133; campanas-desktop-full.png (refs f10e430/f10e272/f10e432) |
| 12 | Heatmap comparativo ilegible: texto blanco sobre pastel en los valores extremos (los que deciden escalar/cortar) | Visual | P0 | S | HeatmapTabla.tsx:24,26; index.css:36,39; comparar-full.png |
| 13 | Scatter de eficiencia plotea CPA null en x=0, la posición "más barato": el peor caso en el cuadrante de escalar | Visual/Pautas | P0 | S | EficienciaChart.tsx:62,76,101-102,48-52 |
| 14 | Tesorería: error del API o consulta rota = "No hay vouchers esperando" (modo de falla que ya ocurrió meses, post-mortem en el archivo) | Tesorería/Robustez | P0 | S–M | RelojTesoreria.tsx:63-67,78-89; canales/tesoreria.ts:32-46 |
| 15 | El camino por defecto de responder puede publicar la promesa pública de un DM que nunca se escribió | CRM | P0 | S | ResponderPanel.tsx:22,64-68,86-88,240; responder.ts:57-62,121-130 |
| 16 | Ingesta de leads muerta desde el 19-may; sin fila en sincronizaciones ni pieza en salud: la estación LEAD miente por omisión | Datos | P0 | M | SELECT max(created_time) FROM leads → 2026-05-19; sincronizaciones solo 2 filas; /salud sin pieza leads |
| 17 | Home: $719.903 histórico en dorado junto a cifras de 90 días; el riel mezcla 4 ventanas con la misma tipografía | Home | P0 | M | FlujoEmbudo.tsx:14-19,52-113; HomePage.tsx:61-65; home-desktop-full.png; home-fold-1440.png |
| 18 | Mobile roto: min-width 484–542 px sobre viewport 390; GASTO/MONTO/CLIENTE fuera de pantalla; nav sin colapsar; tesorería en overflow-hidden sin scroll-x | Visual/Responsive | P0 | L | AppShell.tsx:34-71; scrollWidth 484/375; RelojTesoreria.tsx:202-210; home-mobile.png; pauta-maestro-mobile-full.png; tesoreria-mobile-full.png; pauta-comparar-mobile-full.png |
| 19 | Rango del home en localStorage compartido por 3 pantallas: vista no reproducible/compartible + acoplamiento invisible entre dominios | Navegación | P1 | M | HomePage.tsx:41-42; CanalPage.tsx:85; DecisionFeed.tsx:18 |
| 20 | Navegación primaria para un solo rol: header promueve 4 analíticas y esconde Bandeja/Leads/Tesorería (rutas huérfanas) | Navegación | P1 | L | AppShell.tsx:8-16 vs :28-62; App.tsx:32-36 |
| 21 | 5 pickers de período, 3 vocabularios (Rango/RangoFiltro/DatePreset), cero propagación en el drill-down; /campanas mezcla dos sistemas por pestaña | Navegación | P1 | L | canales/types.ts:51; pautaMaestro/types.ts:112; campaigns/types.ts:54; HomePage.tsx:42; PautaMaestroPage.tsx:17-27; CampaignStructurePage.tsx:10 |
| 22 | El maestro pierde rango, filtros y búsqueda al volver del detalle (flujo más castigado: 116 campañas) | Navegación | P1 | S | PautaMaestroPage.tsx:27; PautaMaestroTable.tsx:87-89 |
| 23 | El comparador no persiste selección/rango/métrica en la URL (solo 'vista'): el link compartido llega vacío | Navegación | P1 | S | PautaCompararPage.tsx:48-57 vs :107-116 |
| 24 | Leads/interacciones/vouchers no resuelven a la persona canónica; el 360 no dice de qué pauta vino (lead sin persona_id) | CRM | P1 | L | LeadsInbox.tsx:69-111 vs CarteraPage.tsx:129-131; poblarIdentidad.ts:114-123; persona360.ts:98-140; GentePage.tsx:186-190 |
| 25 | Los insights del home no drillean: RoasPorPais/Creativos/CostoPorLead sin camino a las campañas | Navegación | P1 | M | RoasPorPais.tsx:146-151; Creativos.tsx:41; verificado en vivo |
| 26 | Tesorería callejón sin salida: sin Volver, sin links internos, folio GOB-XXXXX en texto plano | Navegación/Tesorería | P1 | S | TesoreriaPage.tsx:9-11; RelojTesoreria.tsx:242-258,249; page-2026-07-16T20-54-49 |
| 27 | Datos hardcodeados en copy: "p90 64,8 días", "95% hasta acá" (real 65,3%), "Ninguna fue contactada" | Home/Comercial/Leads | P1 | S | ComercialPage.tsx:258-262; VentasPorPais.tsx:68-75; LlegadaChart.tsx:49-53 |
| 28 | Nodo A META/COMPRA verde hardcodeado mientras se pierde el 72% de las conversiones (273 vs 107) | Home | P1 | S | FlujoEmbudo.tsx:110; HomePage.tsx:169 vs salud.ts:78-84; vivo lazo.reportadas=107/perdidas=273 |
| 29 | La home no tiene capa de dirección: ningún KPI con delta/meta/tendencia; sin serie de ventas (existe en /api/overview/comercial) | Home | P1 | L | FlujoEmbudo.tsx:52-113; RoasPorPais.tsx:123-141; overview.ts:191-199 |
| 30 | Barra de Mando: piezas en 'atencion' invisibles; sello Math.min (la pieza más fresca enmascara); puntos fb/ig fingen conexión viva | Home | P1 | S | BarraDeMando.tsx:74-77,80-82,84-85,121-122; /salud en vivo |
| 31 | Cola del ROAS no expandible: "+ 21 países más" muerto; Bolivia (10% del gasto, "escalar") invisible | Home | P1 | S | RoasPorPais.tsx:117-119,182-186; vivo Bolivia idx 13 |
| 32 | El panel COMPRA no muestra la edad del gasto (el route descarta revisadoAt/edadMinutos) | Home | P1 | S | overview.ts:100-101; RoasPorPais.tsx:121-141 |
| 33 | Series con huecos dibujados contiguos (flujoPorDia sin generate_series; serie mensual con hueco de 6 meses); el gráfico principal termina el 11/07 sin señal | Home/Comercial | P1 | S | verdad.ts:245-259; FlujoVentana.tsx:122-127,160-168; ComercialPage.tsx:69-91; vivo flujo[-1]=2026-07-11 |
| 34 | Leads sin ciclo de vida: status nunca cambia (680/680 "sin contactar" eterno), sin acciones de contacto, 'convertido' jamás se setea | CRM | P1 | M | schema.ts:104; routes/leads.ts (solo GET); LeadsInbox.tsx:62-112; overview.ts:120 |
| 35 | Dos mundos de lead desconectados: formulario (sin acciones) vs comentario pide-info (bandeja) — el lead más caliente ausente de la cola de urgencia | CRM | P1 | L | interactions.ts:104-107 vs BandejaCanales.tsx:33-57; LeadsPage.tsx |
| 36 | Solo campañas ACTIVE: las pausadas/terminadas desaparecen; "qué campaña perdió plata" incontestable por diseño | Pautas | P1 | M | recolectar.ts:50-56; curl estados=['ACTIVE']; PautaMaestroPage.tsx:48-51 |
| 37 | Veredictos Escalar/Desperdicia sobre score min-max relativo al set con umbrales absolutos (la 2.ª de dos excelentes = "Desperdicia") | Pautas | P1 | M | analisis.ts:55-57,76-95,168-176 |
| 38 | La frescura no tiene contrato único ni alarma: 26 h en gris chico, /pauta-comparar sin frescura, feed ignora edadMinutos/errores[], 3+ formatos | Transversal | P1 | M | PautaMaestroPage.tsx:82-84; DecisionFeed.tsx:26-42 vs types.ts:41-46; HomePage.tsx:143; BarraDeMando.tsx:34-39 |
| 39 | Dimensiones sin curar: curso 64% "Otro" (74/116), país = cuenta cruda (dos Perú, "México Alternativo"), 74% de ventas sin sede | Pautas/Datos | P1 | L | curso.ts:11-17; pautaMaestro.ts:359; curl Counter y paises; campanas-todas-desktop-full.png; comercial LAS SEDES |
| 40 | Maestro plano: sin totales/tendencia/Δ/fatiga, números a la izquierda, orden default alfabético, TrendSpark sin uso | Pautas | P1 | M | PautaMaestroTable.tsx:27-77,87,112,165,183; spark.tsx:19-39; maestro.png |
| 41 | El detalle de campaña no responde "¿qué hago?": sin veredicto/presupuesto/benchmark; descarta CTR/CPC/CPM/frecuencia/engagement/miniatura que la API manda | Pautas | P1 | M | PautaDetallePage.tsx:221-263,239-241 vs types.ts:23-48 |
| 42 | Sin ingresos/ROAS por campaña en ninguna pantalla de pauta; puente lead→venta (atribución) sin materializar | Pautas/Datos | P1 | L | pautaMaestro/types.ts:1-13; routes/pautaMaestro.ts:75-87; schema.ts:82-88; ontologia.ts:111-124 |
| 43 | Webhook de Cerberus con 0 eventos recibidos; lazo sobre dumps manuales (último 13-07) consumiendo la ventana CAPI de 7 días; ingesta sin pipeline | Datos | P1 | L | webhooks_recibidos=0; sincronizaciones.cerberus=2026-07-13; index.ts:34,58-66 |
| 44 | ultimoSnapshot() sin rango sirve el último limpio de CUALQUIER rango: bomba semántica en el maestro | Datos | P1 | S | snapshot.ts:97-110; routes/pautaMaestro.ts:238,320,339 |
| 45 | Solo 200 de 680 leads alcanzables (limit+cap 200, "Ver más" client-side); el hallazgo central relegado a nota de sidebar | CRM | P1 | S–M | leads/api.ts:15; routes/leads.ts:80,93; LeadsInbox.tsx:119-131; leads-desktop-full.png |
| 46 | Éxito parcial reportado como total al responder (algoSalioBien = publico \|\| privado; res.errores ignorado) | CRM | P1 | S | responder.ts:142-150; ResponderPanel.tsx:93-98,169-176 |
| 47 | Tres definiciones de "ventana/accionable" → números contradictorios (IG "esperan" vs cola vacía; cerrado y abierto a la vez; home 9 vs bandeja 5) | CRM | P1 | M | verdad.ts:18,30-33,162-175 vs consultas.ts:25 vs interactions.ts:16,25; home vs bandeja screenshots |
| 48 | El reloj de urgencia de la tarjeta Facebook puede mostrar la urgencia de un comentario de Instagram | CRM | P1 | S | BandejaCanales.tsx:180-182; verdad.ts:126-151 |
| 49 | ResponderPanel sin try/catch: fallo de red = botón "Enviando..." congelado, sin saber si salió | CRM/Robustez | P1 | S | ResponderPanel.tsx:77-99,101-114 |
| 50 | Manejo de errores casi inexistente: 1 sola pantalla con isError, 0 ErrorBoundary, pantallas en blanco silenciosas | Robustez | P1 | M | grep isError → solo PautaMaestroPage.tsx:29,72; HomePage.tsx:70-76; grep ErrorBoundary → 0 |
| 51 | LeadsInbox/LeadsPage sin catch: "cargando..." eterno / sidebar que desaparece | Robustez | P1 | S | LeadsInbox.tsx:25-36; LeadsPage.tsx:25-27 |
| 52 | Aging de cobranza en orden aleatorio (sin ORDER BY): "91-180, +180, al día, 31-90, 1-30" en vivo | Cartera | P1 | S | cartera.ts:76-89; cartera-snapshot.md:41-56; cartera-desktop-full.png |
| 53 | La promesa lookalike no tiene ninguna acción detrás: "falta tu visto bueno" sin botón/flujo/código de upload | Cartera | P1 | L | CarteraPage.tsx:244-256; audiences.ts:48; adsets.ts:134-137; grep custom_audience |
| 54 | Comercial/cartera 100% acumulado histórico: sin comparación temporal (MoM/YoY), "fuera de ventana" sin tendencia, payload sin declarar ventanas | Comercial | P1 | L | overview.ts:197-208,80-137; comercial.ts:51,92-99,130-139,228 |
| 55 | Reloj de tesorería: BOB/PEN/USD en la misma columna sin normalizar; KPIs cuentan pagos pero nunca dicen $ en riesgo | Tesorería | P1 | M | RelojTesoreria.tsx:112-154,250-252; JSON vivo 12 pagos |
| 56 | Modo ejecución sin badge ni confirmación; botones prometen acciones que el server responde 400 no_implementado | Campañas | P1 | S | DecisionFeed.tsx:57-63; DecisionCard.tsx:139-150 vs decisions.ts:132-138 |
| 57 | Errores de red silenciados en el área campañas: api.ts sin res.ok (tabla vacía sin explicación), DecisionCard "Aplicando..." congelado | Campañas/Robustez | P1 | S | campaigns/api.ts:45-103; DecisionCard.tsx:83-97 |
| 58 | Total "en juego" mezcla plata cierta + heurístico 15% + extrapolaciones, doble-cuenta oportunidades solapadas; dos lógicas contradictorias de "plata sobre la mesa" | Campañas | P1 | M | detectors.ts:163,239-274,96-135 vs efficiency.ts:37-50; 3 tarjetas de la misma campaña en vivo |
| 59 | Decisión→estructura no conservan la ventana: tarjeta "57.01" vs estructura "62.59" para la misma campaña | Campañas | P1 | S | DecisionCard.tsx:117-123; CampaignStructurePage.tsx:10 |
| 60 | GASTO_MINIMO_RELEVANTE=20 en moneda cruda: US$20 en Perú, ~US$0.005 en COP — sesga qué decisiones existen por tipo de cambio | Campañas | P1 | S | detectors.ts:76-77,98,150,187,219 |
| 61 | Presupuesto tipeado descartado en silencio: NaN → campaña sin presupuesto; "10.000" → 10.00; front oculta el campo del conjunto | Campañas | P1 | S | campaigns.ts:257-263; CampaignStep.tsx:56; AdsetStep.tsx:65 |
| 62 | Wizard: solo Leads+Formulario funciona (pixel_id:'undefined' en el resto); escribe en Meta SIEMPRE (simulación no gobierna); huérfanos sin retomar ni paso atrás | Campañas | P1 | L | adsets.ts:100-114; AdsetStep.tsx:27-77; campaigns.ts:228-280; CampaignWizard.tsx:32-44,74-110; AdStep.tsx:72-75 |
| 63 | /api/decisions/aplicar ejecuta el body sin revalidación, sin identidad, sin vigencia, sin estado anterior real para deshacer | Campañas | P1 | L | decisions.ts:104-160 |
| 64 | Sin identidad de operador ni dimensión asesor/sede: vendedor proyectado sin consultas, tb_usuario/tb_local sin espejar, respuestas sin autor | Datos/CRM | P1 | L | responder.ts:31-42; canonico.ts:105-107; proyectar.ts:160; cerberus.ts:35-59; sedes '2','3' en vivo |
| 65 | Gráficos mudos en toda la app: sin eje Y ni valores (EL TIEMPO, puerta, llegada, histograma), tooltips title=, evolución vacía con eje "13 jul ×4" | Visual | P1 | M | ComercialPage.tsx:69-91,215-283; RelojTesoreria.tsx:297-329; FlujoVentana.tsx:175-180; pauta-detalle-desktop-full.png; comercial-desktop-full.png |
| 66 | Columna RESULTADOS compara indicadores heterogéneos como iguales, etiquetas crudas en inglés ("Messaging conversation started 7d", "Mixed") | Pautas | P1 | L | campanas-todas-desktop-full.png; pauta-maestro-desktop-full.png; structure.ts:110-133 |
| 67 | Dos lenguajes visuales de card (barra navy vs eyebrow+riel) sin capa de componentes base (no existe src/components) | Visual | P1 | L | styles.ts:1-8 vs ComercialPage.tsx:23-49 vs PanelFaena.tsx:17-47 |
| 68 | Cero estilos de focus en toda la app; --ring definido y jamás usado; outline-none sin reemplazo | Visual/A11y | P1 | S | index.css:46; GentePage.tsx:63; grep focus-visible → 0 |
| 69 | Contraste insuficiente sistémico: eyebrows 10 px navy/40-45 (~2.5:1), text-warning como texto (~2.2:1), metadatos de decisión a 9-10 px | Visual/A11y | P1 | M | ComercialPage.tsx:21; analisis.ts:174; CampaignsDashboard.tsx:120; FlujoEmbudo.tsx:186,198,210 |
| 70 | "pico: N/día" miente con grano semana/mes: "144/día" cuando 144 es máximo semanal (×7) | Visual | P1 | S | FlujoVentana.tsx:143,42-48,81; home-full.png |
| 71 | ~12 fetch crudos (22 llamadas) fuera de la capa react-query: sin caché, sin cancelación, sin errores tipificados | Robustez | P1 | L | grep fetch( → leads/api.ts, decisions/api.ts, campaigns/api.ts:22-97, ResponderPanel, CanalPage:99, StructureTree:179, AudiencePicker:33 |
| 72 | El riel no es un embudo: unidades mezcladas por etapa, números que crecen hacia abajo, sin tasas de conversión, cards espejo redundantes; "ENTRA 21" = decisiones pendientes | Home | P1 | L | FlujoEmbudo.tsx:13-23,68; home-desktop-full.png |
| 73 | Formato numérico bilingüe: coma y punto decimal mezclados en la misma página ("4136,18" y "233.42"; "$42.943" vs "$5920") | Visual | P1 | S | campanas-todas-desktop-full.png; campanas-crop-orden.png; home-desktop-full.png |
| 74 | La jerarquía campaña/adset/ad/creativo no existe como entidades: se busca por id dentro de blobs jsonb de 129 campañas, sin identidad de creativo transversal | Datos | P1 | L | operacion.ts:29-56; routes/pautaMaestro.ts:244-286 |
| 75 | El titular COMPRA pierde 279 ventas en silencio (6.448 vs 6.727 conocidas) | Home | P2 | S | FlujoEmbudo.tsx:53-54; vivo lazo.ventasConocidas=6727 |
| 76 | La línea de corte de ventana desaparece en el rango default 90d (grano semana): la vista por defecto pierde el mensaje central | Home | P2 | M | FlujoVentana.tsx:42-48,122-127; home-full2-1440.png |
| 77 | Panel creativos: 6/9 "sin texto", 3 sin miniatura — rectángulos grises con precios; tasa de fallo de extracción sin medir | Home | P2 | M | home-full2-1440.png; Creativos.tsx:55-66 |
| 78 | "Qué escribe la gente"/"Meta cerró" históricos totales, inmunes al rango (94.361 cerradas) | Home | P2 | S | overview.ts:76-78; vivo cerrado.total=94.361 |
| 79 | Puesto de trabajo del community (2/3 del ancho) mezclado con el tablero de plata (1/3) en el mismo bento | Home | P2 | L | HomePage.tsx:85-129; home-full2-1440.png |
| 80 | CanalPage siempre vuelve a '/': el loop bandeja→canal→bandeja expulsa al home en cada vuelta | Navegación | P2 | S | CanalPage.tsx:136; BandejaPage.tsx:33 |
| 81 | No existe ranking global de creativos navegable: la pregunta "¿qué creativo convirtió más?" exige saber en qué campañas buscar | Navegación/Pautas | P2 | M | PautaCompararPage.tsx:119-120; Creativos.tsx:33 |
| 82 | Default engañoso de Volver: "Volver a la bandeja" → '/' | Navegación | P2 | S | Volver.tsx:8; LeadsPage.tsx:31 |
| 83 | "Mes pasado" en la serie incluye snapshots del mes en curso (piso sin techo); _orden muerto | Pautas | P2 | S | routes/pautaMaestro.ts:25-45,250-253 |
| 84 | CTR/CPC/CPM promedios simples sin ponderar por impresiones (también en fatiga.ts y aplanarAdsets) | Pautas | P2 | S | analisis.ts:42-52,265-277; fatiga.ts:171-172 |
| 85 | veredictoCreativo "Escalar" con CTR≥1 hardcodeado y ciego al nivel de CPA | Pautas | P2 | S | CreativeCards.tsx:10-11 |
| 86 | El score se muestra sin explicación (pesos 45/35/20 solo en comentario; relatividad no declarada) | Pautas | P2 | S | analisis.ts:90; Leaderboard.tsx:71-79 |
| 87 | El reloj no corre al arrancar (primer snapshot a las 6 h) y nadie reintenta tras corridas rotas (26 h sin dato limpio) | Pautas | P2 | S | reloj.ts:44-47; curl edadMinutos:1555 |
| 88 | Multiselect del comparador: búsqueda solo por nombre, sin checkbox de grupo (curso/país entero = clic por clic entre 116) | Pautas | P2 | S | CampaignMultiSelect.tsx:17,51-91 |
| 89 | La estructura trunca adsets/ads a 50 sin aviso y pierde el gasto de anuncios borrados: no cuadra con Ads Manager | Campañas | P2 | M | structure.ts:77-81,93-110 |
| 90 | "Ignorar" decisiones: permanente, por navegador, invisible para el equipo; el total de plata difiere entre máquinas | Campañas/Estado | P2 | M | DecisionFeed.tsx:19,44; DecisionCard.tsx:151-157 |
| 91 | Dos rutas del camino de render llaman a Meta en vivo (structure, leads/costo con N llamadas), violando la regla del BFF | Datos | P2 | M | structure.ts:61-91; leads.ts:14-25; costoPorLead.ts:93-104 |
| 92 | Contrato de API fragmentado: 4 formatos de error, snake_case filtrado al front, fechas Postgres crudas, defaults de rango distintos por ruta | Datos | P2 | M | overview.ts:142-155; gente.ts:24; sdk.ts:52-62; verdad.ts:89-109; rangos.ts:21-24 |
| 93 | /snapshots y /comparar sin LIMIT: todos los snapshots del rango en memoria y al payload ('todo'=3650 días) | Datos | P2 | S | routes/pautaMaestro.ts:249-254,296-316 |
| 94 | Datos proyectados sin consumidor: vendedor/medioVenta/origenVenta, tb_matricula (1.758 filas), formId/formName | Datos | P2 | M | grep → solo derivarHechos.ts:91-92; cerberus.ts:58 |
| 95 | API y SDK sin autenticación, CORS abierto, PII de clientes/deudores expuesta a cualquier proceso local | Datos | P2 | L | sdk.ts:29-31; index.ts:27 |
| 96 | Transiciones de estado de venta destruidas: el espejo pisa el payload sin diff/versionado (anulaciones sin timestamp posible) | Datos | P2 | M | hechos.ts:37-51; cerberus.ts:85-93 |
| 97 | Cancelación con signal prometida en el docstring y no cableada en ningún queryFn | Robustez | P2 | S | cliente.ts:63; grep signal → 0 usos reales |
| 98 | Races reales en fetch crudos: LeadsInbox (debounce sin abort), HistorialPersona/QuePuedoHacer, CanalPage (bug ya documentado como arreglado en otro archivo) | Robustez | P2 | M | LeadsInbox.tsx:25-36; HistorialPersona.tsx:24-29; CanalPage.tsx:97-109 |
| 99 | Invalidación muerta ['canal'] (ninguna query usa esa clave) y claves huérfanas (canal, persona, cuentasMeta): contadores sin refrescar tras responder | Robustez | P2 | S | useInteracciones.ts:85; cliente.ts:93-96 |
| 100 | BandejaPage descarga el overview más pesado (375 KB / 0,49 s, rango 'todo') para 3 tarjetas, con clave distinta a la del home (doble descarga garantizada) | Robustez | P2 | S | BandejaPage.tsx:19; curl rango=todo = 375.765 bytes |
| 101 | Buscador de gente: un request por tecla sin debounce; sin estado "sin resultados"; 500 mostrado como "No encontramos a esa persona" | Robustez | P2 | S | gente.ts:37-43; GentePage.tsx |
| 102 | Búsquedas sin normalizar: leads no busca por teléfono (el dato principal del negocio); gente no normaliza teléfono ni acentos | CRM | P2 | S | leads.ts:84-88; persona360.ts:196-210; poblarIdentidad.ts:27-31 |
| 103 | /gente: página 80% vacía sin punto de partida (sin recientes, sin top clientes) | CRM | P2 | S | gente-desktop-full.png; persona360.ts:196-210 |
| 104 | Rebuild del grafo sin transacción: mientras corre, /api/gente sirve 360s rotos; si muere a la mitad, el estado roto persiste | CRM | P2 | M | poblarIdentidad.ts:148-238 |
| 105 | El vendedor responde sin contexto de curso/campaña y sin plantilla del mensaje privado (el que lleva fecha/lugar/precio) | CRM | P2 | M | ResponderPanel.tsx:22-24,145-149,206-217 |
| 106 | Filtro "puedo-escribirle" ofrecido en canales donde nunca matchea; el vacío culpa a los filtros | CRM | P2 | S | CanalPage.tsx:63-67,246-249; consultas.ts:25 |
| 107 | Sin asignación ni lock en la bandeja: dos ejecutivos pueden responder el mismo comentario dos veces | CRM | P2 | M | responder.ts:38-42; Bandeja.tsx |
| 108 | Bandeja del canal sin agrupar por conversación (25+ botones "Abrir chat" idénticos); spam (temu.com) sin marcar; sin acciones masivas | CRM | P2 | L | canal-facebook-desktop-full.png |
| 109 | KPIs del reloj de tesorería sobre muestra LIMIT 100: con cola >100 subcontaría urgentes/perdidos sin señal | Tesorería | P2 | S | tesoreria.ts:118,157-162 |
| 110 | Cero export en comercial/cartera/tesorería: deudores, serie y cola mueren en la pantalla | Comercial | P2 | M | grep csv\|exportar\|descargar → 0 |
| 111 | Barras del mix: ancho por unidades con ranking por plata (historia visual contradice el orden); desborde >100% latente | Comercial | P2 | S | ComercialPage.tsx:218-220 vs comercial.ts:76-79 |
| 112 | tasaCuotas mide stock vivo (estado 2 actual), no modalidad de pago: subestima el negocio a crédito que el copy anuncia | Comercial | P2 | S | comercial.ts:110; canonico.ts:90-98; ComercialPage.tsx:305-306 |
| 113 | Segmentos LTV excluyen clientes sin persona vinculada sin declarar cobertura (afecta también la "semilla lookalike") | Cartera | P2 | S | cartera.ts:156,180; CarteraPage.tsx:219-280 |
| 114 | Cobranza vitrina: 6 deudores visibles de 180 cuotas en mora; sin ver-todos, sin orden monto×edad, sin estado de gestión | Cartera | P2 | L | CarteraPage.tsx:111; cartera.ts:107-108 |
| 115 | Tokens duplicados a mano en 9+ archivos; dos dorados de texto (#B58900 vs --gold-ink #CAA106); "dinero" ≡ "dato tibio" | Visual | P2 | M | grep 'const TEMP' → 9 archivos; ComercialPage.tsx:20 vs index.css:53 |
| 116 | El mismo control segmentado en 4 variantes; el color de "activo" alterna navy/azul según la página | Visual | P2 | M | RangoPicker.tsx:35-40 vs PautaMaestroPage.tsx:60-65 vs MetricToggle.tsx:33-38 |
| 117 | Loading = texto plano sin skeletons: layout shift de pantalla completa en todas las páginas | Visual/Robustez | P2 | M | HomePage.tsx:70-74; PautaMaestroPage.tsx:79; RelojTesoreria.tsx:70-76 |
| 118 | Semáforo heatmap aplicado a las 8 columnas (incluso donde "más" no es bueno ni malo): la señal reservada se volvió textura | Visual | P2 | M | HeatmapTabla.tsx:15-28; Rankings.tsx:8-17 vs chartPalette.ts:45 |
| 119 | La paleta categórica cicla tras 5 series (idx % 5) pese al docstring "nunca se cicla"; el multiselect no limita | Visual | P2 | S | chartPalette.ts:42 vs :15-17 |
| 120 | A11y de interacción: sort solo con mouse (th onClick sin aria-sort), drawers sin focus trap ni Escape, pseudo-checkboxes sin estado | Robustez/A11y | P2 | M | PautaMaestroTable.tsx:162-173; PautaCompararPage.tsx:269-286; CampaignMultiSelect.tsx:62-78 |
| 121 | Bundle único de 1.014 KB (296 KB gzip) sin code splitting; Recharts/react-table descargados para abrir el home | Robustez | P2 | M | npx vite build → index-CKOhSXxZ.js 1.014 kB + warning |
| 122 | Truncamientos que hacen ítems indistinguibles: "Diploma internacional del ..." ×2, "Transferencia BC..." ×2, sidebar de leads 4/6 truncados | Visual | P2 | S | comercial-desktop-full.png; cartera-desktop-full.png; leads-desktop-full.png |
| 123 | Naming poético que impide orientarse: nav COMERCIAL ≠ título "Lo que Cerberus siempre supo"; la sección TESORERÍA vive en /cartera | Producto | P2 | M | comercial-desktop-full.png; tesoreria-desktop-full.png; campana-detalle-desktop.png |
| 124 | Semáforos con criterio opaco: Honduras 65.2× (mejor ROAS visible) única "OBSERVAR"; chips CARO/EFICIENTE sin umbral declarado | Home | P2 | S | home-desktop-full.png |
| 125 | Comparador: "ALERTAS 8" sin listar ni linkear; burbujas sin etiqueta; "3 seleccionadas" con checkboxes fuera de vista | Pautas | P2 | M | pauta-comparar-desktop-full.png |
| 126 | Params de URL casteados sin validar (as RangoFiltro/DatePreset): typos y vocabularios cruzados viajan directo a la API | Navegación | P3 | S | PautaDetallePage.tsx:47; CampaignStructurePage.tsx:10 |
| 127 | Back ad-hoc distinto de Volver en estructura y creación de campaña | Navegación | P3 | S | CampaignStructurePage.tsx:14-20; NewCampaignPage.tsx:8-14 |
| 128 | La búsqueda de Gente se pierde al volver del perfil (useState local): 3 homónimos = retipear 3 veces | Navegación | P3 | S | GentePage.tsx:50,202 |
| 129 | Metadatos de canal duplicados en 3 lugares y ya divergentes (WhatsApp con dos explicaciones distintas) | CRM | P3 | S | CanalPage.tsx:31-55 vs BandejaCanales.tsx:33-57 vs FilaInteraccion.tsx:5-9 |
| 130 | Anónimos de Instagram etiquetados "Usuario de Facebook" | CRM | P3 | S | ResponderPanel.tsx:127-133 |
| 131 | Campo custom "¿cuál_es_tu_cargo?" hardcodeado en server y front: un formulario nuevo deja el perfil vacío en silencio | CRM | P3 | S | leads.ts:70; LeadsInbox.tsx:66 |
| 132 | CanalPage no renderiza sin_atender ni ventana_abierta (los dos números más accionables que ya trae EstadoCanal) | CRM | P3 | S | CanalPage.tsx:164-185 vs canales/types.ts:20-30 |
| 133 | Decisiones aplicadas guardadas dentro del event store de ingesta (source='decision_applied' en events) | Datos | P3 | S | decisions.ts:146-153 vs schema.ts:14-24 |
| 134 | costoPorLead vive en routes/ y lo importa pauta/ (inversión de capas) | Datos | P3 | S | costoPorLead.ts:38; snapshot.ts:12 |
| 135 | diasMora puede salir negativo (max() de vencimientos futuros): "-12d de mora" | Cartera | P3 | S | cartera.ts:101 |
| 136 | Forecast (r²=0.002, regresión sesgada por días sin ventas ausentes) y serie diaria calculados en cada request y descartados por el front | Comercial | P3 | S | comercial.ts:258-301,314-326 vs lib/datos/comercial.ts:29-36 |
| 137 | Paneles numerados fuera de orden (01,02,03,05,06,04) y "cuatro cosas" con seis paneles | Comercial | P3 | S | ComercialPage.tsx:193-196,207-308 |
| 138 | Textos generados rotos: "21 decisiónes", "Incluye 1 públicos", "1 países", "revisar ahoraVer qué hacer →", "CTR ++30%" | Visual | P3 | S | DecisionFeed.tsx:96; StructureTree.tsx:128; DecisionesPendientesCard.tsx:83-99; CreativeCards.tsx:78-80 |
| 139 | Iconografía mixta: lucide + glifos unicode (●▲✕◌) + flechas de texto para el mismo significado | Visual | P3 | S | BarraDeMando.tsx:93-105 vs FichaEstado.tsx:90; BandejaCanales.tsx:153 |
| 140 | index.html con lang='en' y título genérico "meta-escuela" en una app 100% español | Visual | P3 | S | index.html:2,7 |
| 141 | Paleta muerta en PautaDetallePage (incluye el violeta descartado); grid hardcodeado #e5e7eb | Visual | P3 | S | PautaDetallePage.tsx:21,196 |
| 142 | Misma data bajo dos claves de caché (['pauta-maestro'] vs ['pauta-maestro','todo']); clave de comparar sensible al orden de ids | Robustez | P3 | S | PautaCompararPage.tsx:45,62-66 vs PautaMaestroPage.tsx:30 |
| 143 | ConfiguracionPanel confunde vacío con cargando (0 cuentas = "Cargando..." eterno); CampaignsDashboard con Promise.all sin catch (loading para siempre) | Robustez | P3 | S | ConfiguracionPanel.tsx:88-90; CampaignsDashboard.tsx:41-50 |
| 144 | Selector de cuentas duplicado que un comentario dice haber eliminado: tres UIs para el mismo ajuste | Campañas | P3 | S | CampaignsListPage.tsx:12-16 vs CampaignsDashboard.tsx:84-113 |
| 145 | Código muerto y features fantasma: ObjectivePicker/BudgetFields/CampaignResults sin imports; detector 'pais-sin-replicar' tipado y nunca producido; slice(0,11) de 15 países | Campañas | P3 | S | ObjectivePicker.tsx; DecisionCard.tsx:54-59 vs detectors.ts:290-298; AdsetStep.tsx:133-138 |
| 146 | Columna "RELOJ DE META" repetida 9 veces con el mismo texto en la cola de vencidas | Tesorería | P3 | S | tesoreria-desktop-full.png |

**Distribución:** P0 = 18 · P1 = 56 · P2 = 51 · P3 = 21 · **Total: 146 hallazgos únicos** (deduplicados de ~340 entradas de 10 auditores). Fortalezas a preservar: 31 (§3). Quick wins identificados: 61 (§6).




