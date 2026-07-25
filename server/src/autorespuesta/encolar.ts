import type { db } from '../db/client.js';
import { consultarCandidatos } from './candidatos.js';
import type { ConfigAutoRespuesta } from './config.js';
import { diaLocal, dentroDe } from './franja.js';
import { estadoAlEncolar, type ModoAutoRespuesta } from './modo.js';
import { planificar, type PlanCompleto } from './planificar.js';
import { faltaEsquema, type RepositorioAutoRespuesta } from './repositorio.js';

/**
 * EL ENCOLADO — la corrida que mira quién quedó esperando y le reserva una hora.
 *
 * No manda nada: solo escribe filas en `auto_respuestas_pendientes`. El envío es
 * del despachador, y entre una cosa y la otra pasan minutos en los que la
 * vendedora todavía puede responder y cancelar la pendiente.
 *
 * Corre seguido (cada 5 min por defecto) y es idempotente por construcción: el
 * UNIQUE `(clave, dia_lima)` hace que volver a correr no duplique nada, así que
 * lo que no entró en una ventana se reevalúa en la corrida siguiente sin
 * acumular un backlog que después salga de golpe.
 */

export interface DepsEncolado {
  base: typeof db;
  repo: RepositorioAutoRespuesta;
  cfg: ConfigAutoRespuesta;
  ahora?: () => Date;
  azar?: () => number;
  registrar?: (linea: string) => void;
}

export interface ResumenEncolado {
  corrio: boolean;
  /** Por qué no corrió, cuando no corrió. */
  motivo?: string;
  /** En qué modo corrió: es lo que decide si lo escrito sale solo o espera el OK. */
  modo?: ModoAutoRespuesta;
  candidatas: number;
  encoladas: number;
  /** Las que ya tenían la suya hoy: el UNIQUE las rebotó. */
  duplicadas: number;
  postergadas: number;
  descartadas: number;
  plan: PlanCompleto | null;
}

const NADA: Omit<ResumenEncolado, 'corrio' | 'motivo'> = {
  candidatas: 0,
  encoladas: 0,
  duplicadas: 0,
  postergadas: 0,
  descartadas: 0,
  plan: null,
};

export async function correrEncolado(deps: DepsEncolado): Promise<ResumenEncolado> {
  const { base, repo, cfg } = deps;
  const ahora = (deps.ahora ?? (() => new Date()))();
  const registrar = deps.registrar ?? ((l: string) => console.log(l));

  if (!cfg.habilitada) return { corrio: false, motivo: 'AUTO_RESPUESTA no está en `on`', ...NADA };

  // Sin las tablas (el `db:push` es manual, ADR 0015) esto es «apagada», no un
  // error repetido cada cinco minutos.
  let interruptor;
  try {
    interruptor = await repo.leerInterruptor();
  } catch (e) {
    if (!faltaEsquema(e)) throw e;
    return { corrio: false, motivo: 'faltan las tablas: corré `npm run db:push` (ADR 0015)', ...NADA };
  }
  // EL MODO decide UNA sola cosa acá: en qué estado nace lo que se escribe.
  // Todo lo demás —a quién, con qué plantilla, a qué hora— es idéntico en
  // supervisada y en automática, y tiene que seguir siéndolo: lo que la
  // vendedora aprueba es exactamente lo que la automática habría mandado.
  const estado = estadoAlEncolar(interruptor.modo);
  if (!estado) {
    return { corrio: false, motivo: interruptor.motivo ?? 'el interruptor está apagado', ...NADA };
  }

  // Dentro del horario no se encola NADA: responde la vendedora. (El
  // despachador además cancela lo que hubiera quedado.)
  if (dentroDe(ahora, cfg.franja, cfg.zona)) {
    return { corrio: false, motivo: 'horario de atención: responde la vendedora', ...NADA };
  }

  const dia = diaLocal(ahora, cfg.zona);
  const candidatas = await consultarCandidatos(base, dia);
  const ocupadas = await repo.ocupacionDesde(dia);
  const plan = planificar(candidatas, cfg, ahora, deps.azar, ocupadas);

  let encoladas = 0;
  let duplicadas = 0;
  for (const ranura of plan.ranuras) {
    const fila = await repo.encolar({
      clave: ranura.candidato.clave,
      canal: 'whatsapp',
      telefono: ranura.candidato.telefono,
      numeroPropio: ranura.candidato.numeroPropio,
      personaNombre: ranura.candidato.personaNombre,
      plantillaId: ranura.candidato.plantillaId,
      texto: ranura.candidato.texto,
      campana: ranura.candidato.campana,
      estado,
      disparadaPor: ranura.candidato.desde,
      programadoPara: ranura.programadoPara,
      // EL DÍA ES EL DEL ENVÍO, no el de la corrida. A las 21:30 ya no queda
      // ventana hoy y el reparto cae mañana a las 7:30: si la fila se guardara
      // con el día de hoy, al pasar la medianoche la conversación volvería a
      // parecer «sin auto-respuesta hoy» y esa persona recibiría DOS.
      diaLima: diaLocal(ranura.programadoPara, cfg.zona),
    });
    if (fila) encoladas++;
    else duplicadas++;
  }

  if (encoladas > 0 || plan.postergados.length > 0) {
    registrar(
      `[auto-respuesta] encolado ${dia} (${interruptor.modo}): ${candidatas.length} candidatas · ` +
        `${encoladas} ${estado === 'preparada' ? 'esperando aprobación' : 'programadas'} · ` +
        `${duplicadas} ya tenían la suya · ${plan.postergados.length} postergadas · ${plan.descartadas.length} descartadas`,
    );
  }

  return {
    corrio: true,
    modo: interruptor.modo,
    candidatas: candidatas.length,
    encoladas,
    duplicadas,
    postergadas: plan.postergados.length,
    descartadas: plan.descartadas.length,
    plan,
  };
}
