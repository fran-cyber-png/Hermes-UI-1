# ADR 0037 — El timeline del contacto se puede ESCRIBIR, y dice quién

**Fecha**: 5-ago-2026
**Estado**: aceptado
**Enmienda a**: ADR 0017 (el panel derecho ordenado por lo que decide una venta)

## El problema

El timeline del panel derecho (`src/features/panel/timeline.ts`) tenía **seis tipos de evento
y los seis eran DERIVADOS**: la compra que afirma Cerberus, la llegada que afirma Meta, el
nombre identificado, el interés registrado, el enfriamiento y la cotización que calcula
`senales/`.

O sea: el timeline contaba lo que las máquinas sabían de esa persona, y **nada de lo que
pasó en la conversación**. «Preguntó por el diploma de gestión pública», «dijo que lo ve con
su jefe el lunes», «le parece caro, lo compara con uno de 180» — eso lo escuchaba la
vendedora y se perdía en el aire.

Dos agravantes medidos en el código:

1. **No había dónde escribirlo.** La pestaña «Notas» de `panel/pestanas.ts` es código muerto
   desde `79b239b` (ADR 0017): `PanelNotas.tsx` quedó huérfano y **no hay ninguna forma en la
   app de anotar sobre una conversación**. Todo lo que se escribe cae en `clave='general'`
   (la Libreta). Por eso `notas` tenía cero filas en producción.
2. **El timeline no decía de dónde salía nada.** `EventoLinea` calculaba `fuente` y
   `confianza` y **no los dibujaba en ningún lado** (verificado por grep: `e.fuente` no
   aparecía en ningún JSX). Lo que afirmó Cerberus se leía igual que lo que dedujo una señal
   automática.

## La decisión

**Una tabla nueva, `eventos_contacto`, que el timeline lee y una persona escribe.** Server en
`server/src/eventos/`, front en `src/features/eventos/`, ruta `/api/eventos`.

Un evento es **un tipo del vocabulario + un dato estructurado opcional + un comentario**, y no
un texto libre. La diferencia no es estética: un `notas LIKE '%cuotas%'` no se puede sumar, ni
agrupar por curso, ni cruzar con la pauta — el mismo argumento que `db/schema.ts` ya tiene
escrito sobre las columnas de `conversiones_wa`. El comentario es el matiz; **el tipo es lo que
se cuenta**.

Seis tipos: `pregunto_curso` · `pidio_precio` · `objecion` · `quedamos_en` · `llamada` · `otro`.

## Por qué una tabla nueva y no las dos que ya existían

- **`gestiones`** tiene `etapa` NOT NULL. Registrar «preguntó por X» obligaría a declarar una
  etapa del embudo y a pasar por las compuertas de `registrarGestion.ts`. **Anotar un hecho no
  es mover el embudo.**
- **`notas`** es privada por autora (`listarNotas` filtra por `vendedora_id`) y es prosa
  libre. Acá el punto es el contrario: se ve en equipo, y existe el `tipo` justamente para
  poder contar.

## Las cinco reglas que este ADR fija

### 1. «Preguntó por un curso» ASIENTA el interés

`intereses` es la única fuente de verdad de «qué curso quiere esta persona»: la consultan la
compuerta de Cotizado, el chip de la cola, la ficha y el Pipeline. Si el evento guardara su
propio curso y nada más, habría **dos lugares diciendo qué quiere el lead** — la divergencia de
#37, que este repo paga con un test de paridad cada vez que aparece.

Y en la práctica sería absurdo: la vendedora registra «preguntó por Gestión Pública» y al
minuto Cotizado le rebota con «no se sabe qué curso le interesa».

Así que el evento **narra** (cuándo, quién, cómo lo dijo) y `intereses` **sigue siendo el
estado**. Se asienta por el mismo seam que el botón «+ interés», con su misma resolución contra
el catálogo vivo de Cerberus. El popover lo dice: «También queda como interés (destraba
Cotizado)».

Corolario: el interés va **primero** y el evento guarda **el nombre que el catálogo resolvió**,
no el que mandó el navegador. Si no, el timeline diría un nombre y el chip de la cola otro.
Correrlo primero es seguro porque `registrarInteres` no tira con Cerberus caído: degrada a
texto libre y devuelve el motivo.

### 2. Se ve en EQUIPO, se edita por AUTORA

La conversación es compartida (Hermes no tiene modelo de permisos, ADR 0036), así que todas
leen todo. Pero un evento es **una afirmación de quien lo escribió**, y por eso corregirlo o
borrarlo es solo de ella. El error nombra a la dueña, para poder ir a pedírselo.

🔴 **Se compara normalizando los DOS lados** (`mismaVendedora` en el server, `esMio` en el
front). El mismo humano tiene dos grafías vivas en producción —Cerberus empuja `Luz`, ella
entra como `luz`—. Con comparación exacta esto **no da un error**: da que Luz no ve los botones
de sus propios eventos, y eso se lee como «no se puede editar».

### 3. Borrar es archivar, y el `tipo` no se edita

`archivado_at`, como `notas` y como «deshacer revoca, no borra» de `identidad/`. Lo que alguien
afirmó y después retiró es un dato.

