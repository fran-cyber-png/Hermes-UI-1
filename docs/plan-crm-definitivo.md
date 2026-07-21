# Hermes CRM definitivo — el mapa y la ruta

> **Fecha:** 2026-07-21 · **Estado:** aprobado por Estephano (sesión "crm-definitivo").
> **Qué es:** el norte de producto de Hermes — el mapa completo de funcionalidades de un CRM
> profesional contrastado contra lo que Hermes ya es, y la ruta por horizontes para llegar
> "a algo avanzado pero con nuestro estilo Goberna".
> **No reemplaza** a `plan-hermes-mvp.md` (el MVP y sus decisiones D1-D13 siguen vigentes);
> lo extiende hacia adelante. El anexo técnico del primer paso es `plan-panel-contexto.md`.
> **Cómo se produjo:** investigación en 3 frentes (código de Hermes/meta-escuela/Ivi + docs
> heredados + barrido de 14 CRMs del mercado 2025-26) y diseño con crítica adversarial.

## 0. La tesis (leé solo esto si tenés 1 minuto)

Hermes ya tiene **el diferenciador que casi nadie del mercado tiene**: los comentarios de
Facebook/Instagram como conversaciones *trabajables* en el mismo inbox que los DMs y WhatsApp,
con el privado-antes-que-público resuelto. De los 14 CRMs relevados, solo Kommo se acerca.

Lo que nos falta se divide en dos: **table-stakes** (etiquetas, respuestas rápidas, notas,
asignación, dashboard — lo que cualquier CRM da por default) y **cuatro diferenciadores** que
calzan con piezas que ya existen en la casa: el **panel de contexto** (qué publicación, qué
curso), la **atribución CTWA con lazo de vuelta a Meta** (el webhook y el lazo CAPI ya están
escritos), el **embudo visible** (kanban de la misma cola), e **Ivi como copiloto** (la analista
ya corre, con su Ley de Oro de números deterministas).

El estilo Goberna no se negocia en el camino: estados honestos, cero bots que venden solos,
cero broadcast masivo, la vendedora firma cada envío, y el dorado significa una sola cosa —
tiempo que se acaba.

---

## 1. Tenemos vs. tienen (el mercado 2025-26)

Relevados: Kommo, respond.io, Callbell, Leadsales, B2Chat, Wati, Trengo, Chatwoot, HubSpot,
Zoho, Treble, Zenvia/Sirena, Cliengo, SleekFlow.

| | Hermes hoy | El mercado |
|---|---|---|
| Comentarios FB/IG trabajables en el inbox | ✅ con privado-antes-que-público | Solo Kommo se acerca; respond.io lo tiene como feature request abierto; el resto solo DMs |
| Cola por urgencia real (expira primero) | ✅ 4 niveles (D6) | Nadie — todos ordenan "más reciente arriba" |
| Venta contra el ERP desde el chat | ✅ (GOB-13942 probado) | Integraciones genéricas; ninguno escribe en TU ERP |
| Honestidad de datos (frescura por fuente, ban visible, estados "no sé") | ✅ | Nadie lo hace explícito |
| Etiquetas, respuestas rápidas, notas, claim, dashboard | ❌ | Table-stakes universal |
| Pipeline/kanban de ventas | ❌ | Kommo, Leadsales, respond.io, HubSpot, Zoho |
| Atribución CTWA (ctwa_clid → CAPI de vuelta) | ⚙️ piezas escritas, sin cablear | respond.io (automático), Kommo, Treble, Wati, SleekFlow |
| AI copilot (resumen, sugerencias) | ⚙️ Ivi existe, sin conectar | Kommo AI, Chatwoot Captain, respond.io AI |
| Identidad unificada cross-canal | ❌ (match solo por teléfono) | Kommo, respond.io, HubSpot, Zoho |
| WhatsApp API oficial | ❌ (whatsmeow, riesgo aceptado D12; transporte intercambiable) | El mercado la trata como higiene; los no-oficiales (Leadsales) cargan riesgo de ban |

Referencia de precios del mercado (por si algún día esto se vende): piso serio $15-25/usuario/mes
(Kommo, Callbell); suites omnicanal con IA $79-399/mes por paquete; HubSpot con WhatsApp ~$890/mes.

---

## 2. El mapa de funcionalidades (dominio por dominio)

