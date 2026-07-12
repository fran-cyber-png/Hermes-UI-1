# Ontología + columnas vivas — diseño

> Fecha: 2026-07-11 · Estado: **aprobado por secciones en brainstorming** (pendiente revisión final del doc)
> Alcance: capa de personas (Ontología v1), estados de atención como eventos, regla de archivo,
> sincronización estructurada, y el dashboard de columnas vivas por canal.

## 1. El problema

meta-escuela ya captura todo lo que entra por Meta (event store con **94.371 interacciones**:
76.869 mensajes de Messenger, 14.736 comentarios de Facebook, 2.766 de Instagram, más 680
leads de formularios). Pero:

1. **No hay personas, hay interacciones.** "6.428 piden info" cuenta mensajes, no gente: una
   persona que escribió 5 veces cuenta 5. No existe una ficha que junte todo lo de alguien.
2. **El estado de atención no existe de verdad.** "Respondida" vive en el estado de React y
   muere al recargar. Dos personas atendiendo se pisan sin saberlo. No queda registro.
3. **El backlog paraliza.** 1-2 personas no pueden contactar a ~28.000. Un contador gigante de
   pendientes no es un sistema de trabajo, es una acusación.
4. **La pauta se revisa en vivo al cargar la página** (19 cuentas contra Meta, ~2 minutos,
   riesgo de rate limit). La revisión debe ser un snapshot guardado, no una consulta por visita.
5. **La ingesta es manual.** Sin corrida programada no hay "en vivo" posible.

## 2. Hechos que mandan (verificados, no supuestos)

### Identidad disponible por fuente

| Fuente | Volumen | Identidad | Personas distintas |
|---|---|---|---|
| FB Messenger | 76.869 msj | 100% PSID | ~27.909 |
| IG comentarios | 2.766 | ~100% IG user id | ~1.689 |
| Leads (formularios) | 680 | email + teléfono | ~670 |
| FB comentarios | 14.736 | **~99% anónimos** (Meta oculta identidad) | 31 identificadas |

No existe **ninguna clave común entre fuentes** (PSID ≠ IG id ≠ email): la unificación
entre canales no puede ser automática en v1. Solo se fusiona por claves duras.

### Las ventanas de Meta (cierran las puertas por nosotros)

- Respuesta privada a comentario: **7 días**, un solo intento, solo texto.
- Retomar Messenger con tag `HUMAN_AGENT`: **7 días**, solo agente humano.
- Sponsored Messages (pago): solo interacciones de los **últimos 6 meses**.
- Escribir en frío a PSIDs del histórico: **prohibido** (cold DM blasting → riesgo de ban).
- Custom Audience de "engaged users": lookback máximo **365 días** → el destino real del
  backlog es retargeting publicitario, no conversación.
- DMs de Instagram: bloqueados hasta pasar App Review (prerequisito externo, fuera de alcance).

### Evidencia de la investigación (2026-07-11, engram `meta-escuela/investigacion/triage-backlog`)

- Speed-to-lead: responder en minutos multiplica ×21 la calificación del lead; el 63% de las
  empresas nunca responde. La urgencia además es técnica: la ventana de Meta expira.
- Ninguna herramienta seria (Front, Intercom, Zendesk, respond.io) vacía backlogs: separan cola
  activa curada de archivo oculto, cierran en masa por filtro, y miden % de lo reciente.
- Reactivar una base conocida convierte 3-4× mejor que leads fríos nuevos: los 680 leads con
  email/teléfono (única identidad **sin** ventana de Meta) son el activo más barato.

## 3. Decisiones de diseño

1. **Proyección en Postgres, reconstruible** (no base de grafo, no vistas materializadas).
   La verdad vive en el event store; las proyecciones se pueden rehacer desde cero. Cero infra
   nueva. Un grafo se podrá proyectar DESDE esta capa si algún día una consulta lo pide.
2. **El semáforo mide lo accionable, nunca el histórico.** La regla de archivo aplica las
   ventanas de Meta automáticamente; lo archivado se muestra como audiencia (activo), no deuda.
3. **La UI solo lee Postgres.** Meta se consulta por detrás (ingesta programada, snapshots).
   Ninguna pantalla dispara llamadas a Meta al cargar.
4. **Todo destino final es esta plataforma**: icarus, goberna-crm, goberna-dashboard y cerberus
   se migrarán adentro. El modelo de identidades debe absorber fuentes nuevas (whatsapp, email)
   como tipos nuevos, sin remodelar.
