import { ErrorApi } from '../../lib/datos/cliente';
import { LIMITE_TEXTO } from './notas';

/**
 * EL ESTADO DEL GUARDADO, COMO DATO — y su lectura, pura.
 *
 * ══ EL DEFECTO QUE ESTO EXISTE PARA MATAR ═══════════════════════════════════
 *
 * La Libreta tragaba el error del autoguardado con un `catch {}` cuyo comentario
 * afirmaba «el error se ve en el renglón de estado». Ese renglón era:
 *
 *     {guardando ? 'Guardando…' : paginaAbierta?.editadoAt ? 'Guardado' : ''}
 *
 * o sea que **no tenía rama de error**, y peor: si la página ya se había editado
 * alguna vez (`editadoAt != null`), después de un fallo volvía a decir
 * **«Guardado»**. No es que faltara un aviso — es que la pantalla afirmaba lo
 * contrario de lo que había pasado.
 *
 * Y hay una vía de disparo garantizada: pasarse de `LIMITE_TEXTO` (2.000
 * caracteres del texto APLANADO). A partir de ahí **todos** los autoguardados
 * responden 400 y la vendedora sigue escribiendo, convencida de que se guarda.
 *
 * ══ POR QUÉ LA LECTURA ES UNA FUNCIÓN Y NO UN TERNARIO ══════════════════════
 *
 * El defecto no estaba en el `catch`: estaba en el ternario. Un ternario adentro
 * del JSX no se puede interrogar sobre el caso que todavía no existe — que es
 * justo el que importa. Acá la regla que faltaba se puede escribir y fijar con
 * un test: **`fallo` le gana a `guardado`, siempre**.
 */

export type EstadoGuardado =
  | { tipo: 'quieto' }
  | { tipo: 'guardando' }
  | { tipo: 'guardado' }
  | { tipo: 'fallo'; motivo: string };

export const QUIETO: EstadoGuardado = { tipo: 'quieto' };

/**
 * QUÉ DICE EL RENGLÓN DE ESTADO.
 *
 * `yaSeEdito` es el `editadoAt` de la página: sirve para distinguir «todavía no
 * escribiste nada» de «está guardado». **Nunca puede tapar un fallo**, y eso es
 * lo único que este archivo tiene que garantizar.
 */
export function renglonDeEstado(
  estado: EstadoGuardado,
  yaSeEdito: boolean,
): { texto: string; hayFallo: boolean } {
  if (estado.tipo === 'fallo') return { texto: estado.motivo, hayFallo: true };
  if (estado.tipo === 'guardando') return { texto: 'Guardando…', hayFallo: false };
  if (estado.tipo === 'guardado' || yaSeEdito) return { texto: 'Guardado', hayFallo: false };
  return { texto: '', hayFallo: false };
}

/**
 * DE UN ERROR A ALGO QUE SE PUEDA LEER MIENTRAS SE ESCRIBE.
 *
 * El server ya manda el motivo bueno en el 400 —«la nota no puede superar los
 * 2.000 caracteres (tiene 2.431)»— y ese se prefiere sobre cualquier cosa que
 * inventemos acá: trae el número exacto, que es lo que dice cuánto recortar.
 *
 * El `LIMITE_TEXTO` se importa para el caso en que el server no explique nada:
 * un 400 pelado en la Libreta es, en la práctica, siempre el tope.
 */
export function motivoDelFallo(error: unknown): string {
  if (error instanceof ErrorApi) {
    if (error.message && error.status === 400) return `No se guardó: ${error.message}`;
    if (error.status === 400) return `No se guardó: pasa de los ${LIMITE_TEXTO} caracteres`;
    if (error.status === 401) return 'No se guardó: se cerró tu sesión';
    return `No se guardó (error ${error.status})`;
  }
  // Sin `status` no hubo respuesta: red caída, server que no contesta.
  return 'No se guardó: no pude hablar con el servidor';
}
