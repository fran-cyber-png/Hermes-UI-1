/**
 * ¿ESTA PERSONA TRAJO SU PROPIA LÍNEA? — la regla, pura y en un solo lugar.
 *
 * ══ QUÉ PREGUNTA RESPONDE ════════════════════════════════════════════════
 *
 * Pedido del dueño (18-ago-2026): «los que se enlazan con qr también deberían
 * poder el ventas meta, solo los 2 — pero de ventas meta solo los que le
 * asignaron a ellos».
 *
 * Traducido: quien vinculó una línea escaneando el QR desde Hermes ve **su línea
 * entera** más **lo que le asignaron a él en cualquier otra línea**, y nada más.
 * Este módulo responde SOLO la primera mitad —«¿tiene línea propia?»— y no sabe
 * nada de conversaciones, de asignaciones ni de la cola. Quien arma el `WHERE`
 * es `cola/asignadaSql.ts`; lo único que necesita de acá es el booleano y, si
 * hace falta nombrarlas, la lista de números.
 *
 * ══ SE ATA AL HECHO, NO A UNA LISTA DE NOMBRES ═══════════════════════════
 *
 * Hoy alcanza a dos personas (Walter y Usuario1) y mañana a quien vincule, sin
 * tocar código ni reiniciar nada. Es el mismo criterio con el que el repo ya
 * resuelve el aislamiento de campaña (`cola/lineas.ts` §soloSusLineas): se
 * pregunta por el PROPÓSITO del número, no por un CSV de usuarios que hay que
 * acordarse de actualizar. Una segunda lista es una lista que se desincroniza —
 * y cuando se desincroniza, la persona ve de más o de menos sin un solo síntoma.
 *
 * ══ 🔴 LAS DOS CONDICIONES, Y NINGUNA ALCANZA SOLA ═══════════════════════
 *
 * Medido en producción el 18-ago-2026 sobre `numeros_wa` × `numero_vendedora`:
 *
 *   numero        etiqueta        proposito    personas
 *   51984429504   Ventas Meta     vendedora    **7**   (Luz, Sindy, ventas10@…14@)
 *   51941654039   Walter Ventas   vendedora    1
 *   51955135507   Usuario1        vendedora    1
 *   51963139984   Betto           campana      2
 *   51986394450   Ventas Perú     escuela      0
 *   51944531711   Venta Peru      vendedora    **0**
 *
 * 🔴 **`proposito === 'vendedora'` SOLO NO ALCANZA: Ventas Meta también lo
 * dice.** Atar la regla a ese campo se la aplicaría a Luz, a Sindy y a las cinco
 * `ventas1X` — o sea a TODO el equipo de la Escuela, que es exactamente lo
 * contrario de lo pedido. La señal que discrimina es cuántas personas comparten
 * el número: una línea propia tiene UNA, Ventas Meta tiene SIETE.
 *
 * 🔴 **Y el conteo solo tampoco alcanza.** El día que Ventas Meta quede con una
 * sola persona —una baja, o un `PUT /api/admin/numeros/:numero` de Cerberus con
 * `vendedoras` incompleto, que **vacía el mapa de ese número sin log** (ver
 * CLAUDE.md §Administración de números)— el conteo pelado la marcaría como línea
 * propia y le daría a esa persona la línea entera de la Escuela. El propósito es
 * lo que sostiene la intención declarada de quien dio de alta el número.
 *
 * Por eso se piden **las dos**, y por eso están escritas acá y no en un `if`
 * repartido: son la definición de «línea propia», y una definición que vive en
 * dos lados diverge (#37).
 *
 * ⚠️ **`duenas: 0` NO es línea propia** (`51944531711`, «Venta Peru»): un
 * número dado de alta que nadie declara suyo no lo trajo nadie escaneando un QR.
 * Sin esta guarda, un número huérfano con `proposito='vendedora'` le regalaría la
 * regla a cualquiera que lo tuviera colgando del mapa.
 *
 * ══ ⚠️ `duenas` NO SALE DE `lineasDeVendedoraConProposito` ═════════════
 *
 * Esa consulta (`numeros/repositorio.ts`) devuelve las líneas de UNA persona con
 * su propósito: no sabe **cuántas personas hay por línea**, porque su `WHERE` ya
 * filtró por el `vendedora_id` que se le pasó. Quien llame a este módulo tiene
 * que traer el conteo — hace falta agrupar `numero_vendedora` por `numero`. Si
 * se llamara con el resultado crudo de esa consulta, `duenas` vendría siempre
 * en 1 y **Ventas Meta pasaría por línea propia**, que es justo el defecto que
 * este archivo entero existe para impedir.
 *
 * ══ FAIL-OPEN: SIN DATO, NO HAY LÍNEA PROPIA ═════════════════════════════
 *
 * `undefined` (no se pudo leer el mapa) y `[]` (no tiene ninguna) contestan lo
 * mismo: **false**, o sea «comportate como hoy». Es la dirección que ya eligió
 * `recorteDeLineas`: un mapa que no se pudo leer degrada en «ves de más», nunca
 * en «no ves nada» — una cola vacía se lee «se perdieron las conversaciones»,
 * no «falta un dato». Acá la asimetría es todavía más clara: `true` QUITA la
 * rama de lo huérfano en `fronteraDeAsignacionSql`, así que devolver `true` sin
 * estar seguro es esconderle trabajo a alguien.
 *
 * ══ ⚠️ ES UN FILTRO DE LA LISTA, NO UN PERMISO ═══════════════════════════
 *
 * Hay que decirlo cada vez, porque este es justo el recorte que se ve como una
 * frontera. `docs/auditoria-aislamiento-de-chats-2026-08-17.md` lo midió: la
 * cola es la ÚNICA superficie con recorte — el hilo, la ficha y el envío siguen
 * sirviendo cualquier conversación a cualquier token. Lo que esto cambia es qué
 * APARECE en la cola de quien mira, no qué se puede pedir. Presentarlo como
 * aislamiento sería una frontera imaginaria: peor que ninguna, porque se le cree.
 */

