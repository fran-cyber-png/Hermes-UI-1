import type { Recordatorio } from './agenda';

/**
 * LAS FECHAS DE LA AGENDA — lógica pura, testeable sin DOM.
 *
 * Vivían inline dentro de `VistaAgenda.tsx`, el archivo más grande del front
 * (815 líneas), donde no había forma de probarlas: para llegar a ellas había que
 * montar un componente React, y el runner del front corre en entorno `node`, sin
 * DOM (#109).
 *
 * Todo acá trabaja en **hora local**, que es la de la vendedora: la agenda se
 * lee mirando el reloj de la pared, no en UTC. Por eso los tests construyen sus
 * fechas con el constructor local y no con ISO + `Z` — si no, dirían una cosa en
 * Lima y otra en el runner de CI.
 */

/** ¿El mismo día del calendario? Compara el día, no el instante. */
export function mismaFecha(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * El lunes de la semana de `d`, a las 00:00.
 *
 * `(getDay() + 6) % 7` corre el domingo —que JavaScript numera 0— al final de la
 * semana en vez del principio: para la vendedora el domingo cierra la semana que
 * pasó, no abre la que viene.
 */
export function inicioDeSemana(d: Date): Date {
  const r = new Date(d);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  r.setHours(0, 0, 0, 0);
  return r;
}

/** La hora de un recordatorio, como se lee en el chip: «09:30». */
export function horaDe(r: Recordatorio): string {
  return new Date(r.cuando).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Date → valor de un input `datetime-local`, en hora local.
 *
 * ⚠️ **Las 00:00 se proponen como 09:00** (`getHours() || 9`). Es a propósito: al
 * hacer clic en un día vacío del calendario la fecha llega a medianoche, y nadie
 * agenda un seguimiento a esa hora. El costo es que la función **no distingue**
 * ese caso de un recordatorio real a las 00:30, que también saldría 09:30.
 * Queda documentado en un test; cambiarlo es otra decisión, no parte de #109.
 */
export function aLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours() || 9)}:${p(d.getMinutes())}`;
}

/**
 * La línea viva del crear: «mañana jueves 23, 9:00». Vacío si no parsea.
 *
 * Nombrar el día en palabras es lo que evita el error de agendar para el mes que
 * viene sin darse cuenta: un `2026-08-23T09:00` no se lee, «mañana jueves 23» sí.
 */
export function traducirCuando(cuando: string): string {
  const d = new Date(cuando);
  if (Number.isNaN(d.getTime())) return '';
  const hoy0 = new Date();
  hoy0.setHours(0, 0, 0, 0);
  const dia0 = new Date(d);
  dia0.setHours(0, 0, 0, 0);
  const dias = Math.round((dia0.getTime() - hoy0.getTime()) / 86_400_000);
  const prefijo = dias === 0 ? 'hoy ' : dias === 1 ? 'mañana ' : '';
  const fecha = d.toLocaleDateString('es', { weekday: 'long', day: 'numeric' });
  const hora = d.toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' });
  return `${prefijo}${fecha}, ${hora}`;
}

/**
 * Dónde cae el ahora dentro de una lista ordenada por hora: el índice del primer
 * recordatorio futuro. Es donde se dibuja la línea dorada del ahora — el único
 * oro estructural de la agenda, porque el dorado significa tiempo que se acaba.
 *
 * Si ya pasaron todos, devuelve el largo de la lista: la línea va al final.
 */
export function indiceTrasAhora(rs: Recordatorio[], ahora: Date): number {
  const i = rs.findIndex((r) => new Date(r.cuando) > ahora);
  return i === -1 ? rs.length : i;
}
