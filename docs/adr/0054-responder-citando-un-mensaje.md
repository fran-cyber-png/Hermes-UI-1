# ADR 0054 — Responder citando un mensaje

**Fecha**: 12-ago-2026
**Estado**: aceptado — toca `server/`, así que las dos mitades salen por **N5**
**Reemplaza**: nada. Es superficie nueva.
**Enmienda**: **ADR 0019** (las reacciones) como MOLDE, no como contrato: la cita se parece a una
reacción en todo menos en dónde vive. Corrige de paso el tope del hilo (200 mensajes) que ADR 0011
introdujo al revés.

---

## El pedido

Del dueño, textual: «quiero que se pueda responder al mensaje como wspp». Elegís un mensaje del
hilo, tocás Responder, y tu mensaje sale citándolo — con la tirita gris arriba, como en el teléfono.

## Lo que había

**Nada, en ninguna de las tres capas.** No es que estuviera a medias:

- **No había gesto**: la única acción por mensaje era reaccionar (ADR 0019).
- **No había dato**: `MensajeHilo` son doce campos y ninguno de cita; el SELECT de `hilo.ts` no lo
  proyectaba; y **la ingesta tiraba el `contextInfo` entrante en los dos caminos** —
  `whatsapp/proyectar.ts` guardaba una lista curada de campos y `webhook/whatsapp.ts` no leía
  `m.context`.
- **No había campo de envío**: `POST /api/whatsapp/enviar` leía `{numeroPropio, telefono, texto,
  referencia}` + `pieza`.

**Consecuencia que manda el diseño: no hay historia que reproyectar.** Todo lo que llegó hasta hoy
se perdió en el borde. Este frente captura de acá en adelante y no puede hacer nada por lo anterior
— lo que obliga a que el caso «el mensaje citado no existe en Hermes» sea el caso NORMAL de las
primeras semanas, no una rareza.

---

## Las decisiones

### 1 · El molde son las reacciones, y en un punto NO

Una cita es el mismo animal que un 👍: una señal que **cuelga de un mensaje**, que llega por dos
canales con dialectos distintos y que se direcciona con el mismo `wa:<id>`. Por eso `whatsapp/cita.ts`
copia la forma de `reacciones/dominio.ts` — un traductor por canal, una forma canónica, un test de
paridad que los cruza — e **importa la receta del id de allá** en vez de escribirla otra vez. Con dos
recetas el JOIN da cero filas en silencio, que se lee como «nadie citó nunca a nadie».

Donde se separa: una reacción es una entidad (tabla propia, PK `(mensaje, persona)`, estado que se
reemplaza). Una cita es un **atributo del mensaje que la trae**: no cambia nunca, no existe sin él y
muere con él. Va como una clave más del crudo (`events.payload.cita`, al lado de `media` y `origen`)
y **este frente no lleva migración**.

### 2 · 🔴 La grafía del campo: `stanzaID`, con D mayúscula

Los tipos publicados de `@whatsmeow-node/whatsmeow-node` **mienten**. `dist/index.d.ts` declara
`ContextInfo.stanzaId` y el ejemplo `examples/reply-and-mentions.ts` usa la misma grafía. El binario
Go que serializa el proto dice otra cosa — medido el 12-ago-2026 sobre
`@whatsmeow-node/darwin-arm64/bin/whatsmeow-node`:

```
strings <binario> | grep -c '^stanzaID$'   → 13
strings <binario> | grep -c '^stanzaId$'   → 0
json:"stanzaID,omitempty"                  → 3 structs
```

Seguir el `.d.ts` manda un campo que `encoding/json` **descarta sin un solo error**: el mensaje sale y
la cita no. Como el wrapper usa `encoding/json` y `encoding/json` ignora las claves desconocidas,
emitir las dos grafías es gratis. **Al leer se aceptan las dos; al escribir van las dos.** El
precedente de la casa es `whatsapp/origen.ts:39` (`sourceId ?? sourceID`).

El candado es `whatsapp/cita.paridad.test.ts`: se pone rojo si alguien «corrige» la grafía siguiendo
los tipos.

Consecuencia de segundo orden: **con cita hay que usar `sendRawMessage` y no `sendMessage`**, porque
el `MessageContent` tipado solo admite `stanzaId`. Sin cita no se toca nada — el proto normal sigue
siendo `{ conversation }` por `sendMessage`, y cambiar el camino que hoy usa el 100 % de los envíos
por una función que todavía no usó nadie es riesgo puro por cero ganancia.

### 3 · 🔴 El navegador manda SOLO el id; de quién era y qué decía lo resuelve el server