Leyenda: ✅ hecho y probado · ⚙️ piezas existentes sin cablear · 🔜 diseñado (anexo S8) ·
❌ no existe · **H#** = horizonte del roadmap (§4).

### D1 — Inbox omnicanal

| Función | Hoy | Cómo debe ser (estilo Goberna) | Horizonte |
|---|---|---|---|
| Cola unificada FB/IG/Messenger/WA | ✅ | Como está: una lista, el canal es una insignia, no una columna | — |
| Urgencia honesta | ✅ 4 niveles D6 | Como está: vivo → expira → espera → resto | — |
| Tiempo real | ✅ SSE | Como está | — |
| Hilo de Messenger | ❌ dead-end | Read-only con las dos mitades + caja deshabilitada honesta con motivo + deep-link a Business Suite | 🔜 S8f (H1) |
| Búsqueda de conversaciones | ❌ | Por nombre/teléfono/texto, en la cabecera de la cola | H2 |
| Filtros | ❌ | Por canal, estado, etiqueta — chips, no menús anidados | H2 |
| Claim/asignación (D5) | ❌ | "La está atendiendo Ana" visible en la fila, TTL corto; cola "sin asignar" | H2 |
| Ventana 24h/7d visible | ✅ | Como está: chip dorado = tiempo que se acaba | — |

### D2 — Contacto 360

| Función | Hoy | Cómo debe ser | Horizonte |
|---|---|---|---|
| Ficha Cerberus por teléfono | ✅ 4 estados honestos | Como está | — |
| Historial por canal | ✅ `/api/persona` | Como está; cross-canal recién con identidad unificada | — |
| **Crear cliente para lead nuevo** | ❌ la venta exige cliente existente | ClienteForm + formset de teléfono contra Cerberus, desde el mismo panel de venta | **H1 (primero)** |
| Identidad cross-canal | ❌ | `tb_contacto_canal` en Cerberus (coordinación Andreecito); la ficha nunca dibuja unificación que no existe | H4 |
| Notas internas del contacto | ❌ | Texto libre en el panel, con autora y fecha; nunca viaja a Cerberus | H2 |
| Etiquetas de contacto/conversación | ❌ | Pocas, de colores, compartidas por el equipo; sin taxonomías infinitas | H2 |

### D3 — Contexto y atribución (el corazón de este plan)

| Función | Hoy | Cómo debe ser | Horizonte |
|---|---|---|---|
| Panel de contexto (publicación + curso) | ❌ | Entidad `contexts`: imagen, texto completo, permalink; curso inferido **con fuente declarada** ("lo pidió en su mensaje" / "inferido del anuncio" / "del texto del post") o silencio | 🔜 S8 (H1) |
| Origen del lead WhatsApp | ✅ anuncio/landing | Como está (BadgeOrigen) | — |
| Comentario → anuncio | ⚙️ join local `contexto_id` ↔ `effective_object_story_id` (pautaSnapshots) | Cablear; cobertura ~31% declarada en la UI, dark posts fuera | 🔜 S8c (H1) |
| CTWA `ctwa_clid` | ⚙️ webhook escrito y probado | Cloud API + número WABA; el referral entra como evento | H4 |
| Lazo venta → CAPI | ⚙️ heredado, en pausa (fail-closed) | Reactivar con dueño claro: cada venta confirmada vuelve a Meta y la pauta se optimiza con ventas reales | H4 |
| Atribución Messenger | ❌ (por polling no existe — verificado v25.0) | Webhook `messages` + `messaging_referrals` | H4 (S11) |

### D4 — Pipeline / embudo

| Función | Hoy | Cómo debe ser | Horizonte |
|---|---|---|---|
| Estado por conversación | ✅ `status` (avanza solo por acción humana) | Como está — es la base del kanban | — |
| Vista Embudo (kanban) | ❌ | La MISMA cola como tarjetas arrastrables entre etapas fijas Goberna (no configurables: simplicidad opinada) | H3 |
| Conversión por etapa | ❌ | Números honestos por etapa y por vendedora | H3 |
| Registrar venta | ✅ contra `crear_venta` | Como está; Cerberus sigue gordo | — |
| Origen/Medio | ✅ inferidos, no elegidos | Como está | — |

### D5 — Productividad de la vendedora

