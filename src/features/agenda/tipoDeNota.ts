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

export type TipoNota =
  | 'llamada'
  | 'wsp'
  | 'correo'
  | 'reunion'
  | 'seguimiento'
  | 'recordatorio'
  | 'otro';

/**
 * LO QUE SE PUEDE ELEGIR AL AGENDAR, en orden. `correo` no está: mandar un
 * correo es otra herramienta (la del menú `···`), y ofrecerlo acá prometería
 * que agendarlo lo manda. Se sigue RECONOCIENDO —las notas viejas que empiezan
 * con «correo» conservan su color— pero no se ofrece.
 */
export const TIPOS_ELEGIBLES: { id: TipoNota; rotulo: string }[] = [
  { id: 'llamada', rotulo: 'Llamada' },
  { id: 'wsp', rotulo: 'WhatsApp' },
  { id: 'reunion', rotulo: 'Reunión' },
  { id: 'seguimiento', rotulo: 'Seguimiento' },
  { id: 'recordatorio', rotulo: 'Recordatorio' },
  { id: 'otro', rotulo: 'Otro' },
];

const CONOCIDOS = new Set<string>([
  'llamada',
  'wsp',
  'correo',
  'reunion',
  'seguimiento',
  'recordatorio',
  'otro',
]);

/**
 * DE QUÉ TIPO ES UNA ACTIVIDAD — el campo manda, el prefijo es el respaldo.
 *
 * 🔴 Hasta que existió la columna `tipo`, esto se ADIVINABA del prefijo de la
 * nota, y era la única forma que había. Ahora que se elige al agendar, el dato
 * elegido gana **siempre**: con la adivinanza por delante, alguien que elige
 * «Reunión» y escribe «llamar antes de la reunión» vería un chip de llamada
 * sobre su propia reunión — dos lugares diciendo qué es la misma actividad.
 *
 * El respaldo NO se saca: las filas anteriores a la columna no tienen tipo
 * elegido, y su prefijo sigue siendo lo único que se sabe de ellas. Un tipo
 * desconocido (uno que el server aceptó y este front todavía no dibuja) también
 * cae al respaldo en vez de romper.
 */
export function tipoDeActividad(r: { tipo?: string | null; nota: string }): TipoNota {
  if (r.tipo && CONOCIDOS.has(r.tipo)) return r.tipo as TipoNota;
  return tipoDeNota(r.nota);
}

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

/**
 * Fondo y texto del chip, por tipo.
 *
 * 🔴 **Cada par tiene que estar definido en LOS DOS temas.** `otro` era
 * `bg-secondary text-navy`, y `--navy` es color de MARCA: no se redefine en el
 * bloque oscuro de `index.css` (ahí sigue siendo `#0E2A52`) mientras
 * `--secondary` sí pasa a `#1E293B`. O sea que en modo oscuro el chip quedaba
 * navy sobre navy —contraste ~1,3:1— y **un seguimiento existía sin poder
 * leerse**. Al elegir un fondo, usá su `-foreground` hermano, nunca un color de
 * marca: es el mismo defecto que `::selection` tuvo en las burbujas del chat.
 */
export const CHIP_TIPO: Record<TipoNota, string> = {
  llamada: 'bg-primary/10 text-primary',
  wsp: 'bg-success/10 text-success',
  correo: 'bg-secondary text-secondary-foreground',
  reunion: 'bg-navy text-white',
  seguimiento: 'bg-navy-muted/15 text-navy-muted',
  recordatorio: 'bg-muted text-muted-foreground',
  otro: 'bg-muted text-foreground',
};

/** Color sólido del tipo, para la barrita de FilaDia y los puntitos del mes. */
export const BARRA_TIPO: Record<TipoNota, string> = {
  llamada: 'bg-primary',
  wsp: 'bg-success',
  correo: 'bg-navy-muted',
  reunion: 'bg-navy',
  seguimiento: 'bg-navy-muted/60',
  recordatorio: 'bg-navy/30',
  otro: 'bg-navy/30',
};

/**
 * El color del chip. La precedencia es una decisión de producto, no un orden
 * casual: **hecho gana sobre vencido, y vencido gana sobre el tipo.**
 *
 * Lo ya hecho se apaga aunque haya vencido —no sirve gritarle a la vendedora por
 * algo que ya resolvió— y lo vencido grita en rojo aunque fuera una llamada.
 */
export function estiloDeNota(r: { tipo?: string | null; nota: string }, vencido: boolean, hecho: boolean): string {
  if (hecho) return 'bg-muted text-muted-foreground line-through';
  if (vencido) return 'bg-destructive/10 text-destructive ring-1 ring-destructive/30';
  return CHIP_TIPO[tipoDeActividad(r)];
}

/** La barrita de color, con la misma precedencia que el chip. */
export function barraDeNota(r: { tipo?: string | null; nota: string }, vencido: boolean, hecho: boolean): string {
  if (hecho) return 'bg-muted-foreground/40';
  if (vencido) return 'bg-destructive';
  return BARRA_TIPO[tipoDeActividad(r)];
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
    const t = tipoDeActividad(r);
    cuenta[t] = (cuenta[t] ?? 0) + 1;
    if ((cuenta[t] ?? 0) > (cuenta[mejor] ?? 0)) mejor = t;
  }
  return mejor;
}
