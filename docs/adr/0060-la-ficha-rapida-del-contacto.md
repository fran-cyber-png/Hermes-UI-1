# ADR 0060 — La ficha rápida del contacto, y las acciones del chat

**Fecha**: 2026-08-18 · **Estado**: aceptado · **Complementa**: ADR 0017 (el panel derecho),
ADR 0037 (el timeline escribible), ADR 0044/0049 (el embudo derivado)

---

## El problema

La barra del chat tenía dos botones al lado que decían casi lo mismo —**«Agendar»** y
**«Registrar»**— y ninguno de los dos hacía lo que un vendedor espera de «registrar un contacto».
`Registrar` anota un HECHO tipado en el timeline (ADR 0037); el contacto, como dato, no se registra
en ningún lado.

Y no se podía, porque **no había dónde**: el cliente vive en Cerberus (que no tiene API REST — se le
postea el formulario), el padrón es una copia **read-only** de icarus, y `leads` lo llenan los
formularios de Meta. Lo que la vendedora AVERIGUA en la conversación —el apellido real, la empresa,
un correo dictado por chat— se perdía en el hilo o terminaba en un cuaderno.

Medido en el árbol antes de tocar nada, tres cosas más:

| | |
|---|---|
| La UI de importancia del calendario | escrita, dibujada y **sin columna en la base** |
| `PATCH /api/agenda/:id` | leía sólo `estado` y **escribía `pendiente` cuando no venía** |
| El tipo de una actividad (llamada, reunión…) | se **adivinaba del prefijo de la nota** |

Las dos primeras son un solo defecto con dos caras: el front ya mandaba `PATCH {cuando}` al
arrastrar en el calendario y `PATCH {importancia}` al pintar el punto de color, así que **arrastrar
una tarea no la movía y encima devolvía a `pendiente` una que estaba hecha**. Sin síntoma: la
respuesta era 200 y la fila existía.

---

## La decisión

### 1. Hermes gana una ficha del LEAD, no del cliente

Tabla `contacto_ficha` (migración `0030`), llaveada por **`clave`** como todo lo demás que se dice
sobre una conversación (`gestiones`, `intereses`, `etiquetas`, `eventos_contacto`). Guarda sólo lo
que Cerberus no sabe: nombre, apellido, empresa, correo, prioridad.

**Cerberus sigue siendo el dueño del CLIENTE.** `panel/identidad.ts` no cambia: Cerberus > formulario
> alias de WhatsApp, y esta ficha completa lo que falta. Hermes flaco, Cerberus gordo.

### 2. El duplicado se CONTESTA, no se bloquea

Al registrar se busca la misma persona (teléfono normalizado a E.164, correo sin distinguir
mayúsculas) **en otras conversaciones**. Si aparece, la respuesta trae **la ficha que ya existe** y
la pantalla ofrece abrir ese chat o registrar igual acá: dos conversaciones de la misma persona son
un hecho, no un error de tipeo.

⚠️ Va como **200 con `ok: false`** y no como 409: `ErrorApi` (`lib/datos/cliente.ts`) sólo transporta
`message`, así que por la vía del error la otra ficha —lo único que hace accionable el aviso— no
llegaría.

### 3. El registro rápido COMPONE lo que ya existe

El drawer trae los datos de la persona **y monta el mismo componente `Intereses`** contra la misma
tabla. No reimplementa el interés, ni las etiquetas, ni el asesor asignado (eso es del reparto, con
su propio rastro de quién decidió qué). Un formulario que copia esos campos crearía **dos lugares
diciendo qué quiere el mismo lead**, que es el defecto #37 del repo.

### 4. La barra del chat se ordena en una zona de acciones

`Registrar contacto` (primaria, y **se adapta**: con ficha muestra el nombre) · `Agendar` · `Anotar`
· `···`.

- **`Registrar` pasó a llamarse `Anotar`.** Lo que hace no cambió (ADR 0037 sigue vigente en cada
  palabra): es un hecho tipado que cae en el timeline. Cambió el rótulo porque al lado quedó el botón
  que registra el CONTACTO, y dos «Registrar» en la misma barra no se distinguen.