5. **Fuera de alcance v1**: entidad Venta (siguiente incremento, cuando se conecte la fuente),
   fusiones manuales desde UI (el modelo las soporta; la pantalla llega después), automatización
   comment-to-DM (piso 2, requiere app publicada), SSE tiempo real (v1 usa polling 30 s),
   DMs de Instagram (App Review pendiente).

## 4. Modelo de datos

```sql
-- Quién es quién. El id es estable: las URLs /persona/:id no se rompen nunca.
CREATE TABLE personas (
  id            bigserial PRIMARY KEY,
  nombre        text,                    -- el mejor nombre conocido (display)
  origen        text NOT NULL,           -- fuente que la creó: 'lead' | 'messenger' | 'ig' | 'fb'
  creado_at     timestamptz NOT NULL DEFAULT now()
);

-- Cada clave conocida de una persona. Fuentes futuras = tipos nuevos, sin remodelar.
CREATE TABLE persona_identidades (
  id            bigserial PRIMARY KEY,
  persona_id    bigint NOT NULL REFERENCES personas(id),
  tipo          text NOT NULL,           -- 'email' | 'telefono' | 'psid' | 'ig_user' | 'fb_user'
  valor         text NOT NULL,
  UNIQUE (tipo, valor)
);

-- Auditoría de fusiones: por qué dos personas pasaron a ser una. Explicable y reversible.
CREATE TABLE persona_fusiones (
  id            bigserial PRIMARY KEY,
  ganadora_id   bigint NOT NULL,
  absorbida_id  bigint NOT NULL,
  motivo        text NOT NULL,           -- ej: 'lead 123: telefono→A, email→B'
  creado_at     timestamptz NOT NULL DEFAULT now()
);

-- Vínculo de lo existente con su persona (nullable: los anónimos quedan NULL).
ALTER TABLE interactions ADD COLUMN persona_ref bigint REFERENCES personas(id);
ALTER TABLE leads        ADD COLUMN persona_ref bigint REFERENCES personas(id);

-- Estados de atención (proyección; la verdad son los eventos).
-- interactions.status pasa de texto libre a: 'nuevo' | 'en_proceso' | 'resuelto' | 'archivado'
-- leads.status: 'nuevo' | 'contactado' | 'frio' | 'convertido'

-- Configuración compartida del equipo (deja de vivir en localStorage).
CREATE TABLE configuracion (
  clave  text PRIMARY KEY,               -- ej: 'cuentas_pauta'
  valor  jsonb NOT NULL,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);

-- Snapshots de la revisión de pauta: la card lee esto, jamás a Meta en vivo.
CREATE TABLE pauta_snapshots (
  id            bigserial PRIMARY KEY,
  cuentas       jsonb NOT NULL,          -- qué cuentas se revisaron
  decisiones    jsonb NOT NULL,
  costo         jsonb,
  errores       jsonb NOT NULL DEFAULT '[]',
  duracion_ms   int,
  creado_at     timestamptz NOT NULL DEFAULT now()
);

-- Estado de cada fuente de sincronización: cursor, última corrida, último error.
CREATE TABLE sincronizaciones (
  fuente        text PRIMARY KEY,        -- ej: 'ingesta:PAGEID:comentarios', 'pauta'
  cursor        text,                    -- ej: último occurred_at ingerido
  ultima_ok     timestamptz,
  ultimo_error  text,
  duracion_ms   int
);
```

### Eventos nuevos (append-only en `events`)

| Evento | Lo emite | Payload mínimo |
|---|---|---|
| `respuesta.enviada` | ruta de responder (al confirmar Meta) | interaction_id, tipo (publica/privada), texto |
| `atencion.resuelta` | acción manual del operador | interaction_id |
| `interaccion.archivada` | regla de archivo (job) | interaction_id, motivo (ventana) |
| `interaccion.reabierta` | acción manual | interaction_id |
| `lead.contactado` / `lead.frio` | acción manual / job recordatorio | lead_id |

## 5. El proyector de personas

Proceso determinista e idempotente (`server/src/ontology/projector.ts` + tests puros):

1. **Leads**: email y teléfono son identidades. Si ninguna existe → persona nueva con ambas.
   Si una apunta a A y la otra a B → **fusión** (A absorbe B, auditada en `persona_fusiones`,
   las identidades y `persona_ref` de B se reasignan a A).
2. **Messenger**: PSID es identidad. Excluir el ID de la propia página (los salientes de
   Goberna no son una persona).
3. **IG comentarios**: IG user id es identidad.
4. **FB comentarios**: solo el ~1% con `from` presente genera/vincula persona (`fb_user`).
   El resto queda `persona_ref = NULL` — **sin personas fantasma**.
5. **Nombre display**: prioridad lead.fullName > nombre de Messenger > username IG.

