/**
 * EL RELOJ LOCAL — todo lo que esta feature decide depende de la hora de LIMA,
 * no de la del server.
 *
 * VPS1 corre en UTC. Si la franja laboral se calculara con `getHours()`, «9 de la
 * mañana» serían las 4 a. m. de la vendedora y la auto-respuesta contestaría
 * justo cuando ella está durmiendo — el error exacto que esta feature existe
 * para no cometer. Así que la hora local se saca con `Intl`, con la zona como
 * dato explícito (`America/Lima` por defecto, configurable).
 *
 * Todo acá es PURO: recibe la fecha, devuelve un número o una fecha. Sin `new
 * Date()` implícito, sin IO — para poder testear la medianoche sin esperarla.
 *
 * OJO con el horario de verano: Perú no lo tiene desde 1994, así que el desfase
 * es fijo (-05:00) y `proximoMomento` (que suma minutos) no puede errar. Si un
 * día esto atiende una zona CON DST, ese salto de una hora hay que resolverlo
 * acá — es el único lugar que hace aritmética de reloj.
 */

/** Una ventana de reloj local, en formato 24 h `HH:MM`. `desde` < `hasta`. */
export interface Ventana {
  desde: string;
  hasta: string;
}

/** `HH:MM` → minutos desde la medianoche. Lanza si el formato no es ese. */
export function minutosDeHhmm(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error(`hora inválida: «${hhmm}» (se espera HH:MM, 24 h)`);
  const horas = Number(m[1]);
  const minutos = Number(m[2]);
  if (horas > 23 || minutos > 59) throw new Error(`hora fuera de rango: «${hhmm}»`);
  return horas * 60 + minutos;
}

/** Minutos desde la medianoche LOCAL de esa zona. */
export function minutosLocales(fecha: Date, zona: string): number {
  const partes = partesLocales(fecha, zona);
  return partes.hora * 60 + partes.minuto;
}

/** La hora local (0–23) — el balde con el que se cuenta el techo por hora. */
export function horaLocal(fecha: Date, zona: string): number {
  return partesLocales(fecha, zona).hora;
}

/**
 * El DÍA local en `YYYY-MM-DD`. Es la clave de «una auto-respuesta por
 * conversación por día» y del techo diario: en UTC, el día cambia a las 7 p. m.
 * de Lima y partiría la noche justo en la mitad del problema que atacamos.
 */
export function diaLocal(fecha: Date, zona: string): string {
  const p = partesLocales(fecha, zona);
  return `${p.anio}-${dos(p.mes)}-${dos(p.dia)}`;
}

/** ¿El reloj local está dentro de la ventana [desde, hasta)? */
export function dentroDe(fecha: Date, ventana: Ventana, zona: string): boolean {
  const ahora = minutosLocales(fecha, zona);
  return ahora >= minutosDeHhmm(ventana.desde) && ahora < minutosDeHhmm(ventana.hasta);
}

/**
 * El PRÓXIMO instante en que el reloj local marque `hhmm`: hoy si todavía no
 * pasó, mañana si ya pasó. Si es exactamente esa hora, devuelve `fecha` (no
 * espera 24 h por un empate).
 */
export function proximoMomento(fecha: Date, hhmm: string, zona: string): Date {
  const objetivo = minutosDeHhmm(hhmm);
  const actual = minutosLocales(fecha, zona);
  let delta = objetivo - actual;
  if (delta < 0) delta += 24 * 60;
  // Los segundos y milisegundos del reloj se descartan: el destino es el minuto
  // exacto (7:30:00), no «7:30 más los 42 s que traía la fecha original».
  const p = partesLocales(fecha, zona);
  const alMinuto = fecha.getTime() - (p.segundo * 1000 + fecha.getMilliseconds());
  return new Date(alMinuto + delta * 60_000);
}

interface PartesLocales {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

/**
 * `hourCycle: 'h23'` a propósito: con `hour12: false` algunos ICU devuelven «24»
 * para la medianoche y el cálculo se corre un día entero.
 */
const formateadores = new Map<string, Intl.DateTimeFormat>();

function partesLocales(fecha: Date, zona: string): PartesLocales {
  let fmt = formateadores.get(zona);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formateadores.set(zona, fmt);
  }
  const p: Record<string, string> = {};
  for (const parte of fmt.formatToParts(fecha)) p[parte.type] = parte.value;
  return {
    anio: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second),
  };
}

const dos = (n: number) => String(n).padStart(2, '0');
