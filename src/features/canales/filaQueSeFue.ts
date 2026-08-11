/**
 * «LE CONTESTO Y DESAPARECE» — la queja de Luz, y el único hueco que quedaba.
 *
 * ── El síntoma ────────────────────────────────────────────────────────────────
 *
 * Luz le contesta a alguien y **la conversación se va de la lista**. No es un
 * bug: son dos mecanismos, los dos correctos.
 *
 *   1. **El orden.** Contestar mueve la fila del nivel 0/3 (deuda, el turno es
 *      nuestro) al **nivel 4** (silencio, el turno es de la otra persona) —
 *      `server/src/cola/urgencia.ts`. La cola pagina de a 40 y arriba tiene
 *      cientos de filas de deuda, así que la fila **cae fuera de la página
 *      cargada**. No se reordena: desaparece de la vista.
 *   2. **El filtro.** Con un chip de deuda puesto, mandar invalida
 *      `['conversaciones']`, el server recalcula `respondida = true` y la fila
 *      **se cae del resultado**.
 *
 * ── 🔴 EL SEGUNDO YA ESTABA RESUELTO, Y POR ESO ESTE MÓDULO ES CHICO ──────────
 *
 * `ColaUnificada` ya tiene una **fila pin de orientación**: cuando la abierta no
 * aparece bajo el filtro, la búsqueda, el tab o la categoría, se fija arriba para
 * que no se pierda (`pinVisible`). O sea que con un chip puesto la fila NO
 * desaparece — se queda a la vista, arriba.
 *
 * El hueco es exactamente el complemento: **`tab === 'todo'` y ningún recorte**,
 * que es como Luz abre la cola (medido el 11-ago-2026: ve 4.143 conversaciones
 * sin filtro). Ahí `pinVisible` es `false` a propósito —no hay ningún recorte que
 * culpar— y la fila simplemente baja fuera de la página cargada.
 *
 * Leer el código antes de diseñar cambió el frente entero: la primera versión de
 * este archivo tenía dos ramas y una de las dos hubiera duplicado el pin.
 *
 * ── Por qué se avisa en vez de fijarla también acá ────────────────────────────
 *
 * Se evaluó extender el pin a este caso y se descartó (decisión del dueño): sin
 * recorte, la lista **es** el orden del server, y fijar una fila arriba mientras
 * el server dice que está abajo sería una segunda verdad sobre el mismo hecho
 * (#37). Bajo un filtro el pin es honesto —dice «esto no cumple el recorte, te lo
 * dejo igual»—; sin filtro sería mentir sobre la urgencia.
 *
 * Entonces: la fila baja, y **la pantalla lo dice**, con un modo de volver.
 */

/** Lo mínimo que hace falta para saber si la fila abierta se fue de la vista. */
export interface EstadoDeLista {
  /** La clave de la conversación abierta. `null` = no hay ninguna abierta. */
  abierta: string | null;
  /** El nombre con el que la pantalla la llama, para poder nombrarla. */
  nombre?: string | null;
  /** Las claves que la lista muestra AHORA. */
  claves: readonly string[];
  /** Las claves que mostraba ANTES del refetch. */
  clavesAntes: readonly string[];
  /**
   * ¿La cola ya la está fijando arriba? Es `pinVisible` de `ColaUnificada`. Con
   * el pin puesto no hay nada que avisar: la fila está a la vista.
   */
  fijadaArriba: boolean;
  /** Mientras carga no se sabe nada: una lista a medio traer no es una ausencia. */
  cargando: boolean;
}

export interface AvisoDeFila {
  /** La conversación que bajó — es con lo que se vuelve a ella. */
  clave: string;
  /** Qué pasó, en la voz de la vendedora. */
  texto: string;
}

/**
 * ¿BAJÓ LA FILA ABIERTA FUERA DE LA VISTA?
 *
 * `null` cuando no hay nada que avisar, que es casi siempre. Las guardas, en
 * orden, y cada una tapa un caso donde el aviso sería ruido:
 *
 *   · **Cargando** — una lista a medio traer no es una ausencia. Sin esto el
 *     aviso parpadea en cada refetch.
 *   · **Sin conversación abierta** — no hay fila que extrañar.
 *   · **Ya está fijada arriba** — el pin de orientación la tiene a la vista.
 *   · **Sigue en la lista** — no se fue.
 *   · 🔴 **Si NO estaba antes, no se fue AHORA.** Es la guarda que importa: se
 *     abre una conversación desde el Pipeline, desde el buscador o desde el radar
 *     y esa fila nunca estuvo en esta lista. Sin ella, el aviso saldría en el
 *     momento exacto en que no pasó nada — la forma más rápida de enseñarle a la
 *     vendedora a ignorarlo.
 */
export function avisoDeFilaQueSeFue(e: EstadoDeLista): AvisoDeFila | null {
  if (e.cargando) return null;
  if (!e.abierta) return null;
  if (e.fijadaArriba) return null;
  if (e.claves.includes(e.abierta)) return null;
  if (!e.clavesAntes.includes(e.abierta)) return null;

  const quien = e.nombre?.trim() ? e.nombre.trim() : 'esa persona';
  return {
    clave: e.abierta,
    // Dice a DÓNDE fue, no solo que se fue: el turno pasó a ser de la otra
    // persona, y ése es el hecho que explica el movimiento. «Desapareció» no
    // explica nada y «se movió» tampoco dice adónde mirar.
    texto: `Le contestaste a ${quien}: bajó con las que esperan respuesta.`,
  };
}
