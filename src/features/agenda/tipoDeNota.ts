import type { Recordatorio } from './agenda';

/**
 * EL TIPO DE ACCIÓN DE UNA NOTA Y SU COLOR — lógica pura, testeable sin DOM.
 *
 * Un recordatorio no dice en una columna si es una llamada o un WhatsApp: lo dice
 * el **prefijo de su nota** («llamada a Ana», «wsp precio»), que es lo que la
 * vendedora tipea sin pensar. De ahí sale el color del chip en el calendario.
 *
 * Vivía inline en `VistaAgenda.tsx` junto a las fechas (#109). Va aparte de
 * `fechas.ts` a propósito: esto no es tiempo, son clases de Tailwind.
 *
 * **El dorado no aparece acá.** En Hermes el oro significa una sola cosa —tiempo
 * que se acaba (`src/index.css`)— y el tipo de una acción no es tiempo. El oro de
 * la agenda es la línea del ahora y el subrayado de hoy, nada más.
 */

export type TipoNota = 'llamada' | 'wsp' | 'correo' | 'reunion' | 'otro';

/**
 * El tipo sale del prefijo de la nota. `otro` es el default y no es un fallo:
 * la mayoría de las notas son texto libre y se pintan neutras.
 */
export function tipoDeNota(nota: string): TipoNota {
  const n = nota.toLowerCase();
  if (n.startsWith('llamada')) return 'llamada';
  if (n.startsWith('wsp')) return 'wsp';
  if (n.startsWith('correo')) return 'correo';
  // Con tilde y sin tilde: la vendedora escribe rápido y no siempre la pone.
  if (n.startsWith('reunión') || n.startsWith('reunion')) return 'reunion';
  return 'otro';
}

/** Fondo y texto del chip, por tipo. */
export const CHIP_TIPO: Record<TipoNota, string> = {
  llamada: 'bg-primary/10 text-primary',
  wsp: 'bg-success/10 text-success',
  correo: 'bg-secondary text-secondary-foreground',
  reunion: 'bg-navy text-white',
  otro: 'bg-secondary text-navy',
};

/** Color sólido del tipo, para la barrita de FilaDia y los puntitos del mes. */
export const BARRA_TIPO: Record<TipoNota, string> = {
  llamada: 'bg-primary',
  wsp: 'bg-success',
  correo: 'bg-navy-muted',
  reunion: 'bg-navy',
  otro: 'bg-navy/30',
};

/**
 * El color del chip. La precedencia es una decisión de producto, no un orden
 * casual: **hecho gana sobre vencido, y vencido gana sobre el tipo.**
 *
 * Lo ya hecho se apaga aunque haya vencido —no sirve gritarle a la vendedora por
 * algo que ya resolvió— y lo vencido grita en rojo aunque fuera una llamada.
 */
export function estiloDeNota(nota: string, vencido: boolean, hecho: boolean): string {
  if (hecho) return 'bg-muted text-muted-foreground line-through';
  if (vencido) return 'bg-destructive/10 text-destructive ring-1 ring-destructive/30';
  return CHIP_TIPO[tipoDeNota(nota)];
}

/** La barrita de color, con la misma precedencia que el chip. */
export function barraDeNota(nota: string, vencido: boolean, hecho: boolean): string {
  if (hecho) return 'bg-muted-foreground/40';
  if (vencido) return 'bg-destructive';
  return BARRA_TIPO[tipoDeNota(nota)];
}

/**
 * De qué es, sobre todo, un día: el tipo más repetido entre sus recordatorios.
 * Es lo que pinta el puntito del día en la grilla del mes, donde no hay lugar
 * para cinco colores.
 *
 * **El empate lo gana el que ya iba ganando**, y arranca ganando `otro`: solo se
 * cambia de líder cuando alguien lo supera de verdad (`>`, no `>=`).
 */
export function tipoDominante(rs: Recordatorio[]): TipoNota {
  const cuenta: Partial<Record<TipoNota, number>> = {};
  let mejor: TipoNota = 'otro';
  for (const r of rs) {
    const t = tipoDeNota(r.nota);
    cuenta[t] = (cuenta[t] ?? 0) + 1;
    if ((cuenta[t] ?? 0) > (cuenta[mejor] ?? 0)) mejor = t;
  }
  return mejor;
}