| Función | Hoy | Cómo debe ser | Horizonte |
|---|---|---|---|
| Respuestas rápidas | ❌ | Atajos (`/precio`) que **pegan texto en la caja**; la humana SIEMPRE edita y envía — no es auto-respuesta | H2 |
| Notas internas + @menciones | ❌ | Nota en el hilo visible solo para el equipo | H2 |
| Tareas / recordatorios | ❌ | "Volver a escribirle el lunes" — recordatorio que sube la conversación en la cola, jamás envía solo | H3 |
| Snooze | ❌ | Ocultar hasta {fecha} con motivo visible | H3 |
| marcarLeído al abrir | ✅ | Como está (la única automatización, D-2) | — |
| Multi-número | ✅ D1 | Como está | — |

### D6 — Métricas (la vista Tablero)

| Función | Hoy | Cómo debe ser | Horizonte |
|---|---|---|---|
| Frescura por fuente | ✅ (único en el mercado) | Como está, promovida al Tablero | — |
| Tiempo de 1ra respuesta | ❌ | Por vendedora y por canal, en lenguaje humano | H3 |
| Esperando respuesta | ✅ parcial (`pide_info`) | Cifra héroe del Tablero: "N personas esperan hace más de X" | H3 |
| Conversión por vendedora | ❌ | De conversación a venta registrada (ya tenemos las dos puntas) | H3 |
| Embudo canal → venta | ❌ | Comentario → WhatsApp → venta (el 61% de los cierres es WA: mostrarlo) | H3 |

### D7 — Ivi copiloto

| Función | Hoy | Cómo debe ser | Horizonte |
|---|---|---|---|
| Contexto determinista en el panel | ❌ | **F1 — entra en el MVP del panel** (S8): publicación, curso, historial; sin LLM | 🔜 H1 |
| "Preguntale a Ivi" | ❌ | F2 — proxy server-side (`POST /api/ivi/preguntar`, contexto ≤800 chars, `requiereVendedora`); degradación honesta en 3 estados (sin configurar → no existe el bloque; timeout → "la máquina puede estar apagada"; 503 → el mensaje de Ivi) | H5 |
| Hermes como mundo de Ivi | ❌ | F3 — tools read-only `goberna.atencion.*` en el SDK propio (ya montado en `index.ts:65` con Ivi anticipada); el cableado del lado Ivi es de meta-escuela | H5 + ADR |
| Resumen / respuesta sugerida | ❌ | Con **Ley I** (números solo deterministas; el LLM presenta) y firma humana obligatoria | H5 |
| Transcripción de audios | ❌ | Evaluar recién en H5 — hoy es hype en todo el mercado | H5± |

### D8 — Administración y seguridad

| Función | Hoy | Cómo debe ser | Horizonte |
|---|---|---|---|
| Login contra Cerberus + token HMAC | ✅ | Como está | — |
| EnvioControlado con auditoría | ✅ | Como está: única puerta a `enviarTexto` | — |
| Ban visible siempre | ✅ | Como está — ocultarlo es el peor error posible | — |
| Vinculación server-side (D13) | ✅ | Como está | — |
| Log de consultas de ficha + alerta de anomalía | ❌ | Cada consulta a Cerberus queda logueada con vendedora; anomalía = aviso (es lo único que atrapa al de la cámara) | H4 |
| Marca de agua con nombre | ❌ | Sutil, en la zona de la ficha (disuade la foto y la vuelve atribuible) | H4 |

### D9 — Lo que NO hacemos (decisión, no carencia)

| Función del mercado | Por qué NO |
|---|---|
| Bots que venden solos / auto-respuesta | Invariante de Hermes: un entrante JAMÁS dispara respuesta automática. El autor `bot` existe para medirse, no para vender |
| Broadcast masivo | Política Goberna 2026-07-03; un envío = una acción humana |
| Warmup / anti-ban / rotación de números | Prohibido; el ban se muestra, no se esquiva |
| Scoring predictivo de leads | Hype sin sustancia (verificado en el mercado); mentiría con seguridad |
| Export / listados masivos | API de menor privilegio a propósito (`concepto.md` §6): solo la ficha del chat abierto |
| Multi-tenant SaaS | Hermes es la mesa de Goberna, no un producto a revender (por ahora) |

---

## 3. La arquitectura de información: de una pantalla a un espacio con vistas

Hermes nació "sin router — una sola pantalla". Un CRM profesional no entra en una pantalla,
pero el espíritu se conserva: **la Bandeja sigue siendo la casa** (el 90% del tiempo de la
vendedora) y las demás vistas son ángulos de los MISMOS datos, nunca secciones con vida propia.
Decisión documentada en `adr/0002-espacio-con-vistas.md`.