/**
 * El propósito que declara «esta línea la atiende una vendedora».
 *
 * Es uno de los tres de `numeros/dominio.ts` (`PROPOSITOS`), y no se importa de
 * ahí a propósito: ese módulo valida el payload que empuja Cerberus y arrastra
 * Zod y el schema. Este archivo es puro y lo único que necesita es la cadena.
 * El gemelo del otro recorte hace lo mismo (`PROPOSITO_CAMPANA` en `lineas.ts`).
 */
export const PROPOSITO_LINEA_PROPIA = "vendedora";

/** Una línea del mapa, **con cuántas personas la comparten** (ver arriba: ese conteo no lo da `lineasDeVendedoraConProposito`). */
export interface LineaDeVendedora {
  /** Canónico, solo dígitos con código de país (`51941654039`). */
  numero: string;
  /** `numeros_wa.proposito`: escuela | campana | vendedora. */
  proposito: string;
  /** Cuántas filas de `numero_vendedora` apuntan a este número. 1 = es de una sola persona. */
  duenas: number;
}

/**
 * ¿ES UNA LÍNEA PROPIA? — el predicado, en un solo lugar, para que las dos
 * funciones públicas no puedan responder distinto sobre la misma fila.
 */
function esLineaPropia(linea: LineaDeVendedora): boolean {
  return linea.proposito === PROPOSITO_LINEA_PROPIA && linea.duenas === 1;
}

/**
 * ¿ESTA PERSONA TIENE AL MENOS UNA LÍNEA PROPIA?
 *
 * ⚠️ **Alcanza con UNA.** Alguien puede tener su línea del QR y estar además en
 * el mapa de Ventas Meta (es el caso que el dueño pidió: ven su línea entera y
 * de Ventas Meta solo lo asignado). Exigir que TODAS sean propias apagaría la
 * regla justo para quien está en las dos, que es la persona para la que se
 * escribió.
 */
export function tieneLineaPropia(lineas: readonly LineaDeVendedora[] | undefined): boolean {
  return (lineas ?? []).some(esLineaPropia);
}

/**
 * CUÁLES SON — para nombrarlas en el `WHERE` o en la pantalla.
 *
 * Devuelve **solo las propias**: la línea compartida queda afuera aunque esa
 * persona la atienda, porque de ahí no ve la línea entera sino lo que le
 * asignaron. Mezclarlas acá sería devolverle Ventas Meta completa a Walter.
 *
 * Ordenadas y sin repetidos por lo mismo que `recorteDeLineas`: el `IN (...)`
 * sale igual para el mismo conjunto, así el plan de Postgres y el caché del
 * front no dependen del orden en que Cerberus insertó las filas.
 */
export function lineasPropiasDe(lineas: readonly LineaDeVendedora[] | undefined): string[] {
  const propias = (lineas ?? []).filter(esLineaPropia).map((l) => l.numero.trim());
  return [...new Set(propias.filter(Boolean))].sort();
}
