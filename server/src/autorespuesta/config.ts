import { z } from 'zod';
import { minutosDeHhmm, type Ventana } from './franja.js';

/**
 * LOS LÍMITES, EN UN SOLO LUGAR — y apagado por defecto.
 *
 * Cada número de acá es parte del contrato con el dueño (ADR 0015): cuánto se
 * espera antes de contestar, en qué franja NO hace falta (porque está la
 * vendedora), a partir de qué hora es razonable que salga un mensaje, cada
 * cuánto y cuántos como mucho. Están juntos para que se lean juntos: si un día
 * alguien quiere «acelerar esto un poco», tiene que venir acá y ver todo el
 * cuadro, no tocar un número perdido en un worker.
 *
 * `AUTO_RESPUESTA` ausente o distinto de `on` ⇒ APAGADA: ni el reloj arranca.
 * Y aun con la variable en `on`, hace falta encender el interruptor de la base
 * (`auto_respuesta_estado`), que arranca en false — dos llaves, y la segunda se
 * apaga sin deploy.
 */

const HHMM = /^\d{2}:\d{2}$/;

const ventana = (texto: string, nombre: string): Ventana => {
  const [desde, hasta] = texto.split('-').map((s) => s.trim());
  if (!HHMM.test(desde ?? '') || !HHMM.test(hasta ?? '')) {
    throw new Error(`${nombre} tiene que ser «HH:MM-HH:MM» (24 h). Recibí: «${texto}»`);
  }
  if (minutosDeHhmm(desde) >= minutosDeHhmm(hasta)) {
    throw new Error(`${nombre}: «${desde}» tiene que ser ANTES que «${hasta}» (la ventana no cruza la medianoche)`);
  }
  return { desde, hasta };
};

const rango = (texto: string, nombre: string): [number, number] => {
  const [min, max] = texto.split('-').map((s) => Number(s.trim()));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
    throw new Error(`${nombre} tiene que ser «min-max» en segundos, con min ≤ max. Recibí: «${texto}»`);
  }
  return [min, max];
};

export interface ConfigAutoRespuesta {
  /** `AUTO_RESPUESTA=on`. La llave de deploy; la de la base es la otra. */
  habilitada: boolean;
  /** La zona con la que se lee TODO reloj de esta feature. */
  zona: string;
  /**
   * El horario de la vendedora. ADENTRO no se responde solo: ella contesta en
   * 10 minutos (mediana medida). La auto-respuesta existe solo para AFUERA.
   */
  franja: Ventana;
  /** Cuánto tiene que llevar esperando el último entrante. */
  esperaMinutos: number;
  /**
   * A qué horas es aceptable que salga un mensaje. Un lead que escribe a las
   * 3 a. m. NO recibe respuesta a las 3:01: eso despierta gente. Lo de la
   * madrugada se acumula y sale a partir de las 7:30.
   */
  ventanaDespacho: Ventana;
  /** Espaciado entre un envío y el siguiente (segundos), sorteado en el rango. */
  espaciadoSegundos: [number, number];
  /** Techo por hora y por día, POR NÚMERO propio. */
  techoPorHora: number;
  techoPorDia: number;
  /**
   * MODO SUPERVISADO: cuánto sigue valiendo una preparada después de la hora que
   * el reparto le reservó. Es el margen para que la vendedora llegue, abra la
   * bandeja y apruebe — no el atraso tolerable de un envío (eso es
   * `MAX_ATRASO_MINUTOS`, y son 90). Ver `caducidad.ts`.
   */
  graciaAprobacionMinutos: number;
  /** Cada cuánto mira el despachador si hay algo que mandar. */
  tickSegundos: number;
  /** Cada cuánto se recalcula la cola (decidir + programar). */
  encoladoMinutos: number;
}

/**
 * Los defaults. Con estos números la capacidad real es acotada a propósito:
 * las dos ventanas de despacho (07:30–09:00 y 20:00–21:00, o sea 150 minutos)
 * a un promedio de 150 s por envío dan ~60 mensajes por día — el mismo techo
 * diario. Lo que no entra, no se manda: a las 9:00 llega la vendedora y
 * responde en 10 minutos, que es mejor que cualquier plantilla.
 */
