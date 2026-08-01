# Arquitectura del Asesor Comercial IA — Hermes

> **Autor**: Análisis arquitectónico, 30-jul-2026  
> **Estado**: Diseño para decisión del dueño  
> **Reemplaza**: la sección "El bot de primera línea" de `docs/plan-bot-primera-linea.md` como visión de largo plazo.  
> **No reemplaza**: ADR 0028 (la decisión de que el bot existe) ni el plan T0-T13 (el cómo se construye esta semana). Este documento es el POR QUÉ y el QUÉ.

---

## 1. Crítica profunda de la arquitectura actual

### 1.1 El spike: lo que está bien

- **El guardrail (`bot/guardrails.ts`)** es el activo más valioso del módulo. 1.117 líneas de test, 0 falsos positivos contra 147 textos legítimos, 0 falsos negativos contra 203 evasiones. Diseñado con tres red teams. Es código de producción disfrazado de spike.
- **La config (`bot/config.ts`)** está bien pensada: lazy (no rompe `npm test`), degrada ruidoso (no silencio), CSV de líneas con dedupe, resumen que se imprime al arrancar.
- **La recepción de Cloud API (`webhook/whatsapp.ts`)** es correcta: fast-ack 200, guarda crudo en `events`, idempotente por `external_id`.
- **La decisión de usar Cloud API para el bot** es correcta: whatsmeow es no-oficial y frágil; Cloud API es el canal oficial que Meta respeta. Separar la línea del bot de las líneas de las vendedoras (número propio distinto) es la decisión más importante del diseño.

### 1.2 El spike: lo que está MAL (y por qué urge arreglarlo HOY)

**Problema #1 — El bot vive DENTRO del webhook.** `webhook/whatsapp.ts:107-148` hace TODO en el mismo handler que recibe el POST de Meta: busca el transporte, lee el historial, llama al LLM, envía la respuesta. Esto tiene tres consecuencias graves:

1. **No hay debounce.** Si el lead manda 4 mensajes en 3 segundos (típico en WhatsApp), el bot responde 4 veces. Peor: las 4 llamadas a Bedrock son concurrentes, cada una con su propio historial que no incluye lo que las otras están generando.
2. **El event loop de Express se bloquea.** `responderConBot()` es `async` pero la llamada HTTP a Bedrock dura 1-3 segundos. Durante ese tiempo el mismo proceso que atiende a las tres vendedoras está esperando una respuesta de IA. Si llegan 3 mensajes de leads distintos, Express los encola secuencialmente.
3. **El acuse a Meta (200) ya se mandó.** Si el bot falla, Meta ya recibió el 200 y no reintenta. El mensaje se pierde sin que nadie se entere.

**Problema #2 — Sin buffer ni cola.** El plan T0-T5 ya describe `bot_pendientes` con debounce de 25s. No está implementado. Arreglar esto es más urgente que cualquier tool o prompt nuevo, porque convierte un prototipo que "a veces responde" en un sistema confiable.

**Problema #3 — La credencial de AWS expira cada hora.** `AWS_SESSION_TOKEN` viene de `aws login`. Esto no es un "nice to have": a los 60 minutos el bot se queda mudo. **Es lo que hay que resolver ANTES de hacer cualquier otra cosa.**

**Problema #4 — Contexto de lead hardcodeado.** `webhook/whatsapp.ts:133` inyecta "Inteligencia y Contrainteligencia" para todo lead nuevo. El `referral` de Meta ya viene en el payload (`m.referral.source_id` = ad_id, `m.referral.ctwa_clid`). Leerlo de ahí —y cruzar con la tabla `alias_curso` que YA existe (`ad_id` → familia)— es usar infraestructura construida.

**Problema #5 — Solo responde a UN número.** ~~`webhook/whatsapp.ts:116`: `endsWith('955135507')`. Esto es deliberado (es el número de prueba), pero habla de un defecto de diseño: el filtro de "a quién le responde el bot" vive hardcodeado en el handler, no en la config.~~ **Resuelto (a7dc724)**: el filtro por remitente se eliminó. El bot responde a quien sea que escriba a las líneas habilitadas en `BOT_LINEAS` (config, no código).

### 1.3 El plan T0-T13: lo que está bien diseñado y lo que no

**Bien diseñado:**
- **Separación de responsabilidades**: decision.ts (puro) → agente.ts (puro con seam) → despachador.ts (efectos). El patrón de "acumular Acciones" (no ejecutar efectos en la tool) es la decisión más inteligente del plan.
- **Modo sombra primero**: pensar con tráfico real sin mandar, revisar, corregir, y SOLO DESPUÉS poner en automático.
- **T0 y T1 ya existen en parte**: `config.ts` y `guardrails.ts` están más avanzados que lo que el plan pide.
- **El chunker, los claims atómicos, el re-chequeo antes de mandar**: todo está pensado para evitar los bugs de concurrencia que la auto-respuesta ya pagó.

**Decisiones que revisar:**
- **`claude-opus-5` como default** (`bot/config.ts:113`). Opus 5 es el modelo más caro de la lista. Para un bot que responde saludos y preguntas frecuentes, haiku-4.5 es ~20× más barato y sobra. El plan lo justifica con evals, pero el default debería ser el modelo más barato que pase los evals, no el más caro disponible.
- **Vercel AI SDK no se menciona.** El plan usa `@anthropic-ai/sdk` (el SDK nativo de Anthropic). Es correcto para el MVP —menos dependencias, menos abstracción— pero a mediano plazo ata el bot a un solo proveedor. La decisión consciente de NO usar Vercel AI SDK debería ser un ADR explícito, no una omisión.
- **El follow-up (T7) es demasiado pronto.** Hacer follow-up automático a leads fríos antes de tener el bot conversacional funcionando bien es construir el segundo piso sin terminar el primero. Debería ir DESPUÉS de una semana de bot en automático con métricas.

