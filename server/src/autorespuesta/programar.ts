import { ventanasEfectivas, type ConfigAutoRespuesta } from './config.js';
import { diaLocal, horaLocal, minutosLocales, proximoMomento } from './franja.js';

/**
 * EL RITMO — el corazón de esta feature, y la parte que la hace defendible.
 *
 * Decidir a quién responder es la mitad fácil. La otra mitad es CUÁNDO, y tiene
 * tres razones de ingeniería, ninguna de ellas cosmética:
 *
 *   1. **No atropellar al cliente.** Un lead que escribió a las 3 a. m. no
 *      quiere que le suene el teléfono a las 3:01. Lo de la madrugada se
 *      ACUMULA y sale a partir de una hora decente (7:30 por defecto),
 *      repartido a lo largo de la mañana.
 *   2. **No saturar el canal.** Un envío a la vez, con aire entre uno y otro
 *      (60–240 s por defecto). Vaciar la cola de golpe es la forma más rápida
 *      de que 40 personas reciban a la vez un mensaje que nadie puede atender
 *      después: la vendedora entra a las 9 con 40 conversaciones abiertas.
 *   3. **Mantener el volumen en algo razonable.** Techo por hora y por día, por
 *      número. Lo que no entra, NO se manda: a las 9 llega la vendedora y
 *      responde en 10 minutos (mediana medida), que es mejor que la plantilla.
 *
 * Todo esto es PURO: entra la lista de candidatos, el reloj y una fuente de
 * azar inyectada; sale un plan con hora para cada uno y el motivo de los que
 * quedaron afuera. Por eso el simulacro puede imprimir exactamente lo que va a
 * pasar sin tocar la base ni el transporte.
 *
 * Lo que NO se planifica hoy se reevalúa en la próxima corrida del encolado
 * (cada 5 min): no hay backlog que se pierda, hay una ventana que se respeta.
 */

export interface Candidato {
  clave: string;
  telefono: string;
  numeroPropio: string;
  personaNombre: string | null;
  plantillaId: string;
  texto: string;
  /** Cómo se nombra la campaña de la que vino. Es por lo que agrupa la bandeja. */
  campana?: string | null;
  /** El mensaje que la disparó: ordena la cola (el que más esperó, primero). */
  desde: Date;
}

export interface Ranura {
  candidato: Candidato;
  programadoPara: Date;
}

export interface Postergado {
  candidato: Candidato;
  motivo: string;
}

export interface Plan {
  ranuras: Ranura[];
  postergados: Postergado[];
}

/** Lo que YA ocupa lugar hoy: pendientes de una corrida anterior y enviadas. */
export interface Ocupacion {
  numeroPropio: string;
  cuando: Date;
}

/**
 * Una ventana de despacho en minutos desde la medianoche local. Se puede pasar
 * a mano (`programar(..., ventanas)`) en vez de derivarla de la config: es lo
 * que hace la aprobación en lote del modo supervisado, que reparte con ESTE
 * mismo repartidor pero sobre la banda horaria entera —07:30–21:00— en vez de
 * los huecos que le quedan a la máquina. La razón está en `aprobar.ts`.
 */
export type VentanaMinutos = { desde: number; hasta: number };

/** Cuántas vueltas puede dar la búsqueda de hueco antes de rendirse. */
const MAX_SALTOS = 48;

export function programar(
  candidatos: readonly Candidato[],
  cfg: ConfigAutoRespuesta,
  ahora: Date,
  azar: () => number = Math.random,
  ocupadas: readonly Ocupacion[] = [],
  ventanas: readonly VentanaMinutos[] = ventanasEfectivas(cfg),
): Plan {
  const ranuras: Ranura[] = [];
  const postergados: Postergado[] = [];

  if (ventanas.length === 0) {
    return {
      ranuras: [],
      postergados: candidatos.map((c) => ({ candidato: c, motivo: 'no hay ninguna ventana de despacho configurada' })),
    };
  }

  // Los baldes de los techos: por día local y por (día, hora) local, por número.
  const porDia = new Map<string, number>();
  const porHora = new Map<string, number>();
  const claveDia = (numero: string, t: Date) => `${numero}|${diaLocal(t, cfg.zona)}`;
  const claveHora = (numero: string, t: Date) => `${claveDia(numero, t)}|${horaLocal(t, cfg.zona)}`;
  const sumar = (mapa: Map<string, number>, k: string) => mapa.set(k, (mapa.get(k) ?? 0) + 1);
  for (const o of ocupadas) {
    sumar(porDia, claveDia(o.numeroPropio, o.cuando));
    sumar(porHora, claveHora(o.numeroPropio, o.cuando));
  }

  // El cursor arranca en la ventana en la que estamos, o en la próxima que
  // abra. Es POR NÚMERO: cada número propio es un canal distinto.
  const arranque = inicioDeDespacho(ahora, cfg, ventanas);
  const cursores = new Map<string, Date>();
  // El final de la ventana en la que se está trabajando: más allá de eso no se
  // programa (se reevalúa en la próxima corrida, ya con datos frescos).
  const limite = finDeVentana(arranque, cfg, ventanas);

  // El que más esperó, primero. `clave` desempata para que dos corridas con los
  // mismos datos den el mismo plan.
  const enOrden = [...candidatos].sort(
    (a, b) => a.desde.getTime() - b.desde.getTime() || a.clave.localeCompare(b.clave),
  );

  for (const candidato of enOrden) {
    const numero = candidato.numeroPropio;
    let cursor = cursores.get(numero) ?? arranque;

    const hueco = buscarHueco(cursor, {
      cfg,
      ventanas,
      limite,
      numero,
      porDia,
      porHora,
      claveDia,
      claveHora,
    });

    if (!hueco.ok) {
      postergados.push({ candidato, motivo: hueco.motivo });
      continue;
    }

    ranuras.push({ candidato, programadoPara: hueco.momento });
    sumar(porDia, claveDia(numero, hueco.momento));
    sumar(porHora, claveHora(numero, hueco.momento));

    // EL ESPACIADO: el siguiente envío de este número no sale antes de esto.
    const [min, max] = cfg.espaciadoSegundos;
    const espera = Math.round(min + azar() * (max - min));
    cursor = new Date(hueco.momento.getTime() + espera * 1000);
    cursores.set(numero, cursor);
  }

  return { ranuras, postergados };
}

