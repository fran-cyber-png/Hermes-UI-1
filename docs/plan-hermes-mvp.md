# Plan MVP — Hermes: la mesa de la vendedora

> **Fecha:** 2026-07-21 · **Estado:** plan sintetizado (dominio + UI + slices + crítica adversarial),
> decisiones tomadas, implementación arrancada (S1). Reemplaza el alcance de
> `goberna-crm-wsp/plan-implementacion.md`. Complementa `docs/concepto.md` y `docs/adr/0001`.
> **Método:** producido con las skills `domain-modeling`, `codebase-design`, `tdd` (mattpocock) +
> `goberna-design-system` y `taste-skill` (marca/acabado), y sometido a crítica adversarial.

## 0. Qué es (una frase)

Una app de escritorio (Tauri; Electron se archivó en ADR 0039) donde **una vendedora atiende, desde una sola pantalla, a toda la gente
que levantó la mano** por Facebook, Instagram, Messenger y WhatsApp — con la **ficha del contacto**
(¿quién es? ¿ya compró?) al lado del chat, y **registrando la venta contra Cerberus** sin salir de ahí.

Principio rector heredado: **extensión/transporte flaco, Cerberus gordo.** Hermes es la cara; el ERP vive
en Cerberus. WhatsApp entra por un **transporte intercambiable** (whatsmeow hoy, Cloud API de Meta como
respaldo futuro) detrás de una costura — la app nunca sabe cuál está enchufado.

---

## 1. Modelo de dominio (lenguaje ubicuo)

| Término | Definición | Estado |
|---|---|---|
| **Evento** | Fila cruda e inmutable del event store; idempotente por `(source, externalId)`. | ✅ `events` |
| **Interacción** | Proyección de un evento conversacional: alguien levantó la mano en un canal. | ✅ `interactions` |
| **Canal** | Por dónde habló: `facebook`/`instagram`/`whatsapp`. Atributo, no tabla. | ✅ |
| **Conversación** | Vista derivada: las interacciones de un contacto en un canal (y un número, en WA), en el tiempo. | 🆕 **la construye S3** |
| **Cola** | La lista de trabajo, ordenada por urgencia real (ver §2 invariante de urgencia). | ✅ (se reescribe la regla) |
| **Ventana** | Los 7 días de Meta para el privado tras un comentario; se calcula en SQL. | ✅ |
| **Frescura** | Cuán vieja es la última captura, **por fuente** (ver decisión D3). | ✅ (se corrige) |
| **Transporte** | La costura con WhatsApp: habla **teléfonos**, jamás JIDs. | ✅ `transporte.ts` |
| **Sesión** | El vínculo de UN número propio con el transporte; su estado incluye `baneado`. | ✅ tipos / 🆕 impl |
| **Número propio** | El número de Goberna desde el que se atiende. Hermes es **multi-número**. | 🆕 **decisión D1** |
| **Vendedora** | La humana que atiende; se autentica contra Cerberus y **firma cada envío**. | 🆕 |
| **Envío** | UN mensaje de UNA vendedora a UN contacto, desde UN número. Sin firma de lista, por diseño. | ✅ interfaz / 🆕 registro |
| **Ficha** | Lo que se ve al lado del chat: ¿cliente? ¿compró? historial. Lectura, nunca edición del ERP. | 🆕 UI |
| **Registro de venta** | Asentar la venta **contra la API de Cerberus**; Hermes guarda solo la referencia. | 🆕 **S6b** |

### Invariantes (nunca se violan)
- **Append-only:** un evento jamás se borra ni se pisa; toda proyección se reconstruye desde `events`.
- **Un envío saliente siempre tiene `vendedoraId` y `numeroPropio`.** Sin humana identificada y sin número, no hay envío.
- **Una interacción entrante JAMÁS dispara respuesta automática.** El autor `bot` existe para medirse, no para vender.
- **El teléfono se guarda normalizado (canónico compartido con Cerberus) o no se guarda.**
- **`status` solo avanza por acción humana explícita.**
- **`baneado` se muestra siempre en la cara de la vendedora.** Ocultarlo es el peor error posible.
- **Ningún vocabulario ajeno cruza una costura:** ni JID, ni PSID crudo sin fila de identidad, ni estado numérico de Cerberus, ni codepoint fuera de latin1 hacia MySQL.