---

## 2. Comparación con Forja

| Dimensión | Forja | Hermes (actual) | Hermes (objetivo) |
|---|---|---|---|
| **Runtime** | Cloudflare Workers (edge) | VPS1 (Node.js/Express) | = actual |
| **Base de datos** | D1 (SQLite) | Postgres + Drizzle | = actual |
| **Estado del agente** | Durable Object (por conversación) | `bot_pendientes` + `bot_estado` (Postgres) | = plan T0 |
| **Buffer/debounce** | Alarmas del DO (~3s configurable) | No tiene (responde inmediato) | `bot_pendientes` + `setInterval` (25s configurable) |
| **LLM** | Vercel AI SDK (multi-proveedor) | AnthropicBedrock SDK directo | `@anthropic-ai/sdk` (Anthropic) → Vercel AI SDK post-MVP |
| **Model tier** | Selector automático (haiku/sonnet/sonnet5) | Fijo (hardcodeado) | Selector post-MVP |
| **RAG** | Vectorize (bge-m3) | Ivi (servicio externo) | = actual + catálogo inyectado al prompt |
| **Tools** | searchKb, handoffHuman | Ninguna (solo texto) | 5 tools declarativas (plan T3) |
| **Memoria** | Customer facts (extraídos por analista nocturno) | Ninguna | Contexto de contacto (plan T2) |
| **Canales** | WhatsApp + IG + Messenger + Telegram + SMS | WhatsApp Cloud API (spike) | WhatsApp → IG/Messenger post-MVP |
| **Modos** | on/off (bot_paused) | Hardcodeado al número de prueba | apagado/sombra/automático por línea (plan T5) |
| **Spam guard** | Repetición 3x → pausa 1h + tope diario | No tiene | `esRepetido()` en guardrails + tope diario (T5) |
| **Budget guard** | Downgrade de tier al llegar al tope $/mes | No tiene | Post-MVP (primero trackear costo, después limitar) |
| **Failover** | Cambio de proveedor LLM | No tiene | Post-MVP con Vercel AI SDK |
| **Panel admin** | /admin (conversaciones, KB, settings) | App de escritorio (CRM completo) | Chip en cabecera + cola con 🔥 + revisión sombra (T9) |
| **Identidad** | ADMITE ser bot (obligatorio) | NIEGA ser bot (regla del dueño) | = regla del dueño |
| **Multimedia** | Transcripción de audio + visión de imágenes | No tiene | Imágenes/PDFs como piezas del catálogo (no generadas por LLM) |

---

## 3. Qué copiar de Forja

**Patrones, no código:**

1. **Buffer + debounce con alarmas**: el DO agenda `processBuffer` para N segundos después del último mensaje. En Hermes: `bot_pendientes.procesar_desde` + `setInterval` con claim atómico (`FOR UPDATE SKIP LOCKED`). Es lo que el plan T5 ya describe.

2. **Spam guard**: `esRepetido()` ya está en `guardrails.ts`. Falta el tope diario (`maxTurnosDia`) y la pausa automática.

3. **Budget guard**: downgrade de modelo al llegar al tope. Post-MVP, pero el tracking de costo por turno ya debería estar desde el día 1 (`bot_respuestas.tokens_*`).

4. **Customer facts**: el bloque chiquito sin caché que dice «esto ya sabés de este cliente». En Hermes: `armarContextoContacto()` del plan T2 + las señales que YA existen (cotizado, enfriado, cliente).

5. **Prompt caching**: el system prompt grande con `cacheControl: "ephemeral"`. El SDK de Anthropic lo soporta; solo hay que ponerle el provider option.

6. **Chunker**: partir respuestas largas en 2-3 burbujas por párrafos/oraciones. El plan T5 ya lo tiene.

7. **Failover**: si el LLM primario falla, intentar con otro. Post-MVP con Vercel AI SDK.

8. **Lecciones del dueño** (`flywheel`): reglas que el bot aprende de los takeovers humanos. El plan T2 ya deja el hueco `<lecciones>` en el prompt. La versión ambiciosa post-MVP las detecta automáticamente; la versión simple es un `text[]` que se edita a mano.

---

## 4. Qué NO copiar de Forja

1. **Cloudflare Workers / Durable Objects**: Hermes vive en VPS1 con Postgres. Migrar al edge sería reescribir el CRM entero.

2. **D1 / SQLite**: Hermes ya tiene Postgres con Drizzle, migraciones versionadas y 1.261 tests.

3. **Vectorize / RAG propio**: Ivi ya es el servicio de conocimiento. Construir un segundo RAG sería tener DOS índices que divergen.

4. **El panel `/admin`**: Hermes tiene una app de escritorio con CRM, pipeline, contactos y chat en tiempo real. No necesita otro panel.

5. **La regla de identidad**: Forja OBLIGA a admitir que es un bot. Goberna tiene la regla opuesta (el lead no sabe). El guardrail de Hermes es más complejo que el de Forja porque defiende una mentira por omisión, no una verdad.

6. **Manychat como canal**: Hermes ya recibe IG/Messenger por su propio webhook de Meta (`webhook/meta`). No necesita otro intermediario.

7. **La arquitectura monolítica de agente único**: Forja es 100 % bot. Hermes es un CRM donde el bot es UN componente. El bot no puede ser el centro del sistema.

8. **El sistema de "nichos" predefinidos**: Forja tiene 14 giros (barbería, restaurante, etc.). Hermes tiene UN negocio (escuela de formación política) con un catálogo de productos reales.

9. **Instalación por CLI (`npx forjabot init`)**: Hermes no es un producto que se instala. Es un sistema en producción con deploy continuo.

10. **La comunidad de WhatsApp de Horizontes IA**: irrelevante para Goberna.

---

## 5. Arquitectura objetivo (mediano plazo — Q3 2026)

