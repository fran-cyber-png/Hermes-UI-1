# ADR 0059 — El tiempo real se filtra por dueña

- **Fecha**: 17-ago-2026
- **Estado**: aceptado
- **Reemplaza**: nada.
- **Origen**: `docs/auditoria-aislamiento-de-chats-2026-08-17.md` §0.4 y §7.3 — el **primer** ítem
  del orden de arreglo. El segundo (`/vincular`) lo cerró **PR #400** en paralelo; acá se anota qué
  quedó abierto de eso, porque el ADR es donde se busca.

## El pedido

Del dueño, el 17-ago-2026: *«los chats de ellas, todos —los de Meta, los de whatsmeow, todos—,
sus chats de ella solo los verá ella y su supervisor, nadie más»*.

La auditoría midió que **no se cumple**: 82 fugas confirmadas. La forma del problema cabe en una
línea — **se construyó una frontera para la LISTA (`GET /api/conversaciones`, el 17-ago) y ninguna
para el CONTENIDO**. Este ADR no cierra las 82: cierra **la primera** del orden de la auditoría.

## Decisión 0 — «y su supervisor» son TODOS los supervisores

Decisión del dueño, y va primero porque **define la firma del predicado que hay que meter en ~40
lugares**: tomarla después obliga a tocarlos dos veces (auditoría §0.2).

```
ve el contenido de C  ⟺  quien pide es la dueña de C, o tiene rol supervisor/admin
```

No se agrega `supervisor_id` a `equipo`. Se usa lo que el modelo de roles ya soporta (migración
0028, §Los roles del CLAUDE.md), preguntando **`mandaEnElEquipo(req)`** y nunca
`rol === 'supervisor'` — con la comparación exacta el admin se queda afuera.

⚠️ **Lo que cuesta, aceptado**: un supervisor de otra área ve todo. El día que «su» supervisor tenga
que ser una persona concreta, la guarda pasa de un booleano de rol a una consulta de relación.

## Decisión 1 — el SSE se filtra por dueña, y va PRIMERO porque alimenta a las otras

`GET /api/stream` era un **broadcast**. `emitirRT` publica en un `EventEmitter` único y
`suscribirRT(cb)` no recibía ningún discriminante: el handler reenviaba el evento crudo, así que
cada vendedora recibía un frame por **cada** mensaje de todo Hermes —
`{"tipo":"mensaje","canal":"whatsapp","telefono":"519XXXXXXXX","direccion":"entrante"}`.

Eso es el teléfono del lead ajeno y el instante exacto, en vivo, **sin quedar en ningún log**. Con
`direccion: 'saliente'` es además vigilancia de la compañera: a quién le contestó y a qué hora.

🔴 **Pero lo que lo pone primero no es el dato suelto: es que era el ENUMERADOR.** El hilo
(`GET /api/whatsapp/conversacion/:telefono`) también fuga, y su única precondición era «conocer un
teléfono ajeno». El SSE se lo regalaba solo. **Cortarlo rompe la cadena de §0.4 sin tocar el hilo.**

### Cómo

**Dos tipos, y esa es la frontera** (`realtime/bus.ts`):

- `EventoRT` — lo que se publica adentro del proceso. Lleva `duena`.
- `EventoPublico` — lo que sale por el cable. **No tiene dónde poner `duena`**, así que el nombre de
  la dueña no se puede filtrar ni por descuido (sería un metadato ajeno: «a Luz le escribieron
  recién»).

La traducción vive **una vez y pura** en `realtime/visibilidad.ts` (`eventoPara`), el molde de
`espacios/visibilidad.ts` y `cola/ventana.ts`. El router solo arma el sujeto —`req.vendedoraId` y
`mandaEnElEquipo(req)`, que **ya estaban en el request**: `perimetroApi` y `cargarRol` se montan
antes— y la aplica.

- 🔴 **`duena` es REQUERIDO en `EventoRT`, aunque casi siempre valga `null`.** Con un campo opcional
  un emisor nuevo compila sin resolverlo y su evento sale sin dueña: no fuga (la regla es
  fail-closed) pero deja una campanita muerta sin un solo síntoma. Requerido, el compilador obliga
  a decidir.
- 🔴 **Falla CERRADO.** Sólo se sirve completo lo que se puede **afirmar** que es tuyo. `null`
  significa una sola cosa para quien lee —«no se pudo atribuir»— y ahí caen los tres casos que no se
  accionan distinto: no hay fila en `conversacion_asignada`, falta la migración, o la consulta
  falló.
- 🔴 **Normaliza los DOS lados.** Cerberus empuja `Luz` y ella entra al login como `luz`; con
  comparación exacta esto no da error, da que **Luz se queda sin su propia campanita para siempre**.
  Es la cicatriz de `cola/asignadaSql.ts §esMiaSql` y `reparto/destino.ts §mismaVendedora`.
- **El evento recortado SE MANDA igual** (`{tipo, canal}`). La frontera está en lo que se **nombra**,
  no en lo que se avisa: callarlo dejaría la cola de quien no es dueña sin refrescar.

### La divergencia deliberada con la frontera de la cola

La cola muestra, además de lo tuyo, **lo huérfano de tus líneas** (`lineaAlcanzableSql`). Acá no.