export const CONFIG_POR_DEFECTO: ConfigAutoRespuesta = {
  habilitada: false,
  zona: 'America/Lima',
  franja: { desde: '09:00', hasta: '20:00' },
  esperaMinutos: 30,
  ventanaDespacho: { desde: '07:30', hasta: '21:00' },
  espaciadoSegundos: [60, 240],
  techoPorHora: 20,
  techoPorDia: 60,
  // Tres horas: lo preparado a las 07:30 sigue esperando cuando la vendedora
  // llega a las 9 y se apaga a las 10:30. A las 3 de la tarde no queda nada.
  graciaAprobacionMinutos: 180,
  tickSegundos: 30,
  encoladoMinutos: 5,
};

const numeroPositivo = (nombre: string) =>
  z.coerce.number().int().positive({ message: `${nombre} tiene que ser un entero positivo` });

/** Lee la config del entorno. Lanza con un mensaje entendible si algo no cierra. */
export function configDesdeEnv(env: NodeJS.ProcessEnv = process.env): ConfigAutoRespuesta {
  const cfg: ConfigAutoRespuesta = {
    ...CONFIG_POR_DEFECTO,
    habilitada: (env.AUTO_RESPUESTA ?? 'off').trim().toLowerCase() === 'on',
    zona: env.AUTO_RESPUESTA_ZONA?.trim() || CONFIG_POR_DEFECTO.zona,
    franja: env.AUTO_RESPUESTA_FRANJA
      ? ventana(env.AUTO_RESPUESTA_FRANJA, 'AUTO_RESPUESTA_FRANJA')
      : CONFIG_POR_DEFECTO.franja,
    ventanaDespacho: env.AUTO_RESPUESTA_VENTANA
      ? ventana(env.AUTO_RESPUESTA_VENTANA, 'AUTO_RESPUESTA_VENTANA')
      : CONFIG_POR_DEFECTO.ventanaDespacho,
    esperaMinutos: env.AUTO_RESPUESTA_ESPERA_MIN
      ? numeroPositivo('AUTO_RESPUESTA_ESPERA_MIN').parse(env.AUTO_RESPUESTA_ESPERA_MIN)
      : CONFIG_POR_DEFECTO.esperaMinutos,
    espaciadoSegundos: env.AUTO_RESPUESTA_ESPACIADO
      ? rango(env.AUTO_RESPUESTA_ESPACIADO, 'AUTO_RESPUESTA_ESPACIADO')
      : CONFIG_POR_DEFECTO.espaciadoSegundos,
    techoPorHora: env.AUTO_RESPUESTA_TECHO_HORA
      ? numeroPositivo('AUTO_RESPUESTA_TECHO_HORA').parse(env.AUTO_RESPUESTA_TECHO_HORA)
      : CONFIG_POR_DEFECTO.techoPorHora,
    techoPorDia: env.AUTO_RESPUESTA_TECHO_DIA
      ? numeroPositivo('AUTO_RESPUESTA_TECHO_DIA').parse(env.AUTO_RESPUESTA_TECHO_DIA)
      : CONFIG_POR_DEFECTO.techoPorDia,
    graciaAprobacionMinutos: env.AUTO_RESPUESTA_GRACIA_MIN
      ? numeroPositivo('AUTO_RESPUESTA_GRACIA_MIN').parse(env.AUTO_RESPUESTA_GRACIA_MIN)
      : CONFIG_POR_DEFECTO.graciaAprobacionMinutos,
  };

  // La zona tiene que existir: un typo («America/Perú») haría que todos los
  // relojes caigan a UTC en silencio, y con eso la franja se corre 5 horas.
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: cfg.zona });
  } catch {
    throw new Error(`AUTO_RESPUESTA_ZONA no es una zona horaria válida: «${cfg.zona}»`);
  }

  return cfg;
}

/**
 * Las VENTANAS EFECTIVAS de despacho: la ventana razonable MENOS el horario de
 * la vendedora. Con los defaults son dos — 07:30–09:00 y 20:00–21:00 — y de
 * ahí sale toda la capacidad del sistema.
 */
export function ventanasEfectivas(cfg: ConfigAutoRespuesta): { desde: number; hasta: number }[] {
  const desde = minutosDeHhmm(cfg.ventanaDespacho.desde);
  const hasta = minutosDeHhmm(cfg.ventanaDespacho.hasta);
  const laboralDesde = minutosDeHhmm(cfg.franja.desde);
  const laboralHasta = minutosDeHhmm(cfg.franja.hasta);

  const trozos = [
    { desde, hasta: Math.min(hasta, laboralDesde) },
    { desde: Math.max(desde, laboralHasta), hasta },
  ];
  return trozos.filter((t) => t.hasta > t.desde);
}