```
                         ┌──────────────────────────────┐
                         │     WhatsApp Cloud API        │
                         │     (número del bot: +51...)  │
                         └──────────────┬───────────────┘
                                        │ POST webhook
                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        HERMES SERVER (Express)                       │
│                                                                      │
│  ┌─────────────────────┐     ┌──────────────────────────────────┐   │
│  │ webhook/whatsapp.ts │────▶│      bot/ingesta.ts              │   │
│  │ (thin: ack + save)  │     │ upsert bot_pendientes            │   │
│  └─────────────────────┘     │ con procesar_desde = now + 25s   │   │
│                               └──────────────┬───────────────────┘   │
│                                              │                       │
│  ┌───────────────────────────────────────────┼───────────────────┐   │
│  │             bot/despachador.ts            ▼                   │   │
│  │  setInterval 5s ──▶ claim atómico (SKIP LOCKED)              │   │
│  │    │                                                          │   │
│  │    ├─ bot/decision.ts (PURO): ¿respondo?                      │   │
│  │    │   ├─ línea apagada? → saltar                             │   │
│  │    │   ├─ conversación pausada? → saltar                      │   │
│  │    │   ├─ vendedora ya respondió? → saltar                    │   │
│  │    │   ├─ spam? → pausar 1h + saltar                          │   │
│  │    │   ├─ tope diario? → pausar 12h + despedida               │   │
│  │    │   └─ sí → responder                                      │   │
│  │    │                                                          │   │
│  │    ├─ Contexto (PURO, cache 5min):                            │   │
│  │    │   ├─ historial (últimos 20 del hilo)                     │   │
│  │    │   ├─ señales (cotizado, enfriado, cliente)               │   │
│  │    │   ├─ interés (registrado + derivado del anuncio)         │   │
│  │    │   ├─ catálogo (piezas vigentes de la vendedora)         │   │
│  │    │   └─ hechos (datos afirmables)                           │   │
│  │    │                                                          │   │
│  │    ├─ bot/agente.ts (seam Anthropic):                         │   │
│  │    │   system grande con cache + system chico sin cache       │   │
│  │    │   + tools declarativas (solo acumulan Acciones)          │   │
│  │    │   + validarSalida() post-proceso                         │   │
│  │    │                                                          │   │
│  │    └─ Resultado:                                              │   │
│  │       ├─ SOMBRA: persistir bot_respuestas, fin                │   │
│  │       └─ AUTOMÁTICO:                                          │   │
│  │          ├─ re-chequeo: ¿sigue siendo válido?                 │   │
│  │          ├─ chunker (1-3 burbujas)                            │   │
│  │          ├─ EnvioControlado (texto + piezas)                   │   │
│  │          └─ ejecutar Acciones (calificar, escalar, pausar)    │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Bordes externos:                                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐     │
│  │ Bedrock  │  │ Cerberus │  │  Ivi     │  │ Meta Graph API   │     │
│  │ (Claude) │  │ (ERP)    │  │ (RAG)    │  │ (enviar mensaje) │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### Principios de diseño

1. **El webhook es thin.** Recibe, valida firma, guarda crudo en `events`, hace ack 200, y NOTIFICA al despachador. No llama al LLM, no envía respuestas.

2. **La lógica de negocio es pura.** `decision.ts`, `guardrails.ts`, `chunker.ts`, `prompt.ts` no tocan base ni red. Entran datos, salen veredictos. Testeables sin infraestructura.

3. **El agente tiene un seam.** `crearAgente({ cliente })` recibe el cliente de Anthropic por parámetro. Producción usa `new Anthropic()`. Tests usan un fake.

4. **Las tools acumulan, no ejecutan.** `mandar_pieza` no manda nada: agrega una `Accion` a una lista. El despachador decide qué hacer con esa lista (mandar en automático, mostrar en sombra, ignorar si está bloqueado).

5. **Un solo agente, un solo prompt.** No hay "agente de calificación" y "agente de respuesta". El mismo agente conversa, califica, escala y manda piezas. La complejidad está en el prompt y las tools, no en la orquestación.

6. **Modo sombra primero, automático después.** El bot piensa con tráfico real durante días antes de mandar un solo mensaje. Es la única forma de calibrar guardrails y prompt sin arriesgar leads.

7. **El lead no sabe que hay automatismo.** El bot no se delata. Si le preguntan, escala. Si se le escapa, el guardrail lo frena antes de mandar.

---

## 6. Arquitectura MVP (lo mínimo para salir esta semana)

**Lo que YA existe y se reusa:**
- `bot/guardrails.ts` + tests (1.117 líneas, listo)
- `bot/config.ts` + tests (226 líneas, listo)
- `webhook/whatsapp.ts` (hay que MODIFICARLO, no reescribirlo)
- `whatsapp/transporteCloudApi.ts` (envío de texto, listo)
- `whatsapp/hilo.ts` (lectura de historial, listo)
- `whatsapp/enviarYProyectar.ts` (envío + persistencia, listo)
- `whatsapp/EnvioControlado` (la puerta única, listo)
- `senales/cotizacion.ts` (detector de montos, listo)
- `autorespuesta/rechazo.ts` (detección de rechazo, listo)
- `cursos/alias.ts` (diccionario campaña→curso, listo)
- `catalogo/` (catálogo de piezas, listo)

**Lo que hay que construir para el MVP (HOY-MAÑANA):**

| Prioridad | Qué | Tiempo estimado | Bloqueado por |
|---|---|---|---|
| **P0** | IAM user permanente en AWS | 30 min | Nada |
| **P0** | Token permanente de Cloud API (system token, no test) | 30 min | Meta Business App |
| **P1** | Migración: tablas `bot_pendientes`, `bot_respuestas`, `bot_estado`, `bot_pausas`, `bot_calificaciones` | 1 h | Nada |
| **P1** | `bot/decision.ts` (puro) | 1 h | Nada |
| **P1** | `bot/despachador.ts` (ingesta + loop + claim) | 2 h | Migración, decision |
| **P1** | Sacar el bot de `webhook/whatsapp.ts` y conectarlo al despachador | 30 min | Despachador |
| **P2** | `bot/prompt.ts` + `bot/contexto.ts` (system prompt parametrizable) | 2 h | Nada |
| **P2** | `bot/agente.ts` (toolRunner con Anthropic SDK) | 3 h | Prompt, guardrails |
| **P3** | `bot/acciones.ts` + `bot/tools.ts` (tools declarativas) | 2 h | Agente |
| **P3** | `bot/chunker.ts` | 30 min | Nada |
| **P3** | Conectar `EnvioControlado` al despachador | 1 h | Despachador, chunker |

**MVP = P0 + P1 desplegado en VPS1. El bot responde en modo sombra (piensa, guarda, no manda).**

**Lo que NO entra en el MVP:**
- Tools (mandar_pieza, registrar_interes, calificar, escalar, pausar) → P3
- Prompt caching
- Follow-ups
- UI (chip, cola, revisión sombra)
- Evals automáticos con juez
- Multimodelo / failover
- Budget guard
- Customer facts / memoria cross-conversación

---

## 7. Roadmap de implementación por fases

### Fase 0 — HOY (miércoles 30-jul): destrabar lo que bloquea

**Objetivo**: que el spike actual deje de funcionar con session token y token de prueba.

1. **Crear IAM user en AWS** (cuenta 177914733251):
   - Usuario: `hermes-bot-bedrock`
   - Policy: `bedrock:InvokeModel` sobre `*` (todos los modelos de la cuenta)
   - Access key + secret key permanentes
   - Cargar en `/srv/hermes/server/.env` y `/srv/hermes-staging/server/.env`:
     ```bash
     AWS_ACCESS_KEY_ID=AKIA...
     AWS_SECRET_ACCESS_KEY=...
     # SIN AWS_SESSION_TOKEN
     ```

2. **Obtener token permanente de WhatsApp Cloud API**:
   - En Meta Business App → System User → Generate Token
   - Permisos: `whatsapp_business_messaging`, `whatsapp_business_management`
   - Cargar en `.env` como `WHATSAPP_CLOUD_API_TOKEN`

3. **Verificar**: `ssh deploy@161.132.39.165` → `sudo journalctl -u hermes -f` → mandar WhatsApp de prueba → el bot responde y no se muere a la hora.

### Fase 1 — JUEVES (31-jul): el loop confiable

**Objetivo**: el bot responde con buffer/debounce y decisión determinista. Sin tools, sin acciones. Solo texto.

1. **Migración de las 5 tablas** (`bot_pendientes`, `bot_respuestas`, `bot_estado`, `bot_pausas`, `bot_calificaciones`)
2. **`bot/decision.ts`**: `decidir()` puro con los 7 motivos de salto
3. **`bot/despachador.ts`**: `notificarEntrante()` + loop `setInterval` con claim atómico
4. **Refactor de `webhook/whatsapp.ts`**: sacar el bot del handler, conectarlo al despachador
5. **Prompt y contexto reales**: leer `referral` del payload, cruzar con `alias_curso`, inyectar en el prompt

Al final del jueves: el bot corre en VPS1 en modo **sombra** con la línea de Cloud API. Cada mensaje entrante → buffer 25s → el bot piensa → guarda `bot_respuestas`. NADA sale al lead.

### Fase 2 — VIERNES (1-ago): el agente con tools

**Objetivo**: el bot puede mandar piezas, calificar, escalar y pausar.

1. **`bot/acciones.ts`** + **`bot/tools.ts`**: 5 tools declarativas
2. **`bot/agente.ts`**: `crearAgente()` con toolRunner + validarSalida post-proceso
3. **`bot/prompt.ts`**: system prompt parametrizado con reglas duras
4. **`bot/contexto.ts`**: contexto de negocio (descripción real de la Escuela)
5. **`bot/chunker.ts`**: partir respuestas en burbujas

Al final del viernes: el agente piensa con tools y acumula Acciones. Sigue en modo sombra.

### Fase 3 — FIN DE SEMANA (2-3 ago): evals, revisión y primera línea en automático

1. **Simulacro** (`bot:simulacro --demo`): los 8 casos canónicos + variantes
2. **Revisión de sombra**: leer `bot_respuestas` con tráfico real, corregir prompt/guardrails
3. **UNA línea en automático**: la de Cloud API (menor volumen, sin riesgo para las vendedoras)
4. **Monitoreo**: freno por `temporary_ban`, costo diario, tasa de escalada

### Fase 4 — POST-MVP (agosto): lo que quedó afuera

- Follow-ups a enfriados
- UI (chip, cola con 🔥, revisión sombra)
- Evals automáticos con juez
- Customer facts / memoria
- Vercel AI SDK + failover multi-proveedor
- Budget guard
- Canales adicionales (Instagram, Messenger)

---

## 8. Estructura de carpetas

```
server/src/bot/
├── config.ts              # ✅ YA EXISTE — ConfigBot, configDesdeEnv, lineasDeEnv
├── config.test.ts         # ✅ YA EXISTE — 226 líneas
├── guardrails.ts          # ✅ YA EXISTE — validarSalida, esRepetido, listas, tokenizador
├── guardrails.test.ts     # ✅ YA EXISTE — 1.117 líneas, dos corpus
├── responder.ts           # 🔄 SPIKE — reemplazar por agente.ts
│
├── decision.ts            # 🆕 PURO — decidir(hechos) → responder|saltar
├── decision.test.ts       # 🆕 un caso por motivo + orden fijado
│
├── prompt.ts              # 🆕 PURO — armarSystemPrompt, armarContextoContacto
├── prompt.test.ts         # 🆕 determinismo, reglas duras presentes
├── contexto.ts            # 🆕 CONSTANTE — descripción real de la Escuela (validar con dueño)
│
├── acciones.ts            # 🆕 TIPOS — Accion, Catalogo, Turno, RespuestaBot
├── tools.ts               # 🆕 PURO — crearTools(recolector, catalogo) → tools
├── tools.test.ts          # 🆕 cada tool acumula correcto, id inexistente no acumula
│
├── agente.ts              # 🆕 SEAM — crearAgente({cliente}) → responder()
├── agente.test.ts         # 🆕 con cliente fake: texto limpio pasa, precio bloquea, bot se escala
│
├── chunker.ts             # 🆕 PURO — trocear texto en 1-3 burbujas
├── chunker.test.ts        # 🆕 párrafos/oraciones/texto corto
│
├── ingesta.ts             # 🆕 EFECTOS — notificarEntrante(clave, numero, ts) → upsert pendientes
├── despachador.ts         # 🆕 EFECTOS — loop + claim + armar contexto + llamar agente
├── despachador.test.db.ts # 🆕 concurrencia, re-chequeo, sombra no manda
│
├── respuestas.ts          # 🆕 EFECTOS — persistir bot_respuestas, ejecutar acciones
│
├── evals/
│   ├── escenarios.json    # 🆕 ~20 escenarios con rúbrica
│   ├── escenarios.ts      # 🆕 accessor tipado
│   └── escenarios.test.ts # 🆕 JSON bien formado, ids únicos, críticos con rúbrica
│
└── scripts/
    ├── botSimulacro.ts    # 🆕 npm run bot:simulacro [--demo]
    └── botEvaluar.ts      # 🆕 npm run bot:evaluar (juez con Opus)