Comandos: `npm run ontology:project` (incremental: solo filas con `persona_ref IS NULL` y
fusiones pendientes) y `npm run ontology:rebuild` (borra proyección y rehace desde cero;
correrlo dos veces produce el mismo resultado — hay test de determinismo).

## 6. Máquina de estados y regla de archivo

```
interacción:  nuevo ──▶ en_proceso ──▶ resuelto
                │            ▲  (respuesta.enviada lo mueve a en_proceso;
                │            │   atencion.resuelta lo cierra)
                └──▶ archivado
```

- `archivado → nuevo` solo existe como transición **manual** (`interaccion.reabierta`).
- Si una persona archivada vuelve a escribir, **no** se transiciona la interacción vieja:
  la ingesta crea una interacción NUEVA que nace `nuevo`. La vieja queda como historia.

```
lead:  nuevo ──▶ contactado ──▶ convertido
                      │
                      └──▶ frio (día 10 sin respuesta desde el contacto)
```

- En v1 el "recordatorio del día 4" es una **señal para el operador** (el lead sube en la cola
  con la marca "toca recordatorio"), NO un envío automático — la plataforma todavía no envía
  emails/SMS. El envío automatizado queda para el incremento de reactivación.

**Regla de archivo** (job diario, y también al terminar cada ingesta):

- Comentario con `occurred_at` > 7 días y status `nuevo` → `archivado` (motivo: `ventana-privada-cerrada`).
- Mensaje de Messenger con > 7 días sin actividad de la persona y status `nuevo` → `archivado`
  (motivo: `ventana-human-agent-cerrada`).
- Interacción `en_proceso` con > 7 días sin actividad de la persona → `resuelto` automático
  (motivo: `sin-respuesta`) — el patrón Zendesk: se le respondió, no volvió, se cierra. Sin esto,
  las conversaciones a medias envejecerían eternamente dentro de la cola "accionable".
- **Los leads jamás se archivan por reloj** (email/teléfono no tienen ventana): siguen su
  propia máquina (contactado → frío).
- El job emite eventos `interaccion.archivada` / `atencion.resuelta` (la proyección se deriva
  de ellos, como todo).

**Definición de "accionable" (la cola humana):** `status IN ('nuevo','en_proceso')` — que por
la regla de archivo implica estar dentro de ventana — ordenada por vencimiento (lo más viejo
dentro de ventana primero, igual que hoy), más los leads `nuevo`/`contactado`.

## 7. Sincronización estructurada

- **Ingesta programada** (scheduler en el server, `setInterval`): cada **5 minutos**, incremental
  por cursor (`since` = último `occurred_at` por fuente, con solapamiento de seguridad de 48 h —
  releer no duplica: la idempotencia por `UNIQUE(source, external_id)` ya lo garantiza),
  escalonada entre páginas para respetar rate limits. El backfill histórico sigue siendo comando
  manual. Cada corrida actualiza `sincronizaciones` (los `fetch failed` de Bolivia/Ecuador quedan
  visibles en vez de perderse en un log).
- **Snapshot de pauta**: se recalcula solo por tres disparadores —
  (1) `PUT /api/config/cuentas-pauta` detecta cuentas agregadas/quitadas,
  (2) `POST /api/pauta/refrescar` (botón "Revisar ahora"),
  (3) reloj cada **6 horas**.
  La card lee el último snapshot al instante y muestra su edad ("revisado hace 2 h").
  **Semántica de rango del snapshot**: las *decisiones* se calculan sobre la ventana completa
  (`todo`) — la plata mal repartida es acumulada por naturaleza, y la card lo dice. El *costo
  por lead* se calcula dentro del mismo job para los 5 rangos (7d/30d/90d/1y/todo), así la
  tabla del dashboard sigue obedeciendo las pastillas de fecha leyendo del snapshot, sin
  tocar Meta.
- **La selección de cuentas migra de localStorage a `configuracion`** (compartida entre
  navegadores y disponible para el scheduler). El resto de preferencias de UI (rango de fechas)
  sigue en localStorage.

## 8. UI — columnas vivas

Dashboard (home): pills de fecha arriba (siguen gobernando todo) + **4 columnas**:

