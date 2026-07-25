/**
 * LOS ESTADOS DE UNA AUTO-RESPUESTA — la máquina, escrita una sola vez.
 *
 * Antes del modo supervisado (ADR 0016) la vida de una pendiente cabía en cuatro
 * palabras sueltas repartidas entre el repositorio, el despachador y dos
 * consultas SQL: `pendiente`, `enviada`, `cancelada`, `fallida`. Con la
 * aprobación humana en el medio aparecen tres más y, sobre todo, aparece una
 * REGLA que hay que poder señalar con el dedo:
 *
 *   **una `preparada` no llega a `enviada` sin pasar por `aprobada`.**
 *
 * Ese salto prohibido ES el modo supervisado. Si viviera dentro de un `if` en el
 * despachador, cualquier atajo futuro («total, es lo mismo») lo borraría sin que
 * ningún test se queje. Acá vive explícito y con su test.
 *
 * Los CONJUNTOS de abajo son la otra mitad del trabajo: cada consulta que
 * pregunta «¿qué cuenta como qué?» los importa en vez de escribir su propia
 * lista de literales. Tres listas iguales escritas en tres archivos es la
 * divergencia de #37 esperando turno — y acá el precio de divergir sería mandar
 * dos mensajes a la misma persona, o ninguno.
 *
 * ── El vocabulario, en criollo ──
 *   · `preparada`  la máquina la escribió y espera el OK de una persona (supervisada).
 *   · `pendiente`  la máquina la escribió y sale sola cuando le toque (automática).
 *   · `aprobada`   una vendedora le dio el OK: ya está en la cola de envío.
 *   · `enviada`    salió por `EnvioControlado`, con su id de WhatsApp.
 *   · `descartada` una PERSONA dijo que esa no va. Decisión humana, no del sistema.
 *   · `caducada`   nadie la aprobó a tiempo y ya no tiene sentido mandarla.
 *   · `cancelada`  la retiró el SISTEMA (la vendedora contestó, entró el horario…).
 *   · `fallida`    se intentó y WhatsApp la rechazó. Frena la cola entera.
 *
 * La diferencia entre `descartada`, `caducada` y `cancelada` no es cosmética: a
 * fin de mes son tres preguntas distintas — «¿cuánto rechaza la vendedora?»,
 * «¿cuánto se nos pasa por no revisar a tiempo?» y «¿cuánto retira el sistema
 * solo?». Colapsarlas en una haría que ninguna se pueda contestar.
 */

export const ESTADOS = [
  'preparada',
  'pendiente',
  'aprobada',
  'enviada',
  'descartada',
  'caducada',
  'cancelada',
  'fallida',
] as const;

export type EstadoPendiente = (typeof ESTADOS)[number];

export function esEstado(v: string): v is EstadoPendiente {
  return (ESTADOS as readonly string[]).includes(v);
}

/**
 * LO QUE EL DESPACHADOR PUEDE MANDAR. `preparada` no está, y esa ausencia es la
 * garantía entera del modo supervisado: el despachador no la ignora por
 * cortesía, es que no la ve.
 */
export const EN_COLA_DE_ENVIO = ['pendiente', 'aprobada'] as const satisfies readonly EstadoPendiente[];

/** Lo que espera que una persona diga que sí. Es la bandeja de revisión. */
export const ESPERAN_APROBACION = ['preparada'] as const satisfies readonly EstadoPendiente[];

/**
 * LO QUE OCUPA CUPO DE RITMO (techos por hora/día y espaciado).
 *
 * Una `preparada` todavía puede no salir nunca, y aun así reserva: si no
 * reservara, el encolado de la noche prepararía 200 para una ventana de 60 y la
 * vendedora aprobaría un lote que no entra. Reservar de más se corrige solo (al
 * aprobar se reparte de nuevo con el reloj de ese momento); reservar de menos se
 * paga en el único lugar donde no hay vuelta atrás, que es el número de WhatsApp.
 */
export const OCUPAN_RITMO = [
  'preparada',
  'pendiente',
  'aprobada',
  'enviada',
] as const satisfies readonly EstadoPendiente[];

/**
 * LO QUE RESERVA «LA DEL DÍA» de una conversación. Incluye `descartada` y
 * `caducada` a propósito: si la vendedora ya dijo que no a esta persona esta
 * noche, el encolado de dentro de cinco minutos no puede volver a proponerla —
 * sería preguntarle lo mismo doce veces por hora.
 *
 * `cancelada` y `fallida` NO están: la primera significa que alguien de la casa
 * ya contestó de verdad (y la candidatura muere por otro lado, porque el último
 * mensaje deja de ser de la persona), y la segunda que hubo un problema de
 * envío, que frena la cola entera igual.
 */
export const RESERVAN_EL_DIA = [
  ...OCUPAN_RITMO,
  'descartada',
  'caducada',
] as const satisfies readonly EstadoPendiente[];

/** El grafo. Lo que no está listado, no se puede: la lista blanca es la regla. */
const SALIDAS: Record<EstadoPendiente, readonly EstadoPendiente[]> = {
  // El modo supervisado en una línea: de acá NO se sale a `enviada`.
  preparada: ['aprobada', 'descartada', 'caducada', 'cancelada'],
  pendiente: ['enviada', 'fallida', 'cancelada'],
  aprobada: ['enviada', 'fallida', 'cancelada'],
  enviada: [],
  descartada: [],
  caducada: [],
  cancelada: [],
  fallida: [],
};

/** Un estado del que ya no se sale. Lo que pasó, pasó. */
export function esFinal(estado: EstadoPendiente): boolean {
  return SALIDAS[estado].length === 0;
}

export function puedeTransicionar(desde: EstadoPendiente, hasta: EstadoPendiente): boolean {
  return SALIDAS[desde].includes(hasta);
}

export type Transicion = { ok: true } | { ok: false; motivo: string };

/**
 * La misma pregunta, con la respuesta en criollo para poder devolvérsela a la
 * vendedora tal cual (la ruta de aprobar contesta con este texto).
 */
export function transicionar(desde: EstadoPendiente, hasta: EstadoPendiente): Transicion {
  if (puedeTransicionar(desde, hasta)) return { ok: true };

  if (desde === 'preparada' && hasta === 'enviada') {
    return { ok: false, motivo: 'una preparada necesita la aprobación de una persona antes de salir' };
  }
  if (esFinal(desde)) {
    return { ok: false, motivo: `ya está «${desde}»: eso no se deshace` };
  }
  return { ok: false, motivo: `no se puede pasar de «${desde}» a «${hasta}»` };
}
