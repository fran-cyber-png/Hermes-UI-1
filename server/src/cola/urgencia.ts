/**
 * QUÉ ES "URGENTE" EN LA COLA DE LA VENDEDORA.
 *
 * La regla vieja ordenaba todo por la ventana de 7 días de Meta. Con WhatsApp en
 * la misma cola eso enterraba lo que más vende: un chat donde alguien está
 * escribiendo AHORA "quiero comprar, pasame el link" quedaba debajo de miles de
 * comentarios "👏" con la ventana abierta.
 *
 * Goberna vende por WhatsApp: una conversación viva es lo más urgente que hay.
 * Por eso la urgencia tiene seis niveles, y el vivo va arriba de todo:
 *
 *   Nivel 0 — VIVO: mensaje sin responder con un entrante RECIENTE (< 24 h).
 *             Alguien está hablando ahora. El MÁS RECIENTE primero: en ventas, un
 *             lead que acaba de escribir se contesta al toque (velocidad = venta),
 *             y tiene que estar arriba de todo, no enterrado bajo un chat de ayer.
 *   Nivel 1 — VENCIDO: el seguimiento agendado cuya fecha ya pasó. El compromiso
 *             más viejo primero. Va DEBAJO de lo vivo a propósito — ver abajo.
 *   Nivel 2 — EXPIRA: comentario de Meta con la ventana abierta y sin responder.
 *             El más viejo primero (le quedan menos horas antes de cerrarse).
 *   Nivel 3 — ESPERA: mensaje sin responder pero ya viejo (> 24 h). Sigue siendo
 *             trabajo pendiente; el más viejo primero.
 *   Nivel 4 — SILENCIO: le contestamos y la persona no volvió. Es seguimiento, no
 *             deuda. El silencio MÁS RECIENTE primero: a los dos días se rescata,
 *             a los catorce ya es archivo.
 *   Nivel 5 — EL RESTO: ventanas cerradas y comentarios respondidos. Reciente
 *             primero; nada de esto corre peligro.
 *
 * Los niveles 0–3 son DEUDA (el turno es nuestro), el 4 es SILENCIO (el turno es
 * de la persona) y el 5 es archivo. Ver `CONTEXT.md`.
 *
 * POR QUÉ VIVO LE GANA A VENCIDO, que es lo contrario de lo que parece: quien
 * está escribiendo ahora mismo se contesta al toque, y una promesa de ayer aguanta
 * cinco minutos más. Fue una decisión explícita, no un descuido. Hay un test que
 * la fija; si lo ves fallar, no lo "arregles" sin releer esto.
 *
 * ESTA REGLA EXISTE DOS VECES A PROPÓSITO: acá (la definición canónica) y
 * proyectada a SQL en `urgenciaSql.ts`, porque la cola pagina en la base. Si
 * tocás un nivel acá, tocá la proyección en el mismo commit — el test de paridad
 * (`urgencia.paridad.test.db.ts`) corre las dos contra los mismos datos y es el
 * candado que faltó cuando divergieron (#37).
 */

export interface ItemUrgencia {
  tipo: 'comentario' | 'mensaje' | 'lead';
  /** Solo significa algo en comentarios: la ventana de 7 días de Meta sigue abierta. */
  ventanaAbierta: boolean;
  /** ¿Existe un saliente posterior al último entrante? Derivada, nunca estado de fila. */
  respondida: boolean;
  /**
   * El momento que manda para ordenar. Depende del estado, y quien arma el item
   * elige cuál corresponde:
   * - comentario → cuándo comentó (cuánto le queda de ventana);
   * - mensaje sin responder → el último entrante (cuánto hace que espera);
   * - mensaje respondido → cuándo respondimos (cuándo empezó el silencio).
   */
  referencia: Date;
  /**
   * La fecha del seguimiento agendado, si hay uno. El módulo decide si ya venció:
   * pasar una fecha futura NO convierte al item en Vencido.
   */
  seguimientoEn?: Date | null;
}

/** Una conversación se considera VIVA si el entrante sin responder llegó hace menos de esto. */
export const ACTIVO_MS = 24 * 60 * 60 * 1000;