### Bounded contexts (dónde están las costuras)
- **Hermes — ATENCIÓN:** event store, proyecciones, cola, ventana, frescura, conversación, identidad de canal, registro de envíos.
- **Cerberus — ERP (Django/MySQL latin1):** `tb_cliente`, `tb_venta`, tesorería, matrícula, **auth de vendedoras**. Costura: API HTTP + login Django. Anticorrupción en el borde (sanitización latin1, mapa código→semántica de venta).
- **Transporte — PROTOCOLO WhatsApp:** JIDs, binario whatsmeow, QR/pair-code, credenciales, detección de ban. Costura: `TransporteWhatsapp`. *Si un JID aparece arriba de esta línea, la costura falló.*
- **Meta Graph — INGESTA oficial:** los ingestors por polling son adaptadores → eventos. Simétrico al transporte.

---

## 2. Módulos profundos (interfaz angosta, lógica escondida)

| Módulo | Interfaz pública | Qué esconde |
|---|---|---|
| **TransporteWhatsapp** ✅ | `iniciar/estado/onMensaje/onEstado/enviarTexto(telefono,texto)/marcarLeido/detener` — teléfonos, sin lista | Todo el protocolo: JIDs, subprocess Go, store cifrado, reconexión, QR, `temporary_ban` |
| **ProyectorWhatsapp** 🆕 S1 | `proyectar(m) → {evento, interaccion} \| {descarte}` — pura | Reglas de mapeo al canónico: dirección desde `esMio`, descarte de grupos, multimedia sin texto, prefijo de idempotencia |
| **ColaDeAtencion** 🆕 S3 | `claveUrgencia(interaccion, ahora) → number` + `GET /api/conversaciones` | Qué es "urgente" (ver invariante), el GROUP BY por contacto, el espejo SQL |
| **FichaDeContacto** 🆕 S6 | `ficha({canal, identificador}) → Ficha \| null` | HTTP a Cerberus, API-key server-side, normalización canónica, sanitización latin1, cache |
| **EnvioControlado** 🆕 S4 | `enviar({vendedoraId, numeroPropio, telefono, texto, ref}) → Resultado \| Rechazo` — una orden = un mensaje | Corta-corriente, verificación de sesión (baneado ⇒ rechazo visible), auditoría, registro del saliente |

---

## 3. UI (marca Goberna, producto inbox)

**Dirección visual:** light-mode institucional, azul `#2563EB` = acción, navy `#0E2A52` = estructura,
Montserrat 700/800 solo en nombres/títulos, mono para teléfonos/horas/contadores. **El dorado tiene UN
significado en Hermes: tiempo que se acaba** (chip de ventana, temperatura, frescura ámbar). Nunca CTAs ni
decoración. Acabado sobrio nivel soft-skill; cero mímica del verde de WhatsApp — Hermes se ve Goberna
aunque adentro viva un chat.

```
┌────────────────────────────────────────────────────────────────────────┐
│ [escudo]│HERMES · Bandeja    BarraFrescura   SelectorNumero   [ficha]   │  header 48px
├──────────────┬──────────────────────────────────────────┬─────────────┤
│ COLA 360px   │ CONVERSACIÓN ACTIVA (flex-1, min 460)    │ FICHA 296px │
│ [filtros]    │ CabeceraConversacion                     │ Identidad   │
│ fila ◀──     │ BannerSesion (solo si hay problema)      │ ─────────── │
│ fila         │ HILO (scroll propio)                     │ Cerberus    │
│ fila         │   burbujas entrante/saliente             │ ¿cliente?   │
│ [Ver más]    │ CajaEnvio (Enviar = primario azul)       │ [Reg.venta] │
└──────────────┴──────────────────────────────────────────┴─────────────┘
```