No es un olvido: son dos preguntas. La cola decide **qué se lista** —y esa concesión existe para que
el archivo de las líneas retiradas no desaparezca—; esto decide **qué se nombra**. Copiar
`lineaAlcanzableSql` a TypeScript sería una segunda implementación de un predicado que hoy vive en
SQL, o sea **#37 en una frontera**, donde divergir falla hacia ABIERTO y sin síntoma.

⚠️ **Lo que cuesta, escrito para que nadie lo descubra debugueando**: una conversación **sin dueña no
le suena la campanita a nadie**. La fila aparece igual en la cola y el hilo abierto se sigue
refrescando; lo único que falta es el sonido.

### El primer mensaje de un lead nuevo, que era el caso que más dolía

El reparto (`asignarSiHaceFalta`) corre **después** de persistir — y ese orden es a propósito («un
lead perdido no vuelve»). O sea que en el primer mensaje de una conversación nueva el evento sale
**sin dueña**, y a quien acaba de recibir el lead no le suena nada: justo la campanita que más vale.

Por eso `webhook/whatsapp.ts` **avisa de nuevo** después de asignar, y **sólo si la conversación no
tenía dueña** — `asignarSiHaceFalta` devuelve la dueña exista o no, así que sin esa comparación una
conversación ya asignada dispararía DOS campanitas por mensaje.

### En el front

`src/lib/datos/tiempoReal.ts` gana una rama: con `telefono` invalida el hilo de esa persona, y **sin
él invalida el PREFIJO** `['wa','conversacion']`. react-query refetchea solo las queries activas y de
hilo hay a lo sumo una montada. Cuesta un refetch por mensaje ajeno; **compra que el chat abierto
nunca se quede viejo** — sin eso, toda conversación sin dueña (lo anterior al reparto, y toda línea
sin rueda) dejaría de actualizarse sola, que es el defecto que este bus vino a arreglar.

## Nota — `/vincular` lo cerró el PR #400, con otro criterio

Era el **segundo** ítem del orden (§0.3), y **es la única fuga con impacto irreversible**: la consola
de operador vivía montada fuera del perímetro y sin un solo middleware, así que
`GET /vincular/estado` servía el **data-URI del QR** de un pareo en vuelo sin `Authorization` —
quien lo escanee antes que la vendedora se queda con la sesión de WhatsApp de esa línea— y
`POST /vincular/iniciar` **actuaba sin credencial**, abriendo un segundo escritor whatsmeow sobre el
mismo SQLite.

Se resolvió en paralelo (PR #400, `1b7618d`) **moviendo el mount adentro de
`if (process.env.NODE_ENV !== "production")`** en vez de borrar el router, con el argumento —correcto—
de que en local la consola sigue siendo la herramienta de trabajo.

Este ADR había propuesto **borrarlo**, y esa mitad se descartó. Queda escrito lo que la diferencia
cuesta, porque es lo único que un lector no puede deducir del diff que quedó:

- ⚠️ **`/vincular` queda con UN solo candado, y sus vecinos tienen DOS.** `_sim` y `_dev` se montan
  igual sólo fuera de producción **y además** su exención del perímetro es solo-dev
  (`auth/perimetro.ts`) — dos cerrojos independientes, que es lo que respalda la frase «en prod no
  hay agujero que recordar». `/vincular` vive **fuera de `/api`**, así que el perímetro nunca lo
  mira: su única defensa es el `NODE_ENV`. Un despliegue con esa variable mal puesta la reabre entera.
- ⚠️ **La regla de NGINX que la tapaba sigue SIN versionar** en este repo (medido el 17-ago: 403 desde
  internet, 200 desde `127.0.0.1:4110`, y VPS1 corre decenas de contenedores que alcanzan ese puerto).
  Ya no es la única protección, pero sigue siendo config invisible para quien lea el código.
- **La lección del método, que vale más que el arreglo**: los auditores la reportaron como alcanzable
  desde internet. **Lo es en el código y no lo era en producción.** Leer el código da la SUPERFICIE;
  sólo el sistema vivo da el ALCANCE — hacen falta los dos.

## Los candados

Dos, porque el defecto no estaba en una regla mal escrita sino en que **el handler nunca miraba el
request**. Un defecto así no lo ve ningún test de la función pura (la lección de ADR 0024).

- `server/src/realtime/visibilidad.test.ts` — la regla. 12 casos.
- `server/src/routes/stream.test.ts` — **el cableado**: levanta el montaje real de `index.ts`
  (perímetro → `cargarRol` → router), conecta DOS vendedoras a la vez, emite UN evento y mira **los
  bytes que salieron por cada cable**.

Los dos **se verificaron en rojo**: sacando `esSuya` de `eventoPara` caen 4 de 12; devolviendo el
evento crudo en el router caen 2 de 6.

## Lo que este ADR NO cierra

Sigue abierto todo el resto de la auditoría, empezando por lo que ella pone tercero: el hilo
(`GET /api/whatsapp/conversacion/:telefono`), la ficha y `GET /api/persona/:interactionId` — que es
**enumerable**, porque el id es un `serial`. Y después el seam único de §7.2:
`puedeVerConversacion(rol, vendedoraId, clave)` con un middleware fail-closed que **rompa el arranque**
si una ruta nueva no lo declara.

**Lo que NO hay que hacer** (auditoría §7.1): parchear las ~40 rutas una por una. Así se llegó acá.
