import { claveUrgencia, compararUrgencia, type ItemUrgencia } from './urgencia.js';

/**
 * EL ORDEN DEL RADAR — una sola vez, del lado del server.
 *
 * Antes esto vivía en el front, dos veces y en direcciones opuestas: la lista
 * ordenaba del más nuevo al más viejo y el botón «Atender a {nombre}» elegía al
 * más VIEJO. La pantalla recomendaba a alguien y lo escondía al fondo de una
 * lista de sesenta. Con una sola función decidiendo, esa clase de bug no puede
 * volver a existir: «lo primero de la lista» y «a quién atender» son, por
 * definición, la misma fila.
 *
 * El radar puede ordenar acá porque NO pagina — trae un tope y punto. La cola de
 * Mensajes sí pagina, y por eso conserva su espejo de esta lógica en SQL
 * (`routes/conversaciones.ts`): para paginar en la base, el orden tiene que
 * calcularse en la base. Son dos fuentes de verdad y lo sabemos; si tocás los
 * niveles de `urgencia.ts`, el espejo hay que tocarlo a mano.
 */

/** Lo mínimo que una fila del radar necesita para que la urgencia la ordene. */
export interface FilaRadar {
  /** 'mensaje' | 'comentario' — llega como texto desde Postgres. */
  tipo: string;
  /** ¿Hay un saliente igual o posterior al último entrante? */
  respondida: boolean;
  /** Solo significa algo en comentarios: la ventana de 7 días de Meta sigue abierta. */
  ventana_abierta: boolean;
  /** Postgres devuelve timestamps como texto ISO; se convierten acá, no antes. */
  referencia: string | Date;
}

function itemDe(fila: FilaRadar): ItemUrgencia {
  return {
    tipo: fila.tipo === 'comentario' ? 'comentario' : 'mensaje',
    ventanaAbierta: fila.ventana_abierta,
    respondida: fila.respondida,
    referencia: fila.referencia instanceof Date ? fila.referencia : new Date(fila.referencia),
  };
}

/**
 * Ordena las filas del radar por urgencia y le cuelga a cada una su clave completa
 * — `nivel` y `orden`. No muta la entrada.
 *
 * Va la clave entera, no solo el nivel, porque el radar muestra dos listas en una
 * pantalla (conversaciones y leads de formulario) y el front tiene que poder
 * mezclarlas **sin inventar ningún criterio propio**: ordena por (nivel, orden) y
 * listo. Si solo viajara el nivel, el front tendría que desempatar por su cuenta —
 * y ese desempate paralelo es exactamente el bug que este cambio vino a matar.
 */
export function ordenarRadar<T extends FilaRadar>(
  filas: T[],
  ahora: Date,
): (T & { nivel: number; orden: number })[] {
  return filas
    .map((fila) => ({ fila, clave: claveUrgencia(itemDe(fila), ahora) }))
    .sort((a, b) => compararUrgencia(a.clave, b.clave))
    .map(({ fila, clave }) => ({ ...fila, nivel: clave.nivel, orden: clave.orden }));
}