- **La cola es una sola lista; el canal es una insignia (`BadgeCanal`), no una columna.** Nadie decide a quién responder según por dónde le escribieron. Banda de temperatura a la izquierda de cada fila (lectura periférica de urgencia).
- **Conversación:** conmutador — WhatsApp → `HiloWhatsapp` + `CajaEnvio`; comentario FB/IG → `ResponderPanel` existente re-encajado (deja de ser modal, mismo flujo privado-antes-que-público); DM Messenger → lectura + caja deshabilitada honesta ("abrilo en Business Suite").
- **Burbujas:** entrante `bg-card` izq, saliente `bg-secondary` (navy sobre celeste, no verde WhatsApp). Multimedia → burbuja punteada honesta "velo en el teléfono". Envío fallido → "Reintentar" **manual**.
- **`BannerSesion`** mapea los 6 estados; `baneado` = franja roja ancho completo, sin cerrar, con fecha de expiración, y caja deshabilitada. El ban **apaga UN canal, no la app**.
- **`FichaContacto`:** identidad + `BloqueCerberus` con **4 estados** (cliente / persona nueva / cargando / Cerberus caído — jamás mostrar "no figura" cuando la API falló) + historial + `BotonRegistrarVenta` navy.
- **Estados vacíos honestos:** un cero puede ser "no hay trabajo" o "no estoy mirando" — cada vacío declara cuál.

Componentes nuevos: `ColaUnificada, FilaConversacion, BadgeCanal, ChipUrgencia, ConversacionActiva, HiloWhatsapp, BurbujaMensaje, SeparadorDia, CajaEnvio, BannerSesion, VinculadorQR, SelectorNumero, FichaContacto, BloqueCerberus, BotonRegistrarVenta, EstadoVacioConversacion`.
Se reusan: `BarraFrescura, temperature.ts, ResponderPanel, HistorialPersona, QuePuedoHacer, Bandeja/useBandeja/useInteracciones`. `PanelWhatsapp` (webview) queda de respaldo hasta paridad, luego se archiva con ADR.

---

## 4. Decisiones que toma este plan (resolviendo la crítica)

| # | Decisión | Por qué |
|---|---|---|
| **D1** | **Hermes es multi-número desde el modelo.** `MensajeWhatsapp` lleva `numeroPropio`; la clave de conversación es `(numeroPropio, telefono)`; `enviar` incluye `numeroPropio`. | El usuario tiene **varios celulares/números**. Sin esto los hilos de dos números a la misma persona se mezclan y la respuesta sale por el número equivocado. Es anterior a S1 (cambia la proyección). |
| **D2** | **La cola sirve CONVERSACIONES, no filas sueltas.** `GET /api/conversaciones` agrupa por `(canal, contacto[, numeroPropio])`: último texto, último entrante sin responder, urgencia. "Respondida" = existe saliente posterior al último entrante (derivada, no `status` de fila). | Con el stream vivo, un chat de 20 mensajes serían 20 filas en la bandeja. La UI ya asume conversaciones. |
| **D3** | **Frescura por fuente.** Meta = edad de la ingesta; WhatsApp = estado de la sesión (no edad). La barra muestra la peor. | Si no, el stream de WA mantiene "fresca" la barra para siempre mientras el polling de Meta está muerto 10 días — resucitando la calma falsa que la barra nació para matar. |
| **D4** | **Identidad de vendedora ANTES que el login lindo.** Un token mínimo por vendedora (`WA_VENDEDORA_TOKENS`) va delante de S4/S5; el login Django (S7) queda último. Cada envío nace con `vendedoraId` real, nunca hardcodeado. | Si el login llega al final, toda la auditoría previa miente y la comisión en Cerberus nace corrupta. |
| **D5** | **Claim optimista de conversación.** Al abrir un chat se marca "la está atendiendo Ana" (visible en la fila, TTL corto). | Cola compartida sin claim ⇒ dos vendedoras responden a la misma persona ⇒ el cliente recibe doble mensaje. |
| **D6** | **Urgencia en dos niveles, no un escalar.** Primero lo que **expira** (ventana Meta, más viejo arriba); después lo que **espera** (WhatsApp, por antigüedad del último entrante sin responder). | Mezclar deadline duro (Meta: capacidad que se pierde para siempre) con cortesía blanda (WA 24h) entierra lo que se pierde debajo de lo que se puede contestar mañana. |
| **D7** | **Idempotencia por fuente.** El `externalId` de WhatsApp se prefija (`wa:...`); un id de WA no puede tragarse un `comment_id` de Meta. | `interactions.external_id` es unique GLOBAL; sin prefijo, colisión silenciosa. |
| **D8** | **UN normalizador canónico compartido**, el del contrato de Cerberus (dígitos + prefijo 51, colapsa doble `5151`, quita troncales), en `server/src/cerberus/`. `lazo/normalizar.ts` queda solo para hashes de Meta. | Hay dos "canónicos" que no coinciden ⇒ ficha que no matchea según qué código la llame. |
| **D9** | **latin1: el enemigo son los emojis, no los acentos.** La sanitización del borde translitera/quita codepoints fuera de latin1 y **deja á/é/ñ intactos**. | `pushName` de WhatsApp viene "María 🌸"; el emoji revienta el INSERT, el acento no. |
| **D10** | **Registro de envío con estado** (`pendiente → enviado \| fallido`). El saliente entra a `interactions` SOLO con el `idExterno` del `ResultadoEnvio`; el fallo queda como intento auditado + "Reintentar" manual. | Evita el saliente fantasma (registrado pero nunca salió) y el envío real sin auditoría. Cubre el TOCTOU del ban entre chequeo y send. |
| **D11** | **Banner honesto de historial vacío.** "Esta conversación se ve desde el {fecha de vinculación}; lo anterior está en el teléfono." | whatsmeow no da historial: el hilo arranca vacío el día 1. Misma filosofía que la BarraFrescura, costo casi cero. |
| **D12** | **La distinción de política va escrita al ADR de Hermes.** La regla 2026-07-03 prohíbe stacks no oficiales *para clientes*; Hermes es la Escuela (negocio propio, números propios, riesgo de ban aceptado y visible). | Cuando un cliente pida "lo mismo", tiene que haber un papel que diga por qué no. |
| **D13** | **Vinculación SERVER-SIDE, en un entorno aparte.** La sesión de whatsmeow vive en VPS1, no en la app de cada vendedora. El QR/pair-code se hace UNA VEZ por número en una **consola de operador** (protegida, en el server). La app de la vendedora NO vincula: solo ve el estado del número (conectado/desconectado) y el hilo. El webview per-app se retira. | Resuelve el "preconfigurado" (Estephano): la vendedora abre y el número ya está. Escala a N vendedoras sin N escaneos, y las credenciales nunca tocan la máquina de la vendedora. |
| **D6-bis** | **WhatsApp VIVO al tope.** La urgencia tiene 4 niveles: 0 vivo (mensaje sin responder con entrante < 24h), 1 expira (ventana Meta), 2 espera (mensaje viejo sin responder), 3 resto. | Goberna vende por WhatsApp: un chat activo es lo más urgente. Con ~60k comentarios de ventana abierta, "expira primero" enterraba al que está comprando ahora. |

