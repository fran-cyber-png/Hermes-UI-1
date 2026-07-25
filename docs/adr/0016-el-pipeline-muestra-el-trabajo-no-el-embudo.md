# ADR 0016 — El Pipeline muestra el TRABAJO, no la forma del embudo

- **Fecha:** 2026-07-25
- **Estado:** aceptado
- **Decide:** el rediseño de `VistaEmbudo` (rama `redesign/pipeline`, PR #137)
- **Se apoya en:** ADR 0009 (una definición, jamás espejos) · ADR 0013 (etapa efectiva) ·
  ADR 0015 «barra de filtros y curso en la fila» / PR #135, del que este ADR **consume** el
  curso en vez de calcularlo (ver §«De dónde sale el curso»).

## Contexto

El tablero de #90 (PR #122) arregló la aritmética: conteos reales por etapa efectiva,
carga por columna, Interesados como bandeja. Pero medido contra producción el
**2026-07-25**, con 1.865 conversaciones, la pantalla seguía sin servir para vender:

| Medición (prod, 25-jul) | Número |
|---|---|
| Contactados | **1.389** — de 300 muestreadas, **300 respondidas** |
| Interesados (bandeja) | **476** — de 300 muestreadas, **0 respondidas** |
| Cotizados · Cierre · Perdidos | **0 · 0 · 1** |
| Conversaciones con un precio ya enviado | **611** |
| Intereses registrados en toda la base | **1** |

Leídas juntas, esas filas dicen tres cosas:

1. **La única columna con tarjetas era, entera, gente cuya pelota no es nuestra.**
   La etapa efectiva parte la cola exactamente por el turno: `contactado` exige
   `respondida`, y `respondida` significa que el último mensaje es nuestro. O sea que
   Contactados = Silencio y la bandeja = Deuda (`CONTEXT.md`). El tablero le daba el
   ancho al silencio y una línea gris a la deuda.
2. **El rótulo de la bandeja era falso.** Decía «Levantaron la mano y nadie les
   respondió aún» sobre 476 conversaciones, de las cuales ~218 son gente a la que sí le
   hablamos y que volvió a escribir. Son dos trabajos distintos: uno se abre, el otro se
   sigue.
3. **Cotizados es ficción por diseño, no por la compuerta.** La compuerta pide un
   interés registrado y está bien que lo pida; el problema es que registrarlo exigía
   tipear el nombre del curso en un buscador, y en 1.865 conversaciones se tipeó una
   vez. Mientras tanto el curso ya estaba escrito en el formulario que la persona llenó,
   y el precio ya había salido 611 veces por WhatsApp.

Y la tarjeta —nombre, hora, y un pedazo del último mensaje— no ayudaba: el «pedazo del
último mensaje» de una conversación en silencio es **nuestra propia plantilla**, idéntica
en decenas de tarjetas, y el nombre suele ser el pushname de WhatsApp («🦋W», «.»,
«10 ❤️L»).

## Decisión

**El Pipeline se organiza por el trabajo que hay que hacer, no por la forma del embudo.**
De ahí salen cinco decisiones concretas:

1. **La bandeja encabeza el tablero y se llama por lo que es: «Te esperan».** Muestra
   cuántas están escribiendo AHORA (nivel 0), cuántas nunca abrimos y cuántas volvieron a
   escribir. Sigue **sin ser columna** (decisión del dueño en #87): ahí no se arrastra,
   se responde — y el botón lleva a Mensajes.
2. **La tarjeta dice lo que decide una venta, y nada más**: quién es (el nombre del
   formulario le gana al pushname), de quién es el turno y hace cuánto, de qué curso, y si
   ya le pasamos el precio. **El preview del último mensaje solo aparece cuando es de
   ella.** La tarjeta crece con lo que tiene que decir: un renglón cuando no hay nada.
3. **«Ya le pasamos el precio» es una señal derivada**, no un estado que alguien marque
   (`cola/precio.ts`): un mensaje nuestro con un monto, un link de pasarela o la
   instrucción de pago. Es una heurística y se llama como tal — dice «ya le pasaste
   precio», no «esto está cotizado».
4. **La compuerta de Cotizado no se relaja: se satisface sin tipear.** Cuando el curso
   ya se sabe (interés registrado, o el que la persona eligió en el formulario web), un
   clic asienta el interés y mueve la tarjeta. Cuando no se sabe, no se inventa: el modal
   pregunta, y ofrece el curso del formulario como un botón. Soltar en Cotizados sin
   interés ya no viaja al server para rebotar: pregunta primero.
5. **El ancho de cada columna es una declaración de dónde está el trabajo**, y las
   columnas vacías explican cómo se llenan en vez de ser un hueco blanco.

Del lado del server, todo lo nuevo entra por el seam que ya existía (`cola/consultarCola.ts`)
y **es aditivo**: `precio_enviado`, `ya_le_hablamos` y el recorte `?precio=1`. El `desglose`
(etapa × ya-le-hablamos × precio × viva) sale de la misma pasada que los conteos de #89, y
esos conteos ahora se **pliegan** de él: si algún día no cerraran sería un bug, no una
diferencia de definición.

## De dónde sale el curso: una sola fuente, la de #135

Dos frentes llegaron al mismo dato la misma semana. #135 (ADR 0015) lo resolvió **en SQL**,
dentro de la misma pasada del listado (`cola/cursoSql.ts` → `interes_curso`, `lead_curso`);
este rediseño lo había resuelto **después del `LIMIT`**, con un cruce propio contra `leads`
(`cola/enriquecerConLead.ts` → `lead_nombre`, `lead_curso`) más un `cursos[]` con todos los
intereses de la conversación. Son la misma idea escrita dos veces, y dos escrituras de la
misma regla es exactamente la divergencia que ya costó cara (#37, ADR 0009): la misma
persona saldría con un curso en Mensajes y con otro en su tarjeta del Pipeline.

**Gana la de #135 y la otra se borra.** Sirve a las dos pantallas, entra en la misma pasada
y ya tiene sus tests con base. Concretamente:

- Se borran `cola/enriquecerConLead.ts`, `gente/emparejar.ts#cursoDelLead`, la opción
  `conLead`, el query-param `?lead=1` y el `cursos[]` (`cola/estadoSql.ts#cursosCteSql`).
  El `interes_curso` de #135 —el interés **más reciente**— ya es el candidato que la
  compuerta necesita; la lista entera de intereses es la línea de tiempo de la ficha (#57),
  no un dato de tarjeta.
- El fragmento de #135 se **extiende con el nombre real**: `l.full_name` es una columna más
  del `DISTINCT ON` que ya hace el join a `leads`, así que no cuesta ninguna pasada nueva.
  Ese nombre es lo que convierte «🦋W», «.» o «10 ❤️L» en la persona que llenó el
  formulario, y sale del **mismo lead** que el curso: nombre y curso no pueden venir de dos
  personas distintas.
- Del lado del front el único punto de contacto es `vistas/tarjeta.ts#cursoDeTarjeta`, que
  **delega** en `canales/curso.ts#cursoDeFila` (la precedencia interés › formulario ›
  anuncio, el acortado con `familiaDeProducto` de #129 y el color determinista por familia)
  y solo le agrega `registrado = fuente === 'interes'`, que es lo único que la tarjeta
  necesita y la fila no.

**El chip acorta; el POST no.** `familiaDeProducto` poda «Diploma de Especialización en
Inteligencia y Contrainteligencia 14» hasta «Inteligencia y Contrainteligencia» para que
entre en 230 px. Ese texto **no existe en el catálogo de la Escuela**: registrar el interés
con él asienta una fila que nadie puede casar con un producto de Cerberus. Por eso
`cotizarEnUnClic` devuelve las dos formas con nombres distintos —`crudo` (lo que se guarda,
tal cual vino del server) y `etiqueta` (lo que se lee)— y hay un test que falla si vuelven a
ser la misma. Por la misma razón el **anuncio** pinta el chip pero **no** habilita el clic:
el título de un anuncio es de dónde vino la persona, no un curso del catálogo.

## Qué reemplaza

- **La tarjeta de `VistaEmbudo` de PR #122** (nombre + hora + preview + editor de intereses
  embebido). El editor `Intereses` sale de la tarjeta: montaba un `GET
  /api/gestiones/intereses` **por tarjeta** (30 tarjetas, 30 requests) y mezclaba altitudes
  — la lista muestra, la ficha edita. Los cursos ahora viajan en la fila.
- **El contador «Interesados»** con su rótulo «Levantaron la mano y nadie les respondió
  aún», que era falso para casi la mitad de esa bandeja.
- **El camino único a Cotizado** (arrastrar → rebote del server → modal → buscador →
  reintento). Sigue existiendo para el caso en que de verdad no sabemos el curso; deja de
  ser el único.
- **El cruce contra `leads` propio de este PR** (`cola/enriquecerConLead.ts`, opt-in con
  `?lead=1`, apoyado en `gente/emparejar.ts#cursoDelLead`) y el **`cursos[]` de la fila**
  (`cola/estadoSql.ts#cursosCteSql`). Los reemplaza el fragmento SQL de #135, extendido con
  `l.full_name`. Ver §«De dónde sale el curso».

## Consecuencias

- La vendedora ve primero lo que debe (la deuda) y después lo que sigue (el silencio). El
  orden de lectura de la pantalla es el orden de su día.
- «Ya le pasaste precio» es una **heurística sobre texto**: puede errar. Por eso no asienta
  ninguna etapa por su cuenta — solo marca la tarjeta y ofrece la acción. Si el regex hay
  que ajustarlo, se ajusta en un solo lugar y el test de paridad SQL≡TS es el candado.
- El curso del formulario sale de `cursoDeLeadSql` (`gente/leadDeTelefono.ts`), que es el
  ÚNICO lugar donde se decide qué curso dice un lead — lo comparten el panel de negocio
  (#128), el chip de la fila (#72) y esta tarjeta. Se hereda también su borde conocido: un
  lead sin `campaign_name` ni `form_name` no dice ningún curso, y como el nombre viaja en la
  misma fila del `DISTINCT ON`, ese puñado de leads tampoco aporta su nombre. No se abre una
  segunda pasada por ellos.
- El front puede salir a producción **antes** que el server (N4 sin reinicio, N5 con
  botón). Mientras tanto el tablero cuenta con los conteos de #89 y **calla** el detalle
  que todavía no puede saber, en vez de pintar ceros.
- Nada de esto toca la compuerta de cierre: el cierre se sigue ganando registrando la
  venta (`gestiones/registrarGestion.ts`).