```
┌──────────────────────────────────────────────────────────────────────┐
│ [escudo]│HERMES   Bandeja · Embudo · Personas · Tablero    [número ▾]│
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  BANDEJA  = cola 360px · conversación flex · panel 296px             │
│             (ficha Cerberus si WA · panel de contexto si Meta)       │
│  EMBUDO   = las mismas conversaciones como tarjetas por etapa        │
│  PERSONAS = búsqueda + ficha 360 (Cerberus + historial + orígenes)   │
│  TABLERO  = frescura · esperando respuesta · 1ra respuesta ·         │
│             conversión por vendedora · embudo canal→venta            │
└──────────────────────────────────────────────────────────────────────┘
```

Reglas (heredan `goberna-design-system` + `plan-hermes-mvp.md` §3):
- Navegación por **máquina de estados, sin URLs** (el patrón del panel Bravo). 4 vistas, ni una más.
- **Una acción primaria por pantalla.** En Bandeja es Enviar; en Embudo, mover de etapa; en
  Personas, registrar venta; en Tablero, ninguna (se mira, no se toca).
- **El dorado conserva su único significado**: ventana/urgencia/frescura. El chip de curso es
  navy; los CTAs son azul `#2563EB`; jamás dorado decorativo.
- Cada cifra en **lenguaje humano** ("14 personas esperan hace más de un día", no "AVG_FRT 26h").
- Cada vacío declara su porqué (¿no hay trabajo o no estoy mirando?).
- Mockups hi-fi en `prototypes/crm-definitivo/` (bandeja, embudo, personas, tablero) con
  screenshots en `img-mock-*.png`.

---

## 4. La ruta por horizontes

Cada horizonte es entregable y demostrable por sí solo; ninguno depende del siguiente.

**H1 — La venta completa** *(lo próximo a construir)*
1. Crear cliente para lead nuevo (destraba registrar ventas a desconocidos — plata directa).
2. Panel de contexto S8a-S8f (`plan-panel-contexto.md`): ingesta ampliada, tabla `contexts`,
   curso inferido, hilo Messenger, panel derecho para Meta.
3. La Bandeja rediseñada llega con este panel (mockup `bandeja.html`).
En paralelo (operativo, fuera de este plan): deploy VPS1 · resolver `@lid` · clic CTWA real.

**H2 — Table-stakes de equipo** *(la base para >1 vendedora)*
Etiquetas · respuestas rápidas · notas internas · claim D5 · búsqueda y filtros en la cola.

**H3 — El embudo visible**
Vista Embudo (kanban) · tareas/recordatorios/snooze · Tablero (1ra respuesta, esperando,
conversión por vendedora, embudo canal→venta). Mockups `embudo.html` y `tablero.html`.

**H4 — Cerrar el lazo**
Cloud API + WABA → CTWA `ctwa_clid` real → venta → CAPI de vuelta (la pauta se optimiza con
ventas reales; hoy respond.io cobra por esto y nosotros tenemos las dos puntas en el repo) ·
webhook Messenger (S11) · identidad cross-canal (`tb_contacto_canal`, con Andreecito) ·
log de fichas + marca de agua.

**H5 — Ivi en la mesa**
F2 "Preguntale a Ivi" (proxy + degradación honesta) · F3 Hermes como mundo (`goberna.atencion.*`)
· resumen/respuesta sugerida con Ley I y firma humana. Recién acá se evalúa transcripción de audios.

---

## 5. Los números que sostienen la oportunidad

- 94.371 interacciones capturadas al extraer Hermes; **~17.000 pidiendo información, cero
  atendidas** (ADR 0001). El inventario ya existe; falta la mesa que lo trabaje.
- **61% de los cierres pasan por WhatsApp** (`mundo-goberna.md`): el embudo comentario→WA→venta
  es EL flujo, por eso contexto y atribución valen plata.
- 31,6% de los comentarios de FB son atribuibles a un anuncio con el join local (RG-005) — y hoy
  se pierde el 100% de esa señal en la UI.
- La atribución de ventas a pauta cubre 0,5% (runbook CTWA heredado); el lazo CAPI existe y está
  en pausa. Cerrarlo es H4, no ciencia nueva.
