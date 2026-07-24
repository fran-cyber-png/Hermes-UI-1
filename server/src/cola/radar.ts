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
 * Mensajes sí pagina, y para paginar en la base el orden tiene que calcularse en
 * la base: esa proyección vive en `cola/urgenciaSql.ts`, al lado de la función
 * pura, y el test de paridad (`urgencia.paridad.test.db.ts`) falla en CI si las
 * dos implementaciones vuelven a decir cosas distintas (#37).
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
  /**
   * El seguimiento agendado más viejo que sigue pendiente, si hay uno — de
   * `recordatorios` por clave. Sin este campo el nivel VENCIDO no existe: fue
   * el bug de #38 (el tipo ni lo tenía, así que nadie notó que no llegaba).
   * Opcional porque los leads de formulario no cargan agenda.
   */
  seguimiento_en?: string | Date | null;
}

function itemDe(fila: FilaRadar): ItemUrgencia {
  return {
    tipo: fila.tipo === 'comentario' ? 'comentario' : 'mensaje',
    ventanaAbierta: fila.ventana_abierta,
    respondida: fila.respondida,
    referencia: fila.referencia instanceof Date ? fila.referencia : new Date(fila.referencia),
    seguimientoEn:
      fila.seguimiento_en == null
        ? null
        : fila.seguimiento_en instanceof Date
          ? fila.seguimiento_en
          : new Date(fila.seguimiento_en),
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
