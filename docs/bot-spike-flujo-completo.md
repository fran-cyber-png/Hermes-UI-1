# Respuestas automáticas con WhatsApp Cloud API — flujo completo

> **Estado**: SPIKIE — prueba de calidad de respuestas. No es el bot final (T2-T13 de la épica #232).  
> **Fecha**: 30-jul-2026

---

## 1. Arquitectura general

```
WhatsApp (persona)
  │  escribe al +51 984 429 504
  ▼
Meta Cloud API
  │  POST https://hermes-api.goberna.us/webhook/whatsapp
  │  firma HMAC-SHA256 con WHATSAPP_APP_SECRET
  ▼
nginx → hermes-api.goberna.us:4110
  │
  ▼
server/src/webhook/whatsapp.ts:recibirWhatsapp()
  │
  ├─ 1. Guarda crudo en tabla `events` (atribución)
  ├─ 2. Entrega el payload a TransporteCloudApi.recibirEntrante()
  │      → convierte a MensajeWhatsapp → IngestaWhatsapp → conversation store
  │
  └─ 3. SPIKE BOT: si el número está en BOT_LINEAS
       y el remitente es el número de prueba (955135507)
       │
       ├─ Lee historial del hilo (últimos 10 turnos)
       ├─ Si es primer mensaje, antepone contexto de lead:
       │   "[CONTEXTO: Este lead llegó por un anuncio del curso
       │    'Inteligencia y Contrainteligencia'...]"
       │
       ├─ Llama a bot/responder.ts:responderConBot()
       │   │
       │   ├─ Construye system prompt (Kathy Alva)
       │   ├─ Arma mensajes: historial + texto entrante
       │   └─ AnthropicBedrock SDK
       │       │  POST https://bedrock-runtime.us-east-1.amazonaws.com
       │       │       /model/us.anthropic.claude-haiku-4-5-20251001-v1:0/invoke
       │       │  Auth: AWS IAM (access key + secret + session token)
       │       │  Body: anthropic_version + max_tokens + system + messages
       │       ▼
       │      Claude Haiku 4.5 (Bedrock)
       │       │  genera respuesta en español, 2-3 oraciones
       │       ▼
       │      Respuesta de texto
       │
       └─ TransporteCloudApi.enviarTexto()
            │  POST https://graph.facebook.com/v25.0/{phone_id}/messages
            │  Auth: Bearer WHATSAPP_CLOUD_API_TOKEN
            │  Body: { messaging_product: "whatsapp", to, type: "text", text: { body } }
            ▼
          WhatsApp (persona recibe la respuesta)
```

---

## 2. Archivos involucrados

| Archivo | Rol |
|---|---|
| `server/src/webhook/whatsapp.ts` | Recibe el POST de Meta, guarda crudo, entrega al transporte, dispara el bot |
| ~~`responder.ts`~~ | El spike lo tenía todo junto: cliente de Bedrock, prompt y llamada. **Se eliminó** (ADR 0033) y hoy son tres: `server/src/bot/clienteBedrock.ts` (`crearClienteBedrock`), `server/src/bot/prompt.ts` (`armarSystemPrompt`) y `server/src/bot/agente.ts` |
| `server/src/bot/config.ts` | Configuración del bot: `BOT_LINEAS`, topes, modelo (NO usado en el spike) |
| `server/src/whatsapp/transporteCloudApi.ts` | Envío y recepción por WhatsApp Cloud API |
| `server/src/whatsapp/wiring.ts` | Monta los transportes (whatsmeow + cloud-api) al arrancar |
| `server/src/whatsapp/hilo.ts` | `hiloDe()` — lee el historial de conversación de la BD |
| `server/src/db/schema.ts` | Tabla `events` donde se guarda el crudo entrante |

---

## 3. El prompt del bot (Kathy Alva)

El system prompt del spike era una constante `SYSTEM_PROMPT` dentro de aquel `responder.ts`. Hoy se
arma en **`server/src/bot/prompt.ts`** (`armarSystemPrompt`), que ya no es un texto fijo. Fue
construido sobre la entrevista de 19 secciones con Kathy Alva (doc
`Clasificacion-Respuestas-Automaticas-Entrenamiento.docx`).

**Reglas duras:**
- NUNCA decir que es bot, IA o automático
- NUNCA inventar precios, fechas, docentes o certificaciones
- NUNCA presionar para pagar de inmediato
- Responder en español, breve (2-3 oraciones), cálido y profesional
- Terminar cada mensaje con pregunta o indicación que haga avanzar

**Flujo de conversación:**
1. SALUDO → presentarse con nombre y cargo. Preguntar en qué ayudar
2. DESCUBRIR → identificar programa de interés y necesidad
3. BENEFICIOS → explicar modalidad, duración, certificación
4. DUDAS → resolver preguntas específicas
5. PRECIO → solo cuando la persona pregunta o ya está interesada
6. CIERRE → facilitar inscripción o programar seguimiento

**Señales de compra:**
- Pregunta por formas de pago, fecha de inicio, cómo matricularse = quiere comprar

**Señales de NO compra:**
- "solo estoy averiguando", "mándame toda la información", "después lo reviso" = bajo interés
- Responder con una pregunta breve para identificar el obstáculo real

**Transferir a humana cuando:**
- Queja o reclamo
- Quiere pagar / listo para inscribirse
- Pide asesor directamente
- Pregunta muy específica fuera del alcance

**Cursos destacados (mencionados en el prompt):**
- Inteligencia y Contrainteligencia
- Foro de Estado
- Diplomados en formación política
- Comunicación política
- Análisis electoral

---

## 4. Variables de entorno necesarias

### En VPS1 (`/srv/hermes/server/.env`):

```bash
# ── Webhook entrante ──
WHATSAPP_VERIFY_TOKEN=32f8c5dcf8550442dde538a85ac828e0
WHATSAPP_APP_SECRET=...      # App Secret de Meta (App Dashboard → Settings → Basic)

# ── Cloud API (envío + recepción) ──
WHATSAPP_CLOUD_API_NUMERO_PROPIO=51984429504
WHATSAPP_CLOUD_API_PHONE_NUMBER_ID=1293736303812393
WHATSAPP_CLOUD_API_TOKEN=EAAb...        # Temporal de "API Setup" en Meta (~24h)
WHATSAPP_TRANSPORTE=whatsmeow           # El transporte principal (NO se cambia)

# ── Bot (Bedrock) ──
BOT_LINEAS=51984429504                  # Líneas donde el bot responde
BOT_MODELO=us.anthropic.claude-haiku-4-5-20251001-v1:0  # (opcional, tiene default)

# ── AWS (Bedrock) ──
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=ASIASS...
AWS_SECRET_ACCESS_KEY=t6Lv...
AWS_SESSION_TOKEN=IQoJb...              # ⚠️ Temporal: expira en ~1h (aws login)
```

### ⚠️ El problema del session token

Las credenciales AWS actuales vienen de `aws login` y expiran en ~1 hora.
Para producción se necesita una de dos cosas:

1. **IAM user con access key permanente** (recomendado): crear un usuario IAM en la cuenta
   177914733251 con permisos `bedrock:InvokeModel` sobre los modelos usados, y usar
   `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (sin `AWS_SESSION_TOKEN`).

2. **Refresco automático**: un cron que corra `aws login` y actualice el `.env`.

---

## 5. Modelos Bedrock disponibles (cuenta 177914733251)

Listados con `aws bedrock list-inference-profiles` al 30-jul-2026:

| Profile ID | Modelo |
|---|---|
| `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Claude Haiku 4.5 ← **usado** |
| `us.anthropic.claude-3-sonnet-20240229-v1:0` | Claude 3 Sonnet |
| `us.anthropic.claude-3-haiku-20240307-v1:0` | Claude 3 Haiku |
| `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Claude Sonnet 4.5 |
| `us.anthropic.claude-sonnet-5` | Claude Sonnet 5 |
| `us.anthropic.claude-opus-5` | Claude Opus 5 |

> **Nota**: estos son *inference profile IDs*, no model IDs. El SDK `@anthropic-ai/bedrock-sdk`
> los pasa directo a la URL de Bedrock como `/model/{profileId}/invoke`.

---

## 6. Cómo probar

### 6.1 Probar el ida y vuelta completo

1. Mandar un WhatsApp al **+51 984 429 504** desde el **955135507**
2. El bot responde automáticamente

### 6.2 Verificar los logs

```bash
ssh deploy@161.132.39.165 'sudo journalctl -u hermes -f --no-pager'
```

Líneas clave:
```
[wa in] de=51955135507 ... texto="Hola quiero más información"
[bot spike] respondiendo: ¡Hola! Soy Kathy Alva...
```

### 6.3 Simular lead nuevo (sin historial)

El contexto de lead ("Inteligencia y Contrainteligencia") se agrega solo en el PRIMER mensaje
(`historial.length === 0` en `webhook/whatsapp.ts:124`). Para probar como lead nuevo con el
contexto correcto, borrar los mensajes anteriores de la conversación o usar otro número.

### 6.4 Probar Bedrock directo (sin WhatsApp)

```bash
cd server && npx tsx src/scripts/probarCloudApi.ts
```

---

## 7. Limitaciones actuales del spike

| Qué falta | Por qué |
|---|---|
| **Debounce** | El bot responde a CADA mensaje. Si mandás 3 mensajes seguidos, responde 3 veces |
| **Cola / buffer** | No hay `bot_pendientes` ni `bufferSegundos`. La respuesta es inmediata |
| **Calificación de leads** | No se guarda en `bot_calificaciones` (frío/tibio/caliente) |
| **Historial real** | `hiloDe()` trae los mensajes almacenados en Hermes, que pueden incluir eco de respuestas anteriores del propio bot |
| **Detección de rechazo** | No usa `autorespuesta/rechazo.ts` para detectar "no me interesa" |
| **Límites de tasa** | No respeta `maxRespuestasHoraLinea` ni `maxTurnosDia` |
| **Modo sombra** | No hay: todo va directo al lead |
| ~~Solo responde al 955135507~~ | ~~Código hardcodeado en `webhook/whatsapp.ts:116`~~ **Resuelto (a7dc724)**: se eliminó el filtro por remitente. El bot responde a quien sea que escriba a las líneas habilitadas en `BOT_LINEAS` (config, no código) |
| **Credenciales AWS temporales** | Expiran cada ~1h con `aws login` |
| **Emojis** | El prompt permite que el bot use emojis (ej: 🎓). Si el dueño prefiere sin, hay que agregarlo al prompt |
| **Contexto de lead fijo** | Siempre dice "Inteligencia y Contrainteligencia" para el test. En producción vendrá del `referral` de Meta |

---

## 8. Próximos pasos (hacia el bot T2-T13)

| Ticket | Qué | Depende de |
|---|---|---|
| **IAM user** | Crear access key permanente para Bedrock | Bloquea todo lo demás |
| **T2** | Prompt y contexto de negocio (`prompt.ts`, `contexto.ts`) basado en el doc de Kathy | IAM user |
| **T4** | Agente con Anthropic SDK (`agente.ts`, tool runner) | T2 |
| **T5** | Ingesta, buffer, despachador (`decision.ts`, `despachador.ts`, `chunker.ts`) | T4 |
| **T6** | Takeover / derivación a humana | T5 |
| **T7** | Follow-up a leads fríos | T6 |
| **T8** | Simulacro + evals | T7 |
| **T9** | UI (chip, marcadores, revisión sombra) | T5 |
| **T10** | API routes (`routes/bot.ts`) | T9 |
| **T11** | Deploy, rollout, runbook | T10 |
| **T12** | Documentación final | T11 |
| **T13** | Banco de pruebas con escenarios reales | T8 |

El plan completo está en `docs/plan-bot-primera-linea.md`.
La decisión de arquitectura está en `docs/adr/0028-el-bot-de-primera-linea.md`.
