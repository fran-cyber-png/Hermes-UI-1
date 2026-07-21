# Panel de contexto — diseño técnico (slices S8-S11)

> **Fecha:** 2026-07-21 · **Estado:** diseño aprobado; es el paso 2 del horizonte H1 de
> `plan-crm-definitivo.md`. Continúa la numeración de slices (S8+) y tests (T15+) de
> `plan-hermes-mvp.md` §6-7. Alcance decidido: **S8a-S8f en el MVP; Ivi solo F1**
> (F2/F3 y el webhook de Messenger quedan diseñados como S9-S11).

## 0. La idea en una frase

El contexto (la publicación, el anuncio, el curso) es una **entidad propia** (`contexts`), no un
atributo recortado del comentario: se proyecta desde la ingesta ampliada + un backfill acotado,
el curso se infiere con **fuentes ordenadas por confianza y siempre declaradas**, y se muestra en
la tercera columna — que deja de ser exclusiva de WhatsApp — sin inventar jamás lo que no se sabe.

## 1. Qué se pierde hoy (verificado en código)

- El panel derecho (`FichaContacto`) solo se monta si `canal === 'whatsapp'` (`src/App.tsx:90-94`).
- Messenger es un dead-end sin hilo (`ConversacionActiva.tsx:69-77`), aunque tiene PSID+nombre y
  las dos mitades de la conversación guardadas.
- La ingesta (`server/src/meta/interactionsIngestor.ts`) no pide `permalink_url`, attachments,
  `parent`, imagen del post ni `referral`; el texto del post se trae completo **y se descarta**
  (`slice(0,200)` → `contexto_texto`); en Messenger `contexto_texto` es `null` SIEMPRE (:140).
- La atribución que sí funciona (WhatsApp: `webhook/whatsapp.ts` → `whatsapp/origen.ts` →
  `meta/anuncio.ts` → `BadgeOrigen`) no tiene equivalente para comentarios/Messenger.

## 2. El modelo: tabla `contexts` + backfill que respeta el event store

**`contexts`** (proyección-cache **upsertable** por `(canal, contexto_id)`):
texto completo · permalink · imagen · attachments jsonb · curso + fuente de inferencia ·
anuncio/campaña (si atribuible) · `capturadoAt` · `fuenteCaptura` ('ingesta'|'backfill') ·
`intentoAt`/`error`.

Por qué el upsert es legítimo acá: es **proyección, no event store** — el repo ya muta
proyecciones (`permalink`, `puede_privado`, `status` en `interactions`). El event store no se
toca. La distinción crítica queda **en el modelo, no en la interpretación**:
- fila con `capturadoAt` e imagen `null` → "el post no tiene imagen" (se sabe);
- sin fila, o con `error` → "todavía no se capturó" (no se sabe — la UI lo dice así).

**El problema del `onConflictDoNothing`:** `guardar()` (:50-53) corta en el conflicto de
`events` — re-correr el ingestor con `fields=` ampliados **jamás rellena payloads viejos**.
Solución: **backfill aparte y acotado** (`npm run backfill:contextos`): para los `contexto_id`
referenciados por interacciones recientes (~90 días, configurable) sin fila en `contexts`, un GET
por post/media que guarda **un evento nuevo** `source='meta_post_fb'|'meta_media_ig'` (primera
observación de la publicación — append-only feliz, idempotente por post_id) + upsert de
`contexts`. Un post = una fila; no 94k updates. Posts borrados o sin permiso → fila con `error`,
no crash.

## 3. Ingesta ampliada (Graph API v25.0 — campos verificados)