`POST /api/whatsapp/enviar` recibe `citaDe` (el `external_id`) y nada más, aunque el front tenga el
autor y el texto dibujados en pantalla. Es un dato que **el lead va a ver**: el `participant` mal
puesto le atribuye la tirita a la persona equivocada, y un `quotedMessage` inventado le muestra un
texto que nadie escribió. Se resuelve en `whatsapp/citaRepositorio.ts`, contra lo que Hermes ya
guardó.

Degrada, nunca tumba: un id que Hermes no conoce **se cita igual** (el que tiene que resolver el link
es WhatsApp, que sí lo tiene) y lo que se pierde es el preview, no la cita.

### 4 · 🔴 El citado que no está se dibuja como hueco honesto

Si el mensaje citado no aparece en `interactions`, la respuesta **igual muestra su tirita**, con «Un
mensaje anterior» y **sin autor** — no se afirma de quién era sin haberlo mirado. Descartar la cita
dejaría una respuesta suelta que no contesta nada, y es el caso que va a ser mayoritario mientras el
corpus se llena. La lectura vive pura en `src/features/whatsapp/cita.ts`.

### 5 · La resolución va en una SEGUNDA consulta, no en un tercer JOIN

`hiloDe` ya carga dos LEFT JOIN para la marca de automático. El citado se resuelve donde ya se
resuelven las reacciones y los ✓✓ (en la ruta), y por el mismo motivo: sería un **self-join sobre la
tabla que esa consulta está leyendo**, para un dato que casi ninguna fila tiene.

### 6 · La cita viaja EN la orden

`OrdenEnvio.cita`, como `procedencia` y `automatico`: misma puerta, mismos frenos, misma auditoría,
misma llamada al transporte. Un `update` posterior no serviría — la cita no es un dato que se anota,
es parte del mensaje que sale. Y la proyección del saliente la lleva, o la vendedora ve un mensaje
suelto donde el lead ve una respuesta.

### 7 · El gesto: dos sentidos, sin mirar la sesión, fuera de revisión

«Responder» va en los DOS sentidos, como «Copiar» y al revés que «Reaccionar»: citar lo propio es lo
que se hace al retomar un precio que ya se pasó. Y **no depende de la sesión**, porque no manda nada
— el freno de «no se puede enviar» ya vive en el botón de mandar, y ponerlo también acá dejaría a la
vendedora sin poder ni preparar la respuesta mientras la línea reconecta.

No aparece en **modo revisión** (ADR 0018): ahí se aprueba un texto preparado, no se compone uno.

Un mensaje **sin texto y sin adjunto** no se puede citar: el caso real es la burbuja de «Vino del
anuncio», que no es algo que alguien escribió sino una marca que Hermes dibuja, y su tirita saldría
en blanco.

### 8 · Escape suelta la cita

La tecla está libre en el composer: `App.tsx` filtra sus atajos globales con `tecleandoEn`, así que
hoy Escape con el foco ahí no hace nada. El handler **solo cancela cuando hay cita puesta**; sin
cita no se toca, para no quedarnos con un Escape que alguien más pueda necesitar mañana.

### 9 · De paso: el hilo servía los 200 mensajes MÁS VIEJOS

`ORDER BY occurred_at ASC LIMIT 200` no es «los últimos 200»: es los primeros. Medido en producción,
1 de 4.009 conversaciones pasa de 200 (la más larga, 268), así que era deuda barata — **deja de serlo
acá**, porque una cita apunta a lo reciente, que es justo lo que el tope dejaba afuera. El comentario
de `db/reacciones.ts` ya decía «los últimos 200» y era verdad de la intención y mentira del código.

---

## Lo que NO entra

- **Citar al mandar un adjunto** (media + cita). El composer lo **dice antes de mandar** («Con un
  adjunto la cita no viaja: sale como un mensaje suelto») en vez de dejarla puesta en silencio, que
  sería enterarse cuando ya lo vio el lead. **Recibir y dibujar** una cita que apunta a un adjunto sí
  anda.
- **Tocar la tirita para saltar al mensaje original.** En WhatsApp lo hace; acá sería un scroll a algo
  que puede no estar en la ventana de 200, o sea un clic que a veces no hace nada — peor que uno que
  nunca hace nada.
- **Reproyectar lo viejo.** No hay dato: la ingesta lo tiraba.
- **Ninguna migración.**

## Evidencia

`docs/evidencia/responder-citando-en-el-hilo.png` (los tres casos: el bonito, el hueco honesto y la
cita a un adjunto sin texto) y `responder-citando-composer.png` (la tirita puesta en la caja). Sin
server: `npx vite --port 5199` → `/galeria-composer.html`.

⚠️ La galería sirve los tres casos **incluidos los feos** a propósito: en este repo una galería con
el caso ideal ya escondió tres defectos (radar de leads, 8-ago-2026).
