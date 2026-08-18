import type { Recordatorio } from './agenda';
import { diasEntre } from './gantt';

/**
 * EL RESUMEN DE PRÓXIMAS ACTIVIDADES — lógica pura, testeable sin DOM.
 *
 * Debajo del calendario, la pregunta ya no es «¿qué hay el 18?» sino **«¿qué
 * sigue?»**. Es la misma agenda leída como lista, y por eso no repite el
 * criterio del calendario: acá **solo entra lo pendiente**, porque lo hecho no
 * es lo que sigue.
 *
 * Lo vencido va **primero y en su propio grupo**, con la misma regla que el
 * resto de la agenda: los vencidos gritan antes que nada.
 */

export interface GrupoProximas {
  /** «Vencidas», «Hoy», «Mañana», «jueves 20 de agosto». */
  etiqueta: string;
  /** Medianoche del día del grupo. `null` en el grupo de vencidas, que cruza días. */
  dia: Date | null;
  vencido: boolean;
  recordatorios: Recordatorio[];
}

/**
 * Cómo se llama un día en el resumen. «Hoy» y «Mañana» ganan a la fecha porque
 * es como se lee un calendario en voz alta; de ahí en adelante el día tiene que
 * decir su nombre, que es lo que evita confundir el 20 de este mes con el del
 * que viene.
 */
export function etiquetaDeDia(dia: Date, hoy: Date): string {
  const d = diasEntre(hoy, dia);
  if (d === 0) return 'Hoy';
  if (d === 1) return 'Mañana';
  return dia.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Agrupa lo pendiente por día, con las vencidas al frente.
 *
 * @param tope Cuántas actividades futuras entran como mucho. Las vencidas **no
 *   pagan ese tope**: esconder una promesa rota detrás de un «ver más» sería
 *   usar el resumen para tapar justo lo que hay que mirar.
 */
export function agruparProximas(rs: Recordatorio[], ahora: Date, tope = 12): GrupoProximas[] {
  const pendientes = rs.filter((r) => r.estado === 'pendiente');
  const orden = (a: Recordatorio, b: Recordatorio) => a.cuando.localeCompare(b.cuando);

  const vencidas = pendientes.filter((r) => diasEntre(ahora, new Date(r.cuando)) < 0).sort(orden);
  const futuras = pendientes
    .filter((r) => diasEntre(ahora, new Date(r.cuando)) >= 0)
    .sort(orden)
    .slice(0, tope);

  const grupos: GrupoProximas[] = [];
  if (vencidas.length > 0) grupos.push({ etiqueta: 'Vencidas', dia: null, vencido: true, recordatorios: vencidas });

  for (const r of futuras) {
    const d = new Date(r.cuando);
    const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia && ultimo.dia.getTime() === dia.getTime()) ultimo.recordatorios.push(r);
    else grupos.push({ etiqueta: etiquetaDeDia(dia, ahora), dia, vencido: false, recordatorios: r ? [r] : [] });
  }
  return grupos;
}

/** Cuántas quedaron afuera del tope, para poder decirlo en vez de esconderlas. */
export function pendientesFuturas(rs: Recordatorio[], ahora: Date): number {
  return rs.filter((r) => r.estado === 'pendiente' && diasEntre(ahora, new Date(r.cuando)) >= 0).length;
}

/**
 * EL PRÓXIMO SEGUIMIENTO DE UNA CONVERSACIÓN — lo que se dibuja arriba del chat.
 *
 * De todo lo pendiente de esa conversación, **el más viejo primero**: si hay una
 * promesa vencida, ésa es la que hay que ver, no la de la semana que viene.
 * Lo hecho y lo cancelado no cuentan — el banner contesta «¿qué me falta con
 * esta persona?», y las dos respuestas a eso son «nada».
 */
export function proximoDe(rs: Recordatorio[] | undefined, clave: string | null): Recordatorio | null {
  if (!rs || !clave) return null;
  const pendientes = rs
    .filter((r) => r.clave === clave && r.estado === 'pendiente')
    .sort((a, b) => a.cuando.localeCompare(b.cuando));
  return pendientes[0] ?? null;
}

/**
 * «Mañana · 10:00», «Vencido · ayer 9:00». Se lee de un vistazo, que es todo lo
 * que se le pide a un banner: la fecha completa está a un clic, en la Agenda.
 */
export function cuandoEnCriollo(r: Recordatorio, ahora = new Date()): string {
  const d = new Date(r.cuando);
  const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const hora = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return `${etiquetaDeDia(dia, ahora)} · ${hora}`;
}

/** ¿Se pasó la hora? Es lo que decide si el banner grita o informa. */
export function estaVencido(r: Recordatorio, ahora = new Date()): boolean {
  return new Date(r.cuando).getTime() < ahora.getTime();
}
