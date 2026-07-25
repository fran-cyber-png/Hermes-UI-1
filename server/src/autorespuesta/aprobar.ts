import type { ConfigAutoRespuesta } from './config.js';
import { minutosDeHhmm } from './franja.js';
import { enVentana, programar, type Candidato, type Ocupacion, type VentanaMinutos } from './programar.js';

/**
 * APROBAR EN LOTE — un click sobre cuarenta mensajes, cuarenta salidas
 * espaciadas (#125 · ADR 0016).
 *
 * Esta es la función que hace que la bandeja de revisión no sea un botón de
 * ráfaga. La vendedora selecciona todo y aprueba; acá se les vuelve a repartir
 * la hora con el MISMO repartidor del modo automático (`programar.ts`): uno por
 * vez, 60–240 s de aire, techos de 20/h y 60/día por número. Lo que no entra no
 * se aprieta: vuelve con su motivo, para decírselo.
 *
 * ── Por qué se re-reparte en vez de respetar la hora que ya tenían ──
 * La hora que traían la calculó el encolado de la madrugada para una ventana
 * (07:30–09:00) que a la hora de aprobar puede haber pasado. Mandarlas «en su
 * hora» significaría mandarlas TODAS de una, porque todas están vencidas. El
 * ritmo se recalcula desde el momento del OK.
 *
 * ── Por qué la ventana de la aprobación NO es la del modo automático ──
 * La ventana efectiva de la máquina (07:30–09:00 y 20:00–21:00) es la banda de
 * horas creíbles MENOS el horario de la vendedora, y ese recorte existe por una
 * razón puntual: adentro de su turno ella contesta en 10 minutos y una plantilla
 * sería peor que su respuesta. Cuando la que aprueba es ella, esa razón se cae
 * sola — ya miró la conversación y decidió que la plantilla va. Lo que queda en
 * pie es la otra mitad, la que protege a la persona del otro lado: **no se
 * manda nada fuera de la hora creíble** (07:30–21:00). Un lote aprobado a las
 * 10 de la noche no sale; se aprueba mañana temprano.
 */

/** Lo que la bandeja manda a aprobar. Es una preparada, con lo mínimo para repartirla. */
export interface ParaAprobar {
  id: number;
  clave: string;
  telefono: string;
  numeroPropio: string;
  personaNombre: string | null;
  plantillaId: string;
  /** El texto final: la vendedora pudo haberlo editado antes de dar el OK. */
  texto: string;
  /** El mensaje que la disparó. Ordena el lote: el que más esperó, primero. */
  disparadaPor: Date;
}

export interface Aprobada {
  id: number;
  programadoPara: Date;
}

export interface NoEntra {
  id: number;
  motivo: string;
}

export interface Reparto {
  aprobadas: Aprobada[];
  noEntran: NoEntra[];
}

/**
 * LA BANDA DE HORAS CREÍBLES, entera — la ventana de despacho de la config SIN
 * restarle el horario de la vendedora. Es la ventana de la aprobación humana.
 */
export function ventanaDeAprobacion(cfg: ConfigAutoRespuesta): VentanaMinutos[] {
  return [{ desde: minutosDeHhmm(cfg.ventanaDespacho.desde), hasta: minutosDeHhmm(cfg.ventanaDespacho.hasta) }];
}

export function repartirAprobadas(
  items: readonly ParaAprobar[],
  cfg: ConfigAutoRespuesta,
  ahora: Date,
  azar: () => number = Math.random,
  ocupadas: readonly Ocupacion[] = [],
): Reparto {
  const ventanas = ventanaDeAprobacion(cfg);

  // Fuera de la hora creíble no se aprueba nada. Es un no entero y explicado, no
  // un reparto silencioso para mañana a las 7:30: aprobar algo a las 22:00 y que
  // salga diez horas después sería un acuse que ya no acusa nada.
  if (!enVentana(ahora, cfg, ventanas)) {
    const motivo =
      `fuera de la hora de despacho (${cfg.ventanaDespacho.desde}–${cfg.ventanaDespacho.hasta} ${cfg.zona}): ` +
      'a esta hora no se le escribe a nadie. Aprobalas cuando abra la ventana.';
    return { aprobadas: [], noEntran: items.map((i) => ({ id: i.id, motivo })) };
  }

  // EL PUENTE candidato→id VA POR IDENTIDAD DEL OBJETO, no por `clave`. Dos
  // preparadas de la MISMA conversación pueden convivir un instante (la de
  // anoche que el barrido todavía no caducó y la de esta madrugada): con un mapa
  // por clave, la segunda pisaría a la primera y el reparto aprobaría una fila
  // dos veces y dejaría la otra colgada para siempre. `programar` devuelve las
  // MISMAS referencias que recibe, así que la identidad alcanza y es exacta.
  const porCandidato = new Map<Candidato, number>();
  const candidatos: Candidato[] = items.map((i) => {
    const c: Candidato = {
      clave: i.clave,
      telefono: i.telefono,
      numeroPropio: i.numeroPropio,
      personaNombre: i.personaNombre,
      plantillaId: i.plantillaId,
      texto: i.texto,
      desde: i.disparadaPor,
    };
    porCandidato.set(c, i.id);
    return c;
  });

  const plan = programar(candidatos, cfg, ahora, azar, ocupadas, ventanas);

  return {
    aprobadas: plan.ranuras.map((r) => ({ id: porCandidato.get(r.candidato)!, programadoPara: r.programadoPara })),
    noEntran: plan.postergados.map((p) => ({ id: porCandidato.get(p.candidato)!, motivo: p.motivo })),
  };
}
