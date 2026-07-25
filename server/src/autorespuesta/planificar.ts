import type { ConfigAutoRespuesta } from './config.js';
import { decidir, type ConversacionCandidata, type MotivoNoElegible } from './decidir.js';
import { programar, type Candidato, type Ocupacion, type Plan } from './programar.js';

/**
 * EL PLAN COMPLETO — decidir + repartir, en una sola función pura.
 *
 * Es lo que corre el encolado de verdad Y lo que imprime el simulacro. Que sean
 * la MISMA función es el punto: si el simulacro usara su propio camino, lo que
 * se revisa antes de prender no sería lo que después pasa. Acá no hay dos
 * versiones de la verdad.
 */

export interface Descartada {
  candidata: ConversacionCandidata;
  motivo: MotivoNoElegible;
  detalle: string;
}

export interface PlanCompleto extends Plan {
  /** Las que ni siquiera califican, con el porqué — la mitad más útil del simulacro. */
  descartadas: Descartada[];
}

export function planificar(
  candidatas: readonly ConversacionCandidata[],
  cfg: ConfigAutoRespuesta,
  ahora: Date,
  azar: () => number = Math.random,
  ocupadas: readonly Ocupacion[] = [],
): PlanCompleto {
  const elegibles: Candidato[] = [];
  const descartadas: Descartada[] = [];

  for (const candidata of candidatas) {
    const d = decidir(candidata, cfg, ahora);
    if (!d.elegible) {
      descartadas.push({ candidata, motivo: d.motivo, detalle: d.detalle });
      continue;
    }
    elegibles.push({
      clave: candidata.clave,
      telefono: candidata.telefono,
      numeroPropio: candidata.numeroPropio,
      personaNombre: candidata.personaNombre,
      plantillaId: d.plantillaId,
      texto: d.texto,
      campana: d.campana?.nombre ?? null,
      desde: candidata.ultimoEntranteEn,
    });
  }

  const plan = programar(elegibles, cfg, ahora, azar, ocupadas);
  return { ...plan, descartadas };
}
