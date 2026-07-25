import type { ConfigAutoRespuesta } from './config.js';
import { diaLocal, proximoMomento } from './franja.js';

/**
 * CUÁNTO VIVE UNA PREPARADA — «un pendiente de anoche no se manda a las 3 de la
 * tarde» (dueño, 2026-07-25), dicho en código y con el reloj inyectado.
 *
 * ── Por qué hace falta una regla propia ──
 * La cola automática ya tenía la suya: lo que sale con más de 90 minutos de
 * atraso se cancela (`despachador.ts`). Pero una preparada no está atrasada —
 * está ESPERANDO A UNA PERSONA, y esa persona tarda lo que tarda en llegar a la
 * oficina. Aplicarle los 90 minutos de la cola automática vaciaría la bandeja
 * justo antes de que la vendedora la abra, que es el único momento en que la
 * bandeja sirve.
 *
 * ── La regla ──
 * Una preparada vive **la gracia** (3 h por defecto) contada desde la hora que
 * el reparto le reservó, y **nunca cruza el día local**. Con los defaults, lo
 * que se preparó para las 07:30 sigue ahí a las 09:00 (llega la vendedora), a
 * las 10:00 (ya arrancó el día) y se apaga a las 10:30. A las 15:00 —la hora que
 * el dueño nombró— hace rato que no existe.
 *
 * El corte del día es la red: una config rara (gracia de 20 h) no puede hacer
 * que el acuse de anoche aparezca aprobable en la bandeja de mañana.
 *
 * Y una cosa que esta regla NO hace, a propósito: **la llegada del horario de
 * atención no caduca nada**. En modo automático empezar el turno cancela la cola
 * (responde la vendedora, la plantilla sobra); en supervisado la vendedora ES
 * quien aprueba, y son las 9 de la mañana cuando por fin puede mirar las 40
 * conversaciones de la noche. Matarle la bandeja al llegar sería tapar el
 * agujero con el mismo agujero.
 */

export type Caducidad = { caduco: true; motivo: string } | { caduco: false };

/** El instante exacto en que una preparada deja de valer. Puro: la bandeja lo muestra. */
export function cuandoCaduca(programadoPara: Date, cfg: ConfigAutoRespuesta): Date {
  const porGracia = new Date(programadoPara.getTime() + cfg.graciaAprobacionMinutos * 60_000);
  // La medianoche local que sigue a la hora reservada. `proximoMomento` con
  // `00:00` da exactamente eso (y si la hora reservada FUERA la medianoche
  // justa, devuelve esa misma, que es lo que corresponde).
  const medianoche = proximoMomento(programadoPara, '00:00', cfg.zona);
  return porGracia.getTime() <= medianoche.getTime() ? porGracia : medianoche;
}

export function caducoSinAprobar(
  programadoPara: Date,
  cfg: ConfigAutoRespuesta,
  ahora: Date,
): Caducidad {
  if (ahora.getTime() < cuandoCaduca(programadoPara, cfg).getTime()) return { caduco: false };

  if (diaLocal(programadoPara, cfg.zona) !== diaLocal(ahora, cfg.zona)) {
    return { caduco: true, motivo: 'es de otro día: nadie la aprobó y un acuse de ayer no se manda hoy' };
  }

  const horas = Math.floor((ahora.getTime() - programadoPara.getTime()) / 3_600_000);
  return {
    caduco: true,
    motivo: `nadie la aprobó en ${horas} h desde su turno: un acuse tan tarde molesta más de lo que ayuda`,
  };
}