---

## 5. Decisiones de Estephano (2026-07-21) — RESUELTAS

1. **Topología → VPS1.** El server (hermes-server + whatsmeow + Postgres) corre en VPS1, no en la laptop. Gate antes del whatsmeow real. Pendiente técnico: verificar el catch-up de mensajes offline de `@whatsmeow-node` al reconectar.
2. **`marcarLeido` → SÍ**, al abrir la conversación (ticks azules). Es la única automatización, y es la que un humano espera al abrir un chat.
3. **Identidad → match SOLO por teléfono** por ahora. `tb_contacto_canal` (unificación cross-canal) queda para después; dueño/migración pendiente, no bloquea. La ficha no dibuja unificación que no existe.
4. **Vinculación → server-side (D13).** La sesión vive en VPS1; se vincula en la consola del operador; la app de la vendedora solo ve.

---

## 6. Slices verticales (orden de construcción)

Cada slice es una tira fina punta-a-punta demostrable. Base ya verde: **TransporteFalso (8 tests)**.

| Slice | Entrega | Quién | Gate |
|---|---|---|---|
| **S0** whatsmeow real | Adaptador `TransporteWhatsapp` sobre whatsmeow (JID→teléfono adentro, store cifrado) | **EQUIPO** (Claude no escribe protocolo) | Pasa la suite de contrato (T13) + QR + ida/vuelta real + ban visible |
| **S1** Proyección msg→canónico | `proyectar(MensajeWhatsapp) → {evento, interaccion}`: dirección, autor, grupo descarte, multimedia, `numeroPropio`, prefijo `wa:` | **Claude — EN CURSO** | T1–T5 verdes |
| **S2** Persistencia + idempotencia | Ingesta que suscribe `onMensaje` y persiste vía S1 en `events`/`interactions`. Falso enchufado por env | **Claude** | T6; doble id → 1 fila; aparece en la API |
| **S3** Cola de **conversaciones** | `GET /api/conversaciones` (GROUP BY, "respondida" derivada, urgencia D6) + bandeja con 4 canales mezclados | **Claude** | T7–T8 + screenshot desktop+mobile |
| **S4** Guardas de envío | `EnvioControlado`: única puerta a `enviarTexto`, exige vendedora+número, auditoría, corta-corriente, rechazo si baneado (D4/D10) | **Claude** | T9–T12 + grep: nadie llama `enviarTexto` directo |
| **S5** Conversación nativa + envío | Hilo + caja + envío por acción humana; estado de sesión visible; claim (D5); banner historial (D11) | **Claude** (demo con falso; cutover a whatsmeow sin tocar el slice) | Flujo completo contra el falso + ban deshabilita la caja |
| **S6** Ficha por teléfono | Ficha resuelta por teléfono canónico (D8) contra mock de Cerberus; 4 estados; latin1 (D9) | **Claude** (mock) / real requiere **Cerberus** | T14 + screenshot ficha al lado |
| **S6b** Registrar venta | Formulario + `POST venta` contra Cerberus; persistir `cerberusVentaId`. Requiere `GET productos` en el contrato v1.1 | **Claude** (mock) / **Cerberus/Andreecito** | Venta de prueba por API ≡ por la UI de Cerberus |
| **S7** Login vendedoras | Login contra Django auth; el `vendedoraId` deja de ser token mínimo | **Cerberus** | Sin sesión no hay bandeja |

