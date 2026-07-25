import type { InteresRegistrado } from '../gestion/lineaDeTiempo';

/**
 * EL INTERÉS, LEÍDO COMO LO QUE ES: algo que se acumula.
 *
 * «Los intereses mejor posicionados, también es **progresivo** y ayuda a dar
 * contexto a todo» (dueño, 2026-07-25). Progresivo quiere decir que la lista no
 * es un campo con un valor: es una historia corta —«el 1 de julio preguntó por
 * Inteligencia, el 15 por OSINT»— y esa evolución es justamente lo que le dice a
 * la vendedora si la persona está explorando o ya sabe qué quiere.
 *
 * Los chips con su línea de tiempo los pinta `gestion/Intereses` (compartido con
 * la cola, el Pipeline y la compuerta). Lo que falta arriba es **la lectura en
 * una línea**: cuántos son y de cuándo es el último. Eso es lo que se calcula
 * acá, puro, para poder discutirlo con un test.
 */

export interface ResumenInteres {
  /** Cuántos cursos distintos hay asentados. */
  cuantos: number;
  /** La línea que se lee debajo de los chips. `null` = no hay nada que resumir. */
  linea: string | null;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function fechaCorta(iso: string, hoy: Date): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mismoDia =
    d.getFullYear() === hoy.getFullYear() &&
    d.getMonth() === hoy.getMonth() &&
    d.getDate() === hoy.getDate();
  if (mismoDia) return 'hoy';
  const etiqueta = `${d.getDate()} ${MESES[d.getMonth()]}`;
  // El año solo cuando NO es el corriente: dentro del ciclo de venta es ruido,
  // pero un interés del año pasado tiene que delatarse.
  return d.getFullYear() === hoy.getFullYear() ? etiqueta : `${etiqueta} ${String(d.getFullYear()).slice(2)}`;
}

export function resumirIntereses(
  lista: readonly InteresRegistrado[],
  hoy: Date = new Date(),
): ResumenInteres {
  if (lista.length === 0) return { cuantos: 0, linea: null };

  const sustantivo = lista.length === 1 ? 'curso anotado' : 'cursos anotados';
  // El más nuevo manda: es el que dice qué quiere HOY.
  const fechas = lista.map((i) => i.creadoAt).filter((f): f is string => Boolean(f));
  const masNuevo = fechas.sort().at(-1);
  const cuando = masNuevo ? fechaCorta(masNuevo, hoy) : null;

  // Sin fecha (caché viejo, forma plana) se dice el conteo y nada más: inventar
  // un «hoy» sobre un dato sin fecha sería mentir sobre la evolución.
  if (!cuando) return { cuantos: lista.length, linea: `${lista.length} ${sustantivo}` };

  return {
    cuantos: lista.length,
    linea:
      lista.length === 1
        ? `1 ${sustantivo} · ${cuando}`
        : `${lista.length} ${sustantivo} · el último, ${cuando}`,
  };
}