| Pull | `fields=` a sumar | Nota |
|---|---|---|
| Comentario FB (:66-68) | `permalink_url, parent{id}, attachment` | `can_reply_privately` ya se resuelve aparte |
| Post FB (mismo pull) | `permalink_url, full_picture, attachments{media,media_type,url,title,description,subattachments}` | el `message` YA viene completo — dejar de recortarlo |
| IG media (:161-164) | `media_url, permalink, media_type, thumbnail_url, media_product_type` | `media_product_type=AD` = anuncio autodeclarado (señal gratis). Las URLs de CDN de IG **expiran**: cachear y refrescar on-demand como ya hace `permalink` |
| Messenger messages (:109-112) | `attachments, shares` | `sticker` ya NO existe en v25 — no pedirlo. `shares` puede traer la tarjeta del anuncio/post compartido (señal best-effort) |

**Veredicto de atribución Messenger (preciso, verificado):** por **polling NO es posible** saber
que una conversación vino de un anuncio. El `referral` (con `ad_id` + `ads_context_data`) llega
**solo por webhook**: el evento `messages` lo incluye en el PRIMER mensaje de un click-to-Messenger
(suscribiendo `messages` y `messaging_referrals`); `messaging_referrals` dispara cuando un hilo
existente se reabre vía anuncio/m.me. Eso es S11 (fuera del MVP). Mientras tanto la UI **no dice
"orgánico"** — dice nada (no se sabe).

Los dark posts (`is_published:false`) no aparecen en `/{page_id}/posts`: sus comentarios ni se
ingestan hoy. Futuro: edge `/{page_id}/ads_posts` (anotado, no en este plan).

## 4. La cadena "qué curso" (`server/src/contexto/`)

Módulo profundo nuevo. Fuentes por confianza — **cada inferencia declara su origen; sin
inferencia, el bloque curso NO se muestra**:

| # | Fuente | Cómo | Etiqueta en UI |
|---|---|---|---|
| 1 | Lo dijo la persona | fuzzy del texto del comentario/DM contra productos-cursos de Cerberus | "lo pidió en su mensaje" |
| 2 | El anuncio | join `contexto_id` ↔ `creative.effective_object_story_id` del último `pautaSnapshots` (`pauta/adjuntarCreativos.ts:18` ya lo captura — corre contra Postgres local, sin llamar a Meta) → `campaign.name` → `cursoDeCampana()` | "inferido del anuncio «X» · campaña Y" |
| 3 | El texto del post | fuzzy del texto/caption COMPLETO (recién disponible con S8a) | "inferido del texto de la publicación" |
| 4 | Nada | `null` | (silencio honesto) |

Reglas:
- **`cursoDeCampana()` se porta** de meta-escuela (`server/src/pauta/curso.ts`, uncommitted allá)
  con sus reglas EN ORDEN: seminario → consultoría → consultor → dipcpol|diplomado → libros.
  "Otro" (64% de campañas) **no infiere** — cae a la fuente siguiente.
- **Fuzzy honesto** (`matchProducto.ts`): normalizar (minúsculas, sin tildes), match por nombre
  completo o keywords distintivas del `nombre_producto`; umbral estricto; **empate entre dos
  productos → null** (mejor callar que adivinar).
- Productos: extraer `server/src/cerberus/productos.ts` del inline de `routes/venta.ts:27-46`
  (la costura Cerberus vive en `cerberus/`), cache en memoria TTL ~10 min; `venta.ts` la reusa.
- La resolución completa se **cachea en `contexts`**: se calcula una vez por publicación, no por
  comentario. Cobertura esperada honesta: ~30-40% con curso inferido — el número se reporta, no
  se disimula.

## 5. Hilo de Messenger (read-only) y por qué responder queda fuera

- `GET /api/messenger/conversacion/:personaId`: mensajes ASC con dirección/autor (la ingesta ya
  guarda las dos mitades desde `interactionsIngestor.ts:119-136`), + contexto asociado.