interface ContextoHueco {
  cfg: ConfigAutoRespuesta;
  ventanas: readonly VentanaMinutos[];
  limite: Date;
  numero: string;
  porDia: Map<string, number>;
  porHora: Map<string, number>;
  claveDia: (numero: string, t: Date) => string;
  claveHora: (numero: string, t: Date) => string;
}

type ResultadoHueco = { ok: true; momento: Date } | { ok: false; motivo: string };

/**
 * El primer momento ≥ `desde` que cae en una ventana de despacho y no revienta
 * ningún techo. Salta de hora en hora (techo por hora) o de ventana en ventana
 * (fuera de horario de despacho), y se rinde en el límite.
 */
function buscarHueco(desde: Date, ctx: ContextoHueco): ResultadoHueco {
  const { cfg } = ctx;
  let t = desde;

  for (let saltos = 0; saltos < MAX_SALTOS; saltos++) {
    if (t.getTime() > ctx.limite.getTime()) {
      return { ok: false, motivo: 'no entra en la ventana de despacho: a esa hora ya responde la vendedora' };
    }

    if (!enVentana(t, cfg, ctx.ventanas)) {
      t = inicioDeDespacho(t, cfg, ctx.ventanas);
      continue;
    }

    if ((ctx.porDia.get(ctx.claveDia(ctx.numero, t)) ?? 0) >= cfg.techoPorDia) {
      return { ok: false, motivo: `techo diario del número (${cfg.techoPorDia} auto-respuestas)` };
    }

    if ((ctx.porHora.get(ctx.claveHora(ctx.numero, t)) ?? 0) >= cfg.techoPorHora) {
      t = proximaHora(t, cfg.zona);
      continue;
    }

    return { ok: true, momento: t };
  }

  return { ok: false, motivo: 'no se encontró hueco dentro de los límites configurados' };
}

/** ¿Este instante cae en alguna ventana efectiva de despacho? */
export function enVentana(
  t: Date,
  cfg: ConfigAutoRespuesta,
  ventanas: readonly VentanaMinutos[] = ventanasEfectivas(cfg),
): boolean {
  const m = minutosLocales(t, cfg.zona);
  return ventanas.some((v) => m >= v.desde && m < v.hasta);
}

/** Si ya estamos en una ventana, ahora; si no, el próximo momento en que abra. */
export function inicioDeDespacho(
  t: Date,
  cfg: ConfigAutoRespuesta,
  ventanas: readonly VentanaMinutos[] = ventanasEfectivas(cfg),
): Date {
  if (enVentana(t, cfg, ventanas)) return t;
  const proximos = ventanas.map((v) => proximoMomento(t, hhmm(v.desde), cfg.zona));
  return proximos.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

/** El cierre de la ventana en la que cae `t` (o de la próxima, si está afuera). */
export function finDeVentana(
  t: Date,
  cfg: ConfigAutoRespuesta,
  ventanas: readonly VentanaMinutos[] = ventanasEfectivas(cfg),
): Date {
  const dentro = inicioDeDespacho(t, cfg, ventanas);
  const m = minutosLocales(dentro, cfg.zona);
  const ventana = ventanas.find((v) => m >= v.desde && m < v.hasta);
  // `inicioDeDespacho` siempre cae dentro de una ventana; el fallback es por si
  // alguien configura algo degenerado (ventana de ancho cero, ya filtrada).
  if (!ventana) return dentro;
  return proximoMomento(dentro, hhmm(ventana.hasta), cfg.zona);
}

/** El comienzo de la próxima hora local (para saltar un techo por hora). */
function proximaHora(t: Date, zona: string): Date {
  const siguiente = (horaLocal(t, zona) + 1) % 24;
  return proximoMomento(t, `${String(siguiente).padStart(2, '0')}:00`, zona);
}

/** Minutos desde la medianoche → `HH:MM`. */
function hhmm(minutos: number): string {
  const h = Math.floor(minutos / 60) % 24;
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
