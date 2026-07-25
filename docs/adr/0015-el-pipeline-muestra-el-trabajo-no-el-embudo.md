# ADR 0015 — El Pipeline muestra el TRABAJO, no la forma del embudo

- **Fecha:** 2026-07-25
- **Estado:** aceptado
- **Decide:** el rediseño de `VistaEmbudo` (rama `redesign/pipeline`)
- **Se apoya en:** ADR 0009 (una definición, jamás espejos) · ADR 0013 (etapa efectiva)

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
y **es aditivo**: `precio_enviado`, `ya_le_hablamos`, `cursos[]`, y —opt-in con `?lead=1`—
`lead_nombre` / `lead_curso`. El cruce contra `leads` va **después del `LIMIT`**
(`cola/enriquecerConLead.ts`): el match es por sufijo de teléfono y no tiene índice, así
que Mensajes no paga lo que no usa. El `desglose` (etapa × ya-le-hablamos × precio × viva)
sale de la misma pasada que los conteos de #89, y esos conteos ahora se **pliegan** de él:
si algún día no cerraran sería un bug, no una diferencia de definición.

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

## Consecuencias

- La vendedora ve primero lo que debe (la deuda) y después lo que sigue (el silencio). El
  orden de lectura de la pantalla es el orden de su día.
- «Ya le pasaste precio» es una **heurística sobre texto**: puede errar. Por eso no asienta
  ninguna etapa por su cuenta — solo marca la tarjeta y ofrece la acción. Si el regex hay
  que ajustarlo, se ajusta en un solo lugar y el test de paridad SQL≡TS es el candado.
- El curso del formulario **solo sale de los leads web** (en ICARUS `campaign_name` ES el
  producto de la landing). En los leads de Meta el mismo campo es el nombre de una campaña
  publicitaria: se sigue mostrando como contexto en la ficha, pero no se hace pasar por el
  curso que la persona eligió.
- El front puede salir a producción **antes** que el server (N4 sin reinicio, N5 con
  botón). Mientras tanto el tablero cuenta con los conteos de #89 y **calla** el detalle
  que todavía no puede saber, en vez de pintar ceros.
- Nada de esto toca la compuerta de cierre: el cierre se sigue ganando registrando la
  venta (`gestiones/registrarGestion.ts`).