/**
 * ══ 🔴 QUÉ FILAS ESPERAN UNA RESPUESTA NUESTRA ═════════════════════════════
 *
 * Un chat de WhatsApp **y un formulario de landing** (`cola/leadsCte.ts`, el
 * tercer brazo de la unión). Los dos son deuda nuestra; un comentario de Meta no
 * entra acá porque tiene su propio nivel, el 2, gobernado por la ventana de 7
 * días.
 *
 * ── EL DEFECTO QUE ESTO ARREGLA, MEDIDO EL 11-ago-2026 ───────────────────
 * Los niveles se preguntaban `tipo === 'mensaje'`, así que un lead —`tipo =
 * 'lead'`— **no matcheaba ninguno de los cinco primeros y caía al 5**, que este
 * mismo archivo describe como *«EL RESTO: ventanas cerradas y comentarios
 * respondidos. Nada de esto corre peligro»*. Justo al revés de lo que es.
 *
 * Y como las 377 conversaciones de «Te esperan» son todas nivel 3 —`interesado`
 * se deriva de `NOT respondida`, que ES el nivel 3—, los **154 formularios de la
 * columna quedaban debajo de las 377, o sea en la página 10** de una lista que
 * pagina de a 40. La columna los contaba (531) y no había forma de verlos: el
 * frente estaba entero salvo esta línea.
 *
 * 🔴 **Y era una divergencia MUDA entre las dos escrituras de la regla**: el
 * `comoItem` de `urgencia.paridad.test.db.ts` ya colapsaba todo lo que no es
 * comentario a `'mensaje'`, así que la función pura decía nivel 0/3 y el SQL
 * decía 5 — el test no lo veía sólo porque no sembraba ningún lead. Ahora siembra.
 *
 * ⚠️ **La lista es EXPLÍCITA y no `tipo !== 'comentario'`**: con la negación, un
 * `tipo` nuevo entraría de callado a la deuda de la vendedora. Que un tipo nuevo
 * caiga al nivel 5 es un default aburrido; que se cuele arriba de todo, no.
 */
export const ESPERAN_RESPUESTA: readonly ItemUrgencia['tipo'][] = ['mensaje', 'lead'];

const esperaRespuesta = (tipo: ItemUrgencia['tipo']): boolean =>
  ESPERAN_RESPUESTA.includes(tipo);

/** Nivel de urgencia; menor = más arriba en la cola. */
export type Clave = { nivel: 0 | 1 | 2 | 3 | 4 | 5; orden: number };

export function claveUrgencia(item: ItemUrgencia, ahora: Date): Clave {
  const t = item.referencia.getTime();
  const edad = ahora.getTime() - t;

  // Nivel 0 — VIVO: mensaje sin responder, con un entrante reciente. El MÁS
  // RECIENTE primero (negamos el tiempo): velocidad de respuesta = conversión.
  if (esperaRespuesta(item.tipo) && !item.respondida && edad < ACTIVO_MS) {
    return { nivel: 0, orden: -t };
  }

  // Nivel 1 — VENCIDO: el seguimiento que se prometió la vendedora y ya pasó. El
  // compromiso más viejo primero. Va DEBAJO de lo vivo a propósito: quien está
  // escribiendo ahora se contesta al toque, la promesa de ayer aguanta cinco
  // minutos más.
  const vence = item.seguimientoEn?.getTime();
  if (vence !== undefined && vence <= ahora.getTime()) {
    return { nivel: 1, orden: vence };
  }

  // Nivel 2 — EXPIRA: comentario Meta con ventana abierta, sin responder. El más
  // viejo primero (menos horas de ventana) → ascendente.
  if (item.tipo === 'comentario' && item.ventanaAbierta && !item.respondida) {
    return { nivel: 2, orden: t };
  }

  // Nivel 3 — ESPERA: mensaje sin responder pero ya viejo. Todavía es trabajo.
  if (esperaRespuesta(item.tipo) && !item.respondida) {
    return { nivel: 3, orden: t };
  }

  // Nivel 4 — SILENCIO: le contestamos y la persona no volvió. Sigue siendo
  // trabajo, pero de otra clase: es seguimiento, no deuda. El silencio MÁS
  // RECIENTE primero (negamos): a los dos días se rescata, a los catorce ya es
  // archivo. Solo aplica a conversaciones — un comentario respondido no abre
  // ninguna espera, se archiva.
  if (esperaRespuesta(item.tipo) && item.respondida) {
    return { nivel: 4, orden: -t };
  }

  // Nivel 5 — EL RESTO: ventanas cerradas y comentarios ya respondidos. Nada de
  // esto corre peligro. Reciente arriba (negamos).
  return { nivel: 5, orden: -t };
}

/** Compara dos claves: primero el nivel, después el orden interno. Menor = más arriba. */
export function compararUrgencia(a: Clave, b: Clave): number {
  if (a.nivel !== b.nivel) return a.nivel - b.nivel;
  return a.orden - b.orden;
}

/** Ordena una lista por urgencia. No muta el arreglo original. */
export function ordenarPorUrgencia<T extends ItemUrgencia>(items: T[], ahora: Date): T[] {
  return [...items].sort((x, y) => compararUrgencia(claveUrgencia(x, ahora), claveUrgencia(y, ahora)));
}