- **La etapa pasó de segmented a dropdown.** Cinco botones se llevaban ~180 px de una barra que a
  1280 ya no daba. **Esto no reabre ADR 0044**: lo declarado sigue siendo un PISO que sólo empuja
  hacia arriba, `perdido` sigue pidiendo confirmación y `sin_respuesta` sigue sin poder declararse
  —se deriva, y deja de ser cierta sola.

### 5. Lo que se prometió, arriba del hilo

`ProximoSeguimiento` dibuja la promesa pendiente de esa conversación con sus tres salidas —
reprogramar, completar, cancelar. **No aparece si no hay nada pendiente**: un banner que dice «no hay
seguimientos» ocupa lo mismo que uno que avisa algo, y enseña a no mirarlo.

### 6. La agenda guarda lo que ya mostraba

`recordatorios` gana `tipo`, `duracion_min` e `importancia`, y `estado` acepta **`cancelado`** —
«la llamé» y «ya no hace falta llamarla» son dos finales distintos, y contarlos juntos vuelve el
cumplimiento de la agenda un número que no significa nada.

🔴 **El PATCH pasó a ser parcial de verdad: un campo que no viaja no se escribe.** Era `{ estado }` a
secas con un default; ahora cada campo se lee sólo si vino.

🔴 **El tipo ELEGIDO le gana al prefijo adivinado** (`tipoDeActividad`). El respaldo no se saca: las
filas anteriores a la columna no tienen tipo, y su prefijo sigue siendo lo único que se sabe de
ellas. Un tipo que este front no dibuja también cae al respaldo, nunca rompe — el vocabulario crece
del lado del front y los dos se despliegan por separado.

### 7. Los atajos: ⌘K y tres letras

`⌘K` abre la paleta; `r` registra, `e` cambia la etapa, `t` pone una etiqueta, **sólo con una
conversación abierta en Mensajes**. `a` (auto-respuestas) y `n` (libreta) **no se tocan**: están
documentadas en la Cabina y el equipo ya las tiene en el dedo. Agendar y anotar entran por la paleta.

Las señales que abren cada control son **contadores, no booleanos**: con un booleano, cerrar el
drawer y volver a apretar la tecla no cambia el valor y no abriría nada. Es el patrón que
`Intereses.senalAbrir` ya usaba.

---

## Lo que NO se hizo, y por qué

- **No se agregó un `estado_comercial` paralelo de ocho valores.** El embudo ya tiene su vocabulario,
  derivado de lo que hizo el comprador (ADR 0044) y unificado en `lib/etapas.ts` (ADR 0049). Un
  segundo campo editable a mano haría que el Pipeline y el chat digan cosas distintas sobre el mismo
  lead.
- **No se crea el cliente en Cerberus.** Sería la verdad única, pero depende de postear un formulario
  ajeno y hoy no hay endpoint de alta. La ficha local no le cierra la puerta: el día que exista, esta
  tabla es exactamente el borrador que se le manda.
- **No se tocó el reparto.** Quién atiende una conversación se decide en `PasarConversacion`, con
  rastro de quién lo decidió. Un selector de asesor adentro del registro rápido sería una segunda
  puerta a la misma decisión, sin ese rastro.

---

## Los candados

| Qué fija | Dónde |
|---|---|
| Registrar dos veces la misma conversación actualiza, no duplica; el teléfono se guarda normalizado; el duplicado mira las OTRAS conversaciones | `server/src/contactos/fichaLocal.test.db.ts` |
| El prellenado: qué sale del alias, qué gana Cerberus, y que lo ya registrado no se pise | `src/features/panel/fichaLocal.test.ts` |
| Que el prellenado LLEGUE a los campos y se guarde lo que se ve | `src/features/panel/FichaRapida.test.tsx` (jsdom) |
| El tipo elegido le gana al prefijo | `src/features/agenda/tipoDeNota.test.ts` |
| Las fechas rápidas, y que el índice 1 siga siendo «Mañana» | `src/features/agenda/agenda.test.ts` |
| El próximo seguimiento: el más viejo primero, y que lo hecho/cancelado no cuente | `src/features/agenda/proximas.test.ts` |
| La ficha y los seguimientos en el timeline | `src/features/panel/timeline.test.ts` |