```

---

## 9. Modelo de datos

### Tablas nuevas (las 5 del plan T0, con ajustes)

```sql
-- El estado de cada línea del bot (una fila por número propio)
CREATE TABLE bot_estado (
  numero_propio TEXT PRIMARY KEY,
  modo TEXT NOT NULL DEFAULT 'apagado' CHECK (modo IN ('apagado','sombra','automatico')),
  frenado_motivo TEXT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por TEXT NULL
);

-- La cola de trabajo: una fila por conversación con mensajes pendientes
CREATE TABLE bot_pendientes (
  clave TEXT PRIMARY KEY,  -- conv:<canal>:<persona>:<numeroPropio>
  numero_propio TEXT NOT NULL,
  ultimo_entrante_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  procesar_desde TIMESTAMPTZ NOT NULL,  -- debounce: ultimo + buffer
  en_proceso_desde TIMESTAMPTZ NULL,    -- claim atómico
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bot_pendientes_procesar ON bot_pendientes (procesar_desde, en_proceso_desde)
  WHERE en_proceso_desde IS NULL;

-- Todo lo que el bot pensó o mandó (auditoría + sombra)
CREATE TABLE bot_respuestas (
  id BIGSERIAL PRIMARY KEY,
  clave TEXT NOT NULL,
  numero_propio TEXT NOT NULL,
  texto TEXT NULL,               -- NULL si el guardrail bloqueó
  texto_completo TEXT NULL,      -- sin truncar (para revisión sombra)
  acciones JSONB NOT NULL DEFAULT '[]',
  estado TEXT NOT NULL CHECK (estado IN ('sombra','enviada','bloqueada','error','cancelada')),
  motivo TEXT NULL,               -- por qué se canceló o bloqueó
  modelo TEXT NULL,
  tokens_entrada INT NULL,
  tokens_salida INT NULL,
  tokens_cache_escritura INT NULL,
  tokens_cache_lectura INT NULL,
  revision TEXT NULL,             -- 'ok' | 'mal' | NULL (no revisada)
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bot_respuestas_estado ON bot_respuestas (estado, creado_en);
CREATE INDEX idx_bot_respuestas_clave ON bot_respuestas (clave, creado_en);

-- Pausas: por qué el bot no le habla a esta conversación
CREATE TABLE bot_pausas (
  clave TEXT PRIMARY KEY,
  motivo TEXT NOT NULL CHECK (motivo IN (
    'vendedora_intervino','lead_pidio_humano','rechazo','spam',
    'tope_diario','manual','error_bot'
  )),
  hasta TIMESTAMPTZ NULL,  -- NULL = indefinida
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Calificación del lead (frío/tibio/caliente)
CREATE TABLE bot_calificaciones (
  clave TEXT PRIMARY KEY,
  temperatura TEXT NOT NULL CHECK (temperatura IN ('caliente','tibio','frio')),
  motivo TEXT NULL,
  escalada BOOLEAN NOT NULL DEFAULT false,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Claims de follow-up (una sola vez por conversación)
CREATE TABLE bot_followups (
  clave TEXT PRIMARY KEY,
  motivo TEXT NOT NULL,
  enviado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Tablas existentes que se reusan

- `envios_wa` — agregar `via: 'bot'` al vocabulario (la columna `pieza_via` ya existe)
- `events` — el crudo del webhook ya se guarda acá
- `catalogo` / `hechos` — las piezas que el bot puede mandar
- `alias_curso` — para traducir `referral.source_id` → familia de curso

### Lo que NO necesita tablas nuevas

- **Productos/Precios/Promociones**: viven en Cerberus, se consultan por API. El bot no escribe ahí.
- **FAQ**: no existe como tabla. Vive en el system prompt como `<datos_que_podes_afirmar>` (hechos del catálogo).
- **Materiales/PDFs/Imágenes/Videos**: son piezas del catálogo (`catalogo` + `hechos`). El bot las manda, no las gestiona.
- **Landings**: son URLs en el catálogo.
- **Memoria de cliente**: post-MVP, tabla `bot_facts` (clave, fact, creado_en). Por ahora, el contexto de contacto (nombre, señales, interés) se arma en cada turno con datos que YA existen.

---

## 10. Flujo completo de conversación

```
1. Lead escribe por WhatsApp al número del bot (+51 984 429 504)
   │
2. Meta Cloud API → POST https://hermes-api.goberna.us/webhook/whatsapp
   │  firma HMAC-SHA256
   │
3. webhook/whatsapp.ts:recibirWhatsapp()
   ├─ Valida firma → 403 si no coincide
   ├─ Responde 200 INMEDIATO (Meta no espera)
   ├─ Guarda crudo en events (atribución)
   ├─ Entrega a TransporteCloudApi.recibirEntrante() → conversation store
   └─ notificarEntrante(clave, numeroPropio, now())
      └─ UPSERT bot_pendientes SET procesar_desde = now() + 25s
         (cada mensaje nuevo EMPUJA la ventana: debounce)
   │
4. Loop del despachador (setInterval 5s):
   │
   ├─ Claim atómico:
   │    UPDATE bot_pendientes
   │    SET en_proceso_desde = now()
   │    WHERE clave IN (
   │      SELECT clave FROM bot_pendientes
   │      WHERE procesar_desde <= now()
   │        AND en_proceso_desde IS NULL
   │      LIMIT 3
   │      FOR UPDATE SKIP LOCKED
   │    )
   │    RETURNING *
   │
   ├─ Por cada claim:
   │
   │  ┌─ bot/decision.ts (PURO)
   │  │  ├─ ¿línea apagada? → saltar (apagado)
   │  │  ├─ ¿línea frenada? → saltar (frenado)
   │  │  ├─ ¿conversación pausada? → saltar (pausado)
   │  │  ├─ ¿vendedora ya respondió? → saltar (vendedora_activa)
   │  │  ├─ ¿mensaje repetido 3x? → pausar + saltar (spam)
   │  │  ├─ ¿tope diario alcanzado? → pausar + despedida (tope_diario)
   │  │  └─ SÍ → responder
   │  │
   │  ├─ Si SALTAR:
   │  │  ├─ Borrar de bot_pendientes
   │  │  └─ Guardar en bot_respuestas(estado: 'cancelada', motivo)
   │  │
   │  └─ Si RESPONDER:
   │     │
   │     ├─ Armar contexto (cache 5 min):
   │     │  ├─ historial: últimos 20 mensajes del hilo
   │     │  ├─ señales: ¿cotizado? ¿enfriado? ¿es cliente?
   │     │  ├─ interés: registrado + derivado del anuncio
   │     │  ├─ catálogo: piezas vigentes de esa vendedora
   │     │  └─ hechos: datos afirmables del negocio
   │     │
   │     ├─ bot/agente.ts:responder()
   │     │  ├─ system grande con cache: rol + negocio + hechos + catálogo + reglas
   │     │  ├─ system chico sin cache: nombre, procedencia, señales
   │     │  ├─ messages: historial como user/assistant
   │     │  ├─ tools: mandar_pieza, registrar_interes, calificar,
   │     │  │         escalar_a_vendedora, pausar_conversacion
   │     │  └─ max_tokens, max_iterations, sin temperature
   │     │
   │     ├─ Post-proceso: validarSalida(texto)
   │     │  ├─ OK → texto + acciones
   │     │  └─ VIOLA → texto: null, acciones: [escalar(error_bot)]
   │     │
   │     └─ Guardar en bot_respuestas:
   │        ├─ SOMBRA: estado 'sombra', fin
   │        └─ AUTOMÁTICO:
   │           ├─ Re-chequeo: ¿entró mensaje nuevo del lead/vendedora?
   │           │  ├─ SÍ → cancelar, re-encolar
   │           │  └─ NO → continuar
   │           ├─ Chunker: trocear texto en 1-3 burbujas
   │           ├─ EnvioControlado.enviarTexto() × N (con delays 2-6s)
   │           │  └─ cada burbuja: via 'bot', automatico: true
   │           ├─ Acción mandar_pieza: enviar por MISMO camino
   │           ├─ Acción calificar: upsert bot_calificaciones
   │           ├─ Acción escalar: bot_calificaciones.escalada = true + pausa
   │           ├─ Acción pausar: upsert bot_pausas
   │           └─ Acción registrar_interes: POST a gestiones/intereses/derivado
   │
   └─ Fin del loop. Volver a dormir 5s.
```

---

## 11. Flujo de herramientas (tools)

```
Agente recibe mensaje del lead: "¿cuánto cuesta el diplomado de contrainteligencia?"

1. El LLM lee el system prompt:
   - regla 1: NUNCA escribas cifras de precio → no puede decir "cuesta 350"
   - <piezas_enviables>: ve que existe "Flyer Contrainteligencia" (id: plantilla:5)
   - instrucción: para mandar precio, usar mandar_pieza

2. El LLM decide:
   - texto: "¡Claro! El diplomado incluye clases en vivo por Zoom, acceso al campus
     virtual y certificación. Te paso la información completa:"
   - tool call: mandar_pieza({ id: "plantilla:5" })

3. tool mandar_pieza:
   - valida que "plantilla:5" existe en el catálogo
   - agrega Accion { tipo: 'mandar_pieza', clase: 'plantilla', id: '5' }
   - devuelve "pieza agendada para enviar"

4. El LLM ve que el lead preguntó específicamente por contrainteligencia:
   - tool call: registrar_interes({ familia: "DIPCINTE" })

5. tool registrar_interes:
   - valida que "DIPCINTE" es una familia conocida
   - agrega Accion { tipo: 'registrar_interes', familia: "DIPCINTE" }
   - devuelve "interés registrado"

6. El LLM termina. Resultado final:
   - texto: "¡Claro! El diplomado incluye..."
   - acciones: [mandar_pieza(plantilla:5), registrar_interes(DIPCINTE)]

7. Despachador ejecuta:
   - Envía el texto (chunker, 1 burbuja)
   - Envía la plantilla 5 (flyer + precio + temario) por EnvioControlado
   - Registra el interés contra gestiones/intereses/derivado
```

---

## 12. Flujo de escalación humana

```
El bot decide escalar cuando:

1. El lead pide humano explícitamente:
   → tool: escalar_a_vendedora({ motivo: 'pidio_humano' })
   → Accion: { tipo: 'escalar', motivo: 'pidio_humano' }
   → bot_calificaciones.escalada = true
   → bot_pausas(clave, motivo: 'lead_pidio_humano', hasta: null)
   → La conversación aparece en la cola con chip "Escalado 🔴"

2. El lead pregunta si es un bot:
   → tool: escalar_a_vendedora({ motivo: 'pregunto_si_es_bot' })
   → El bot NO responde la pregunta (ni afirma ni niega)
   → Misma secuencia de escalación

3. El lead quiere comprar YA:
   → tool: calificar({ temperatura: 'caliente', motivo: 'quiere_pagar' })
   → tool: escalar_a_vendedora({ motivo: 'por_cerrar' })
   → La conversación sube al tope de la cola (chip 🔥)

4. El lead está frustrado:
   → tool: escalar_a_vendedora({ motivo: 'frustrado' })
   → El bot se disculpa brevemente y escala

5. El guardrail bloqueó la respuesta:
   → texto: null
   → Accion: { tipo: 'escalar', motivo: 'error_bot' }
   → bot_respuestas(estado: 'bloqueada', motivo: 'precio'|'automatismo'|'humanidad')
   → Se escala en silencio (la vendedora ve "Bot bloqueado" en la conversación)

6. La pregunta no tiene respuesta en el catálogo:
   → tool: escalar_a_vendedora({ motivo: 'sin_respuesta_en_catalogo' })
   → El bot dice "déjame confirmarlo con el equipo y te escribo"

Handoff payload (lo que la vendedora ve):
{
  motivo: 'por_cerrar',
  prioridad: 'alta',
  resumen: 'Lead interesado en DIPCINTE, preguntó precio, quiere inscribirse hoy.',
  siguiente_accion: 'Llamar para cerrar matrícula. Ya se le envió flyer con precios.'
}
```

---

## 13. Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **Ban de WhatsApp** | Baja | Crítico | Solo Cloud API oficial. Ritmo humano. Una línea aislada. Freno total ante `temporary_ban`. |
| **El bot dice un precio inventado** | Media | Alto | Guardrail en código (no solo prompt). 0 falsos negativos en corpus. Modo sombra antes de automático. |
| **El bot se delata** | Media | Alto | Guardrail en código. Si le preguntan, escala. El prompt no empuja a mentir (solo a omitir). |
| **Costo de Bedrock se dispara** | Baja | Medio | Modelo configurable por env. Tokens guardados por turno. Dashboard de costo desde día 1. |
| **Cerberus no responde a tiempo** | Media | Medio | El bot no depende de Cerberus para responder texto. Solo para registrar_interes y calificar. Timeout de 5s. |
| **El catálogo está vacío (sin plantillas)** | Alta | Alto | El bot responde con contexto inyectado al prompt. Sin piezas, solo conversa y escala. No se calla. |
| **La vendedora y el bot se pisan** | Media | Alto | Re-chequeo antes de mandar. Pausa automática cuando la vendedora escribe. |
| **Prompt injection desde el lead** | Baja | Medio | El historial va como `user`/`assistant`. El system prompt manda no obedecer instrucciones del usuario. La última defensa es el guardrail de salida. |
| **Deriva del prompt (el bot cambia de personalidad)** | Media | Medio | Prompt determinista (sin Date.now). Tests que verifican reglas duras presentes. Evals con juez automático. |
| **AWS credentials expiran** | Alta (hoy) | Crítico (hoy) | IAM user con access key permanente. |

---

## 14. Decisiones arquitectónicas (ADR)

### ADR 0029 — Un solo agente, tools declarativas

**Decisión**: el bot tiene UN agente que conversa, califica, escala y manda piezas. No hay agentes separados por tarea. Las tools del agente NO ejecutan efectos: acumulan `Accion`es que el despachador ejecuta (o ignora, en modo sombra).

**Alternativas rechazadas**:
- Múltiples agentes (uno para calificar, otro para responder): añade latencia, puntos de fallo y complejidad sin beneficio medible.
- Tools que ejecutan efectos directos: acoplan el agente a la infraestructura, impiden testear sin base/red, y no permiten modo sombra.

### ADR 0030 — Cloud API para el bot, whatsmeow para las vendedoras

**Decisión**: el bot usa exclusivamente la WhatsApp Cloud API (número propio, `+51 984 429 504`). Las vendedoras siguen usando whatsmeow en sus líneas. Son transportes separados que comparten el mismo `EnvioControlado`.

**Alternativas rechazadas**:
- Bot por whatsmeow: más frágil, más riesgo de ban. La Cloud API es el canal oficial de Meta.
- Migrar las vendedoras a Cloud API: no hay necesidad. whatsmeow funciona bien para uso humano.

### ADR 0031 — Modo sombra antes de automático

**Decisión**: el bot se despliega en modo sombra (piensa y guarda, no manda). Solo se activa el modo automático después de:
1. Al menos 30 respuestas revisadas en sombra con <10 % de "está mal"
2. Cero violaciones de guardrail en esas 30
3. Evals con juez: 100 % en escenarios críticos, ≥80 % en el resto
4. Decisión explícita del dueño

**Alternativas rechazadas**:
- Ir directo a automático: riesgo innecesario. Un mensaje malo a un lead real es irreversible.
- Solo evals sintéticos: no capturan la variabilidad del tráfico real.

### ADR 0032 — Anthropic SDK nativo (no Vercel AI SDK) para el MVP

**Decisión**: el MVP usa `@anthropic-ai/sdk` (el SDK nativo de Anthropic), no Vercel AI SDK. El cambio a Vercel AI SDK se evalúa post-MVP, cuando el multi-proveedor sea necesario.

**Justificación**:
- El SDK de Anthropic ya está instalado y es lo que usa el toolRunner del plan.
- Vercel AI SDK añade una capa de abstracción que para UN proveedor no se necesita.
- El momento de migrar es cuando haya DOS proveedores configurados y el failover esté implementado.

---

## 15. Lista priorizada de tareas

### HOY (miércoles 30-jul) — P0: destrabar

- [ ] **P0.1** Crear IAM user `hermes-bot-bedrock` en AWS cuenta 177914733251
- [ ] **P0.2** Cargar credenciales permanentes en `.env` de VPS1 y staging
- [ ] **P0.3** Obtener token permanente de WhatsApp Cloud API (System User)
- [ ] **P0.4** Cargar token en `.env`
- [ ] **P0.5** Verificar: el spike responde después de 1 hora (sin session token)

### MAÑANA (jueves 31-jul) — P1: el loop confiable

- [ ] **P1.1** Crear migración: `bot_estado`, `bot_pendientes`, `bot_respuestas`, `bot_pausas`, `bot_calificaciones`
- [ ] **P1.2** `bot/decision.ts` + tests
- [ ] **P1.3** `bot/ingesta.ts`: `notificarEntrante()`
- [ ] **P1.4** `bot/despachador.ts`: loop + claim + contexto + llamada al agente + guardado
- [ ] **P1.5** Refactor `webhook/whatsapp.ts`: sacar el bot, dejar solo ack + ingesta
- [ ] **P1.6** `bot/prompt.ts` + `bot/contexto.ts` (contexto real del referral, no hardcodeado)
- [ ] **P1.7** Deploy en VPS1 staging → smoke test
- [ ] **P1.8** Deploy en VPS1 producción en modo SOMBRA

### VIERNES (1-ago) — P2: el agente con tools

- [ ] **P2.1** `bot/acciones.ts` (tipos)
- [ ] **P2.2** `bot/tools.ts` + tests
- [ ] **P2.3** `bot/agente.ts` + tests con cliente fake
- [ ] **P2.4** `bot/chunker.ts` + tests
- [ ] **P2.5** Integrar `EnvioControlado` al despachador
- [ ] **P2.6** Deploy en staging → verificar tools en sombra

### FIN DE SEMANA (2-3 ago) — P3: evals y rollout

- [ ] **P3.1** `bot:simulacro --demo` (8 casos canónicos)
- [ ] **P3.2** Revisar respuestas en sombra (≥30)
- [ ] **P3.3** Ajustar prompt/guardrails según hallazgos
- [ ] **P3.4** `bot:evaluar` con juez (Opus 5)
- [ ] **P3.5** Decisión del dueño: ¿prendemos automático?
- [ ] **P3.6** Si sí: UNA línea a automático, monitorear 24h

---

## 16. Qué implementar esta semana

**Sí** (MVP):
- IAM user + token Cloud API permanentes
- 5 tablas de bot
- Decision engine puro
- Loop del despachador (buffer + claim + contexto + agente)
- System prompt con contexto real de Goberna
- Tools declarativas (5)
- Agente con Anthropic SDK + toolRunner
- Guardrails de salida (ya existen)
- Chunker
- Modo sombra funcionando en VPS1 con tráfico real

**No** (post-MVP):
- UI (chip en cabecera, cola con 🔥, revisión sombra)
- Follow-ups automáticos
- Evals con juez automático
- Vercel AI SDK / multi-proveedor
- Budget guard
- Memoria cross-conversación (customer facts)
- Más canales (Instagram, Messenger)
- Multimedia generada por IA (solo imágenes/PDFs del catálogo)

---

## 17. Qué dejar para futuras versiones

| Capacidad | Cuándo | Por qué no ahora |
|---|---|---|
| **UI del bot** | Ago (semana 2) | El bot funciona sin UI. La revisión de sombra se hace por DB. |
| **Follow-ups** | Ago (semana 3) | Primero que el bot converse bien. Después que inicie conversaciones. |
| **Evals automáticos** | Ago (semana 2) | Necesita el agente con tools funcionando. |
| **Vercel AI SDK + multi-proveedor** | Ago (semana 4) | Solo cuando haya necesidad de failover (OpenAI o Grok como backup). |
| **Budget guard** | Ago (semana 4) | Primero trackear costo (ya se guarda). Después limitar. |
| **Customer facts / memoria** | Sep | Sin datos de conversaciones reales no hay patrones que extraer. |
| **Más canales (IG, Messenger)** | Sep | WhatsApp es el 95 % del tráfico. Los otros canales no justifican el esfuerzo hoy. |
| **Multimedia generada por IA** | Nunca | Las imágenes y PDFs son piezas del catálogo. El bot no genera contenido visual. |
| **Agentes múltiples** | Nunca (salvo evidencia) | Un solo agente bien construido cubre el 100 % de los casos del MVP. |

---

## Conclusión

El spike actual no es salvable como arquitectura: el bot dentro del webhook es un defecto de diseño que hay que corregir antes de construir nada más. Pero las piezas que lo rodean —guardrails, config, transporte Cloud API, catálogo— son sólidas y están listas.

El MVP es acotado: el despachador con buffer + el agente con tools declarativas + modo sombra. Con eso funcionando en VPS1, el dueño puede ver respuestas reales y decidir si prende automático.

El plan T0-T13 es el camino correcto. Este documento no lo reemplaza: lo complementa con la justificación arquitectónica de cada decisión y la crítica de lo que ya está construido.

**Lo urgente HOY: IAM user + token Cloud API permanentes. Sin eso, el bot se muere a los 60 minutos y no hay nada que diseñar.**