**Fuera del MVP (scope creep a cortar para "solución YA"):** hilo Messenger de respuesta (basta lectura + deep-link), `vincularConCodigo`, atajo del vacío, navegación completa por teclado, unificación cross-canal en la ficha. **El MVP que vende: una vendedora, sus números, cola mezclada honesta, hilo + envío con guardas, ficha por teléfono, ban visible.**

---

## 7. Plan de tests (rojo → verde, un slice por ciclo)

| # | Test | Archivo |
|---|---|---|
| T1 | Entrante → interacción `{canal:whatsapp, direccion:entrante, autor:persona, personaId:telefono, externalId:'wa:'+id}` | `proyectar.ts` |
| T2 | `esMio:true` → `saliente`, `autor:pagina` | `proyectar.ts` |
| T3 | `esGrupo:true` → descarte con motivo | `proyectar.ts` |
| T4 | `multimedia` → `texto:null`, clase cruda queda en el payload | `proyectar.ts` |
| T5 | Determinismo de idempotencia: mismo mensaje → misma clave | `proyectar.ts` |
| T6 | Ingesta idempotente (repo en memoria): doble id → 1 interacción | `ingesta.ts` |
| T7 | Urgencia intra-Meta: FB a 6 días ordena antes que uno de 1 hora | `cola/urgencia.ts` |
| T8 | Cola mezclada dos niveles (D6): expira primero, espera después | `cola/urgencia.ts` |
| T9 | Una orden = un envío: `enviarTexto` llamado exactamente 1 vez + auditoría | `envioControlado.ts` |
| T10 | Sin vendedora/número/ref → rechazo, el transporte no recibe nada | `envioControlado.ts` |
| T11 | Corta-corriente → rechazo con motivo, 0 llamadas, intento auditado | `envioControlado.ts` |
| T12 | Ban propagado → estado lo refleja, `enviar` rechaza sin reintentar; **T9b** ban entre chequeo y send | `envioControlado.ts` |
| T13 | **Suite de contrato del transporte** (parte pura ejecutable contra falso y whatsmeow) + JID con sufijo device y `@lid` | `whatsapp/contrato.test.ts` |
| T14 | `elegirContacto`: match canónico gana; fallback sufijo-9 solo móvil PE; sin match → null | `cerberus/elegirContacto.ts` |

Ya verdes de base: 8 tests de `TransporteFalso` + 17 de `normalizarTelefono`. Mecánica: un test rojo → mínimo → siguiente; nada de escribir los 14 de una vez. Refactor al cierre de cada slice con code-review. Gates de UI (S3, S5, S6) no cierran sin screenshot Playwright desktop+mobile (regla dura #2).