El `tipo` es inmutable: cambiarlo convertiría una objeción en una llamada sobre la misma fila y
el mismo timestamp — reescribir la historia, no corregir un dedazo. Para eso se archiva y se
registra de nuevo. Por lo mismo, el PATCH **no puede agregarle un curso a un evento que no
tenía**.

Archivar **no des-asienta el interés**: la persona puede haberlo dicho por otro lado, y
quitarlo en silencio cerraría Cotizado sin que nadie entienda por qué.

### 4. Un tipo desconocido se LEE, nunca tira

`tipo` es `text` y no un enum de Postgres, y el server **acepta términos que no están en su
lista** (solo valida la forma: `^[a-z][a-z_]{0,31}$`).

El motivo es de deploy: el front sale sin reiniciar el server (N4 va solo, N5 es un botón), así
que hay una ventana real en la que la app ofrece un tipo que el server no tiene. Rechazarlo ahí
convierte un deploy escalonado en «no se pudo registrar» para la vendedora. Del otro lado,
`rotuloDeTipo` muestra el término tal cual, nunca como otro tipo y nunca con un throw — la
misma decisión que `canales/bot.ts` con los motivos del bot.

A un tipo desconocido **no se le inventa una regla**: ni se le exige nota ni se lo perdona, y
no asienta interés aunque traiga curso.

### 5. Se dice QUIÉN, y el tag redundante se va

El autor va en la fila, en nombre corto (`nombreCortoVendedora`: `ventas10@grupogoberna.com` →
«Ventas10», la misma regla de `canales/dueno.ts`).

Y el tag «MANUAL» **se dibuja solo cuando NO hay autor**: con «por Luz» a la vista, «MANUAL ·
por Luz» es la misma cosa dos veces en una fila de 360 px. El tag se queda para las señales de
IA, que es donde hace falta.

## Dónde se registra

**Dos lugares, un componente** (`RegistrarEvento`, con `variante`):

- **chip «Registrar»** al lado de «Agendar» en la `BarraGestion`, arriba del chat — donde la
  vendedora está parada cuando la persona le dice algo;
- **botón al pie del timeline** en el panel derecho — donde está leyendo la historia.

Agendar es una **promesa a futuro** (cae en la Agenda); registrar es un **hecho del pasado**
(cae en el timeline). Van pegados porque son los dos gestos de «que esto no se pierda», y
separados porque uno mira adelante y el otro atrás. **Ninguno de los dos envía nada**, y el pie
del popover lo dice.

## Lo que deliberadamente no se hizo

- **No hay tipos editables desde la app.** El vocabulario se agrega en código, con su test de
  paridad. Seis tipos que se leen de un vistazo valen más que treinta que nadie usa.
- **No se tocó la pestaña «Notas» muerta.** Decidir si `PanelNotas` se reconecta o se archiva
  es la hipótesis C de `docs/plan-libreta-que-deberia-tener.md`, y va antes de tocar
  `buscarNotas` (que sigue clavado a `'general'`). Este ADR no la resuelve — pero sí saca de
  «no hay dónde anotar» el caso que más dolía.
- **No se conectó el botón «Corregir» de los eventos de IA**, que tampoco tenía handler:
  corregir lo que dedujo una señal que se re-deriva en cada consulta (ADR 0016) es otro frente.
  Se retiró el botón, porque mientras no exista, mentía.

## Los candados

- `server/src/eventos/catalogo.test.ts` — el vocabulario y sus reglas, puros.
- `server/src/eventos/paridad.test.ts` — **cruza el catálogo del server con la copia a mano del
  front** y falla si divergen en tipo, orden, rótulo, `pideCurso`, `exigeNota` o tope. Mismo
  mecanismo que ya protege `src/features/hechos/hechos.ts`.
- `server/src/eventos/registrarEvento.test.db.ts` — contra Postgres: que el interés se asiente,
  que los dos lados guarden el mismo nombre, que `Luz`/`luz` sean la misma persona, que borrar
  archive.
- `src/features/eventos/RegistrarEvento.test.tsx` — **el cableado del teclado** (jsdom). Existe
  porque el defecto real apareció capturando la evidencia: con el foco en el buscador de curso,
  el Escape hacía `stopPropagation()` y **no cerraba nada** — la tecla quedaba comida. Ningún
  test puro lo podía ver; es la lección de ADR 0024, otra vez.

## Evidencia (regla dura #2)

App real, con un stub de ~60 líneas en `:4199` y `VITE_API_URL` apuntándole — sin base, sin
Cerberus, sin secretos.

- `docs/evidencia/eventos-timeline-1440.png` — el timeline con tres eventos, agrupados por día,
  con autor; los de Luz con Editar/Borrar y el de Ventas10 sin ellos.
- `docs/evidencia/eventos-popover-1440.png` — el popover con el buscador de curso abierto y el
  botón diciendo por qué está gris.
- `docs/evidencia/eventos-chip-barra-1280.png` — el chip en la barra del chat, a 1280×720.

## Migración

`0018_fair_jamie_braddock.sql`, expand-only (CREATE TABLE + índice). El `when` del journal
salió **menor** que el de `0017` y hubo que correrlo con `goberna-journal-set-when`: sin eso,
drizzle la salteaba **en silencio** y el deploy salía verde con la tabla sin crear.