```
┌─ 🔵 Facebook ────────┐ ┌─ 🟣 Instagram ──────┐ ┌─ 🟢 WhatsApp ─┐ ┌─ 📄 Formularios ─┐
│ 962 · 129 piden info │ │ 161 · 28 piden info │ │ Sin conectar  │ │ 680 · 4 nuevos   │
│ 🔴 9  🟡 3  🟢 12    │ │ 🔴 2  🟡 0  🟢 5    │ │ qué falta y   │ │ hoy              │
│ ⚫ 14.180 → audiencia│ │ ⚫ 2.600 → audiencia│ │ qué decidir   │ │ 🔴 sin contactar │
│ Últimas 5 (en vivo)  │ │ Últimas 5 (en vivo) │ │               │ │ Últimos 5        │
│ [Abrir canal →]      │ │ [Abrir canal →]     │ │ [Ver →]       │ │ [Abrir →]        │
└──────────────────────┘ └─────────────────────┘ └───────────────┘ └──────────────────┘
```

- **En vivo** = polling cada 30 s a `GET /api/overview` (una sola llamada, todo Postgres),
  con pulso visual en lo que entra. SSE queda para después.
- **Semáforo — semántica de rango explícita**: 🔴 accionables y 🟡 en conversación son estados
  ACTUALES (una cola no depende del rango elegido: lo pendiente es pendiente); 🟢 resueltas y
  ⚫ archivadas sí se cuentan dentro del rango de las pastillas. Las "últimas 5" excluyen
  archivadas (muestran lo vivo, no el archivo).
- **Responder sin salir**: clic en una fila abre el ResponderPanel; al responder, la pieza
  cambia de color delante del operador (el evento ya quedó escrito).
- **"Expandir" = `/canal/:canal`** (pantalla existente), que gana arriba el pipeline completo:
  cola 🔴 ordenada por vencimiento con el reloj visible ("quedan 2 días") → 🟡 → 🟢, y la línea
  de archivo como activo.
- **Personas en la UI**: el hero pasa a contar personas ("X personas distintas pidieron
  información" + "N interacciones sin identificar", separado y honesto). Cada fila identificada
  enlaza a `/persona/:id`: historial unificado multi-canal, identidades, campaña de origen si
  se conoce, y acciones disponibles según ventana.
- Debajo de las columnas siguen el gráfico de flujo y la card de pauta (ahora leyendo snapshot).

## 9. API

| Endpoint | Descripción |
|---|---|
| `GET /api/overview?rango=` | Todo el dashboard en una llamada: por canal → conteos, semáforo, últimas 5, frescura (`sincronizaciones`) |
| `GET/PUT /api/config/cuentas-pauta` | Selección de cuentas en servidor; el PUT dispara refresco si cambió |
| `GET /api/pauta` | Último snapshot + edad |
| `POST /api/pauta/refrescar` | Refresco a demanda (responde 202; el snapshot aparece al terminar) |
| `POST /api/interactions/:id/estado` | `{accion: 'resolver'\|'archivar'\|'reabrir'}` → escribe evento + proyecta |
| `GET /api/personas/:id` | Ficha: identidades, timeline unificado (interacciones + leads), estado de ventanas |
| `GET /api/personas?q=` | Búsqueda por nombre/email/teléfono |
| `POST /api/responder/:id` (existente) | Ahora además emite `respuesta.enviada` y proyecta `en_proceso` |

## 10. Verificación

- **Proyector** (`node:test`, funciones puras como `detectors.test.ts`): resolución por cada tipo
  de clave; fusión con auditoría; idempotencia; anónimos sin persona; exclusión de la página;
  rebuild determinista (proyectar dos veces = mismo resultado).
- **Regla de archivo** con reloj inyectado: 6 días no archiva, 8 sí; Messenger según actividad;
  leads nunca por reloj.
- **Máquina de estados**: transiciones válidas e inválidas (ej. resolver algo archivado falla).
- **Pantalla**: verificación visual con Playwright; cada número de columna contrastado contra
  SQL directo antes de darse por bueno.
- **Criterios de éxito del incremento** (definidos en brainstorming):
  1. El dashboard cuenta **personas** ("X personas distintas pidieron info") con los anónimos
     contados aparte.
  2. Clic en cualquier interacción identificada abre la **ficha de su persona** con historial
     unificado.
  3. Las columnas muestran semáforo con **estados persistidos** que sobreviven recargas y
     operadores múltiples.
  4. La cola 🔴 es **finita** (decenas) porque la regla de archivo corre.
  5. **Cero llamadas a Meta al cargar cualquier pantalla** (verificable en el log del server).

## 11. Orden de construcción sugerido (para el plan)

1. Migraciones + eventos nuevos + máquina de estados (respuestas persistidas — arregla el bug real hoy).
2. Regla de archivo + job.
3. Proyector de personas + tests + rebuild.
4. Sincronización: scheduler de ingesta incremental + `configuracion` + `pauta_snapshots`.
5. `GET /api/overview` + columnas vivas (UI).
6. Ficha de persona + conteo por personas en el hero.
