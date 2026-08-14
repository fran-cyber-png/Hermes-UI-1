# ADR 0056 — Editar un mensaje enviado (solo whatsmeow)

**Fecha**: 14-ago-2026
**Estado**: aceptado — toca `server/`, así que las dos mitades salen por **N5**
**Reemplaza**: nada. Es superficie nueva.
**Enmienda**: **ADR 0019** (las reacciones) y **ADR 0054** (las citas) como MOLDE — una edición cuelga
del mensaje, como una reacción, con una diferencia de fondo: **hoy solo una línea de las cuatro puede
hacerla**.

---

## El pedido

Del dueño, textual: «quiero poder editar el mensaje que envío si me equivoco». Un typo, un precio mal
tipeado — corregirlo en el propio WhatsApp del lead, como hace la app desde 2023.

## 🔴 Lo primero que hay que saber: la Cloud API de Meta NO LO TIENE

Verificado contra la documentación oficial de Meta el 14-ago-2026: **no existe ningún endpoint para
editar un mensaje ya enviado por el negocio** en la Cloud API — no hay `PATCH` de mensajes, solo `POST`
para mandar uno nuevo. Es una limitación de la plataforma, no de Hermes.

**whatsmeow sí puede**: el wrapper expone `editMessage(chat, id, message)` como método propio del
cliente (no algo armado a mano con `sendRawMessage`, como las citas) — el binario Go arma el
`protocolMessage` de edición él solo, sin la trampa de grafía `stanzaID` de ADR 0054 §2.

**Y desde el 13-ago-2026 Hermes-Escuela corre con UNA sola línea, y es la de Cloud API**
(`51984429504`). O sea: el día que se escribió este ADR, **ninguna línea viva puede editar un mensaje
en producción.** La función se construye igual —decisión del dueño, sabiendo esto— porque:

1. Es la forma correcta de resolverlo cuando vuelva a haber una línea whatsmeow viva.
2. El feature-detect (§2) hace que el costo de tenerlo construido y sin uso sea CERO: el botón
   simplemente no aparece en ninguna línea hoy.

Antes de prender cualquier línea whatsmeow pensando en esta función, verificar en vivo — no asumir que
sigue andando igual que cuando se escribió esto.

---

## Las decisiones

### 1 · El molde son las reacciones, en TODO — cuelga, no pisa

Igual que ADR 0054 §1: no es una fila nueva en `interactions` (duplicaría la burbuja) ni una columna
mutada en `envios_wa` (esa tabla es la AUDITORÍA de qué se mandó — pisar `texto` ahí le borraría a la
procedencia de #169 el contenido real que salió, que es justo lo que necesita para medir piezas). Es
una tabla propia, `ediciones_wa` (migración **0027**), con PK en el mensaje: **es un ESTADO, no un
historial** — editar de nuevo REEMPLAZA la fila, la misma semántica que WhatsApp le da a la reacción
(y a la propia edición: el teléfono solo muestra la versión más reciente en la burbuja). `texto` y
`editado_at` nada más — **ningún historial de versiones previas**, ni siquiera el original: eso vive
donde siempre vivió, en `interactions.texto` (que nunca se toca) y, si el mensaje vino de una pieza, en
`envios_wa.texto` (la auditoría).

Se resuelve donde se resuelven reacciones, citas y ✓✓: una segunda consulta en la ruta
(`edicionesPorMensaje`), no un tercer/cuarto JOIN en `hiloDe`.

### 2 · 🔴 `editarTexto` es OPCIONAL en la interfaz — feature-detectado, no if-por-transporte

`TransporteWhatsapp.editarTexto?` sigue el mismo patrón que `enviarPlantilla?` (al revés: allá solo
Cloud API la tiene, acá solo whatsmeow). El server publica `puedeEditar: Boolean(transporte.editarTexto)`
en `GET /api/whatsapp/sesion?numeroPropio=`, y el front lee esa bandera — **nunca** un `if (transporte
=== 'whatsmeow')` hardcodeado en dos lados, que es exactamente el tipo de duplicación que #37 viene a
prevenir. El día que la Cloud API sume esto (o que otro transporte nuevo no lo tenga), un solo lugar
cambia.

`TransporteFalso` SÍ lo implementa, a diferencia de la única línea real de hoy — a propósito: es lo que
permite probar el frente entero (ruta, dominio, UI) en dev y en los tests sin depender del binario real
ni de tener una línea whatsmeow vinculada.

### 3 · No pasa por `EnvioControlado` — mismo argumento que reaccionar

Corrige algo que YA le llegó a esa persona; no le manda nada a un destinatario nuevo. No hay pieza que
estampar de nuevo, y contarlo contra el ritmo (20/hora, 60/día) le robaría cupo a los envíos de verdad
por una tilde. Lo que sí se conserva: la guarda de línea equivocada y que no se edite con la sesión
caída o baneada — las mismas dos que protege `reacciones/enviar.ts`.

### 4 · El editor vive ADENTRO de la burbuja, no en un modal ni en el composer

A diferencia de Reenviar (ADR previo sin número, PR de cola-de-luz-y-reenviar del 14-ago), que carga el
composer porque construye un mensaje NUEVO, editar corrige a ESTE — sacarlo de su lugar le haría perder
el contexto (con quién, cuándo, si tenía un adjunto al lado). `EditorDeMensaje` reemplaza el cuerpo de
texto de la burbuja mientras está abierto; Guardar dispara la mutación optimista, Cancelar no manda
nada. `⌘↵`/Enter guarda, Escape cancela.

### 5 · Se ve, no se explica: «Editado», sin decir qué decía antes

Mismo trato que le da WhatsApp — la marca «Editado» al lado de la hora, sin el texto viejo a la vista
(no se guarda ningún historial, ver §1). Copiar y Reenviar leen el texto VIGENTE (`editado?.texto ??
texto`): reenviar una edición tiene que mandar la versión corregida, no la que tenía el error.

---

## Lo que NO entra

- **Editar en la Cloud API.** No existe del lado de Meta — no es una decisión de Hermes, es un límite
  de la plataforma (§ arriba).
- **Historial de ediciones** («ver versión anterior»). Es un estado, como las reacciones.
- **Editar un adjunto** (cambiar la imagen, el caption de un documento). Solo texto — mismo alcance que
  el `MessageContent` de `editMessage` en el wrapper.
- **Ventana de tiempo hardcodeada.** No se asume un plazo de WhatsApp para permitir o esconder el botón:
  si el protocolo lo rechaza por viejo, el 409 con el motivo llega igual, fail-loud como todo lo demás.

## Evidencia

Sin línea whatsmeow viva en producción al momento de este ADR (ver arriba), no hay captura de la
edición aplicándose de punta a punta contra WhatsApp real. Verificado con `TransporteFalso` (server:
`ediciones/editar.test.ts`, `.test.db.ts`) y con la UI mockeada (`editarEnHilo.test.tsx`). **Pendiente**:
capturar contra una línea whatsmeow real el día que vuelva a haber una viva — no marcar este frente como
verificado en producción hasta entonces (regla dura #2).