- `HiloMessenger` reemplaza el dead-end: burbujas read-only (extraer `BurbujaMensaje` de
  `HiloWhatsapp` o versión liviana), **caja deshabilitada honesta con motivo** ("Meta solo permite
  responder dentro de las 24 h; este hilo tiene N días — abrilo en Business Suite") + deep-link
  `https://business.facebook.com/latest/inbox/all?asset_id={page_id}`.
- **Responder queda FUERA** (ya lo cortó `plan-hermes-mvp.md` §6): la ventana estándar es 24 h y
  casi todo el backlog está vencido; `HUMAN_AGENT` (7 días) exige App Review. Se rediscute con S11.

## 6. La UI: `PanelDerecho` + des-modalizar `ResponderPanel`

`App.tsx:88-94` deja de condicionar la tercera columna a WhatsApp:
`PanelDerecho` = conmutador — WhatsApp → `FichaContacto` (intacta) · comentario/Messenger →
`PanelContexto` (misma columna 296px). **Prerrequisito:** `ResponderPanel` deja el overlay
`fixed` (:118-120) y se monta en la columna central como `HiloWhatsapp` (el plan §3 ya lo pedía).

```
┌─ CONTEXTO ──────────────── 296px ─┐
│ Nombre / @usuario · canal         │
├───────────────────────────────────┤
│ COMENTÓ EN                        │
│ [imagen del post si hay]          │
│ "Texto completo, line-clamp +     │
│  ver más"                         │
│ Ver en Facebook ↗                 │   sin fila contexts → "la publicación
├───────────────────────────────────┤   todavía no se capturó" (honesto)
│ CURSO                             │
│ [chip navy] Diplomado             │   bloque SOLO si hay inferencia;
│ Inferido del anuncio «X» ·        │   la fuente SIEMPRE visible;
│ campaña «[JUL] DIPLOMADO 25»      │   dorado prohibido (no es tiempo)
├───────────────────────────────────┤
│ YA TE HABÍA ESCRITO (3)           │   HistorialPersona reusado
├───────────────────────────────────┤
│ [IVI — S9, fuera del MVP]         │
└───────────────────────────────────┘
```

Estados del panel (filosofía `FichaContacto`): cada dato distingue **"no vino" / "no se capturó
todavía" / "la API falló"**. Jamás "no figura" cuando en realidad no se pidió.

## 7. Ivi (F1 en el MVP; F2/F3 diseñados)

- **F1 (MVP = S8):** el panel determinista ES la ayuda: publicación + curso + fuente + historial.
  Sin LLM, sin dependencias de red más allá de Graph/Cerberus.
- **F2 (S9):** botón "Preguntale a Ivi". Contrato verificado en
  `meta-escuela/goberna-kos/ivi/server.py`: `POST /api/chat {message, session, contexto}` con
  **cap server-side de `contexto` a 800 chars** (server.py:392), `503` legible si Ollama no está,
  `GET /api/health`. SIEMPRE vía proxy de hermes-server (`POST /api/ivi/preguntar`,
  `requiereVendedora`, `IVI_URL` en env — el renderer jamás habla con Ivi directo: sin auth +
  tailnet). `session = hermes:<vendedoraId>:<claveConv>`, timeout 60 s. Degradación honesta en
  3 estados: sin `IVI_URL` → el bloque no se renderiza; timeout/red → "Ivi no está disponible
  ahora (la máquina puede estar apagada) — el contexto de arriba sigue valiendo"; 503 → el
  mensaje que Ivi ya manda legible. Ley I intacta.
- **F3 (S10):** tools read-only `goberna.atencion.*` (cola pendiente, tiempos de respuesta,
  embudo comentario→WA→venta) en el registro SDK propio (`server/src/sdk/registro.ts` +
  `routes/sdk.ts`, ya montado con Ivi anticipada en `index.ts:65-66`). El cableado del lado Ivi
  es del repo meta-escuela. ADR corto al implementarlo.

## 8. Slices y tests (rojo → verde; gates estilo §6)

| Slice | Entrega | Tamaño | Test rojo | Gate |
|---|---|---|---|---|
| **S8a** Ingesta ampliada + `contexts` | Tabla en `schema.ts` (+`db:push`) · `fields=` ampliados en los 3 pulls · `proyectarContexto()` pura · upsert desde el ingestor | Mediano | **T15** post completo → fila con texto entero+permalink+imagen; sin imagen → `capturadoAt` presente e imagen null; IG VIDEO → thumbnail; `media_product_type=AD` → marca anuncio | `ingest:interactions` real muestra `contexts` pobladas; doble corrida idempotente; tests+typecheck verdes |
| **S8b** Backfill histórico | `scripts/backfillContextos.ts` (+npm script): candidatos = contextos recientes sin fila; evento nuevo + upsert; tolera borrados | Chico | **T16** elige solo faltantes en ventana; re-corrida → vacío | Backfill real reporta cobertura N/M (+K con error); re-correr = 0 trabajo |
| **S8c** Inferencia de curso | `contexto/{curso,matchProducto,atribuirAnuncio,inferirCurso}.ts` + `cerberus/productos.ts` extraída; persistido en `contexts` | Mediano | **T17** reglas+orden de `cursoDeCampana` ("Diplomado Consultor"→Consultor; "Otro"→null) · **T18** fuzzy con/sin tildes; empate→null · **T19** mensaje>anuncio>post; salida siempre con `fuente`; sin datos→null | Script dev sobre N contextos reales reporta % inferido por fuente (~30-40% esperado, honesto) |
| **S8d** API del panel | `routes/contexto.ts`: `GET /api/contexto/:interactionId` + `/conv/:canal/:personaId` → `{publicacion, curso\|null, historial}`; `GET /api/messenger/conversacion/:personaId`; composición pura `armarContexto()` | Chico | **T20** sin fila → `capturado:false` (jamás "sin imagen"); con curso → fuente obligatoria | `curl` contra dev con un comentario real: JSON completo y honesto |
| **S8e** UI panel + des-modalizar | `ResponderPanel` a columna central · `features/contexto/PanelContexto.tsx` (+Bloques) · `PanelDerecho` en `App.tsx` | Grande | (gate visual) | Screenshots Playwright desktop+angosto: comentario con imagen+texto+curso con fuente; comentario sin inferencia (sin chip, sin mentir) |
| **S8f** Hilo Messenger | `HiloMessenger` read-only + caja deshabilitada con motivo + deep-link; muere el dead-end | Mediano | **T21** (agrupado por día/dirección si se extrae lógica; si no, gate visual) | Screenshot: hilo con las dos mitades + panel al lado + caja honesta |
| **S9** Ivi F2 | `contexto/ivi.ts` + proxy `routes/ivi.ts` + `BloqueIvi` | Mediano | **T22** contexto ≤800 chars, prioriza curso+campaña · **T23** sin `IVI_URL`→no-configurado; timeout→no-disponible; 503→passthrough | Demo doble: Ivi viva responde / geógrafo apagada degrada honesto. Screenshots de ambos |
| **S10** Ivi F3 | `goberna.atencion.*` en SDK + ADR | Mediano | — | ADR aprobado |
| **S11** Webhook Messenger | `messages`+`messaging_referrals` (patrón `webhook/firma.ts`) → referral como evento | Grande | — | Referral de un click-to-Messenger real capturado |

**Orden:** S8a → (S8b ∥ S8c) → S8d → S8e → S8f → [S9-S11 después]. Cada slice cierra con
refactor + code-review. SSE: los upserts de `contexts` emiten por el bus existente
(`server/src/realtime/bus.ts`) — el panel se refresca solo.

## 9. Riesgos declarados (se dicen en la UI, no se disimulan)

- Cobertura de atribución: ~31% FB (RG-005), 0% Messenger por polling (hasta S11), dark posts
  fuera. El panel calla donde no sabe; jamás inventa "orgánico".
- El snapshot de pauta solo adjunta creativos de anuncios **con gasto en el rango** → la
  atribución se declara "sobre pauta con gasto".
- URLs de imagen de IG expiran → refresh on-demand (patrón `permalink`).
- Nombres largos de productos Cerberus vs fuzzy → umbral estricto + empate→null.
- latin1 NO aplica acá (nada de esto viaja hacia Cerberus).
