/**
 * EL DÍA DE LIMA — el negocio corta el día en hora de Lima, no en UTC (#4).
 *
 * El server corre en UTC. Lima es UTC-5 FIJO: no tiene horario de verano, así
 * que el desfase es siempre exactamente 5 horas y la aritmética con
 * milisegundos es segura (nada de saltos de una hora dos veces al año, como
 * pasaría con una zona que sí tiene DST).
 *
 * Esto es la mitad PURA del fix: calcula, en JS, la fecha-calendario de Lima y
 * los cortes de "N días atrás" como instantes UTC exactos. `dashboard/series.ts`
 * (la mitad con IO) los pasa como parámetros bindeados al SQL — así el "hoy" lo
 * decide un solo reloj (`ahora`), nunca `now()` corrido dentro de cada query.
 */

const OFFSET_LIMA_MINUTOS = 5 * 60; // Lima = UTC-5 ⇒ restar 5h a UTC da la hora de pared de Lima.
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** El día-calendario de Lima (YYYY-MM-DD) para un instante dado. */
export function diaLimaISO(instante: Date): string {
  const horaDeParedLima = new Date(instante.getTime() - OFFSET_LIMA_MINUTOS * 60_000);
  return horaDeParedLima.toISOString().slice(0, 10);
}

/** La medianoche de un día de Lima (YYYY-MM-DD), como el instante UTC exacto que es. */
export function medianocheLima(diaISO: string): Date {
  return new Date(`${diaISO}T00:00:00-05:00`);
}

/**
 * El corte de "N días atrás" en el calendario de Lima: la medianoche de Lima
 * de (hoy − N días), como instante UTC exacto — listo para bindear en un
 * `WHERE columna > ${corte}` sin volver a pasar por ninguna conversión de zona.
 */
export function corteDiasAtras(instante: Date, dias: number): Date {
  const medianocheHoy = medianocheLima(diaLimaISO(instante));
  return new Date(medianocheHoy.getTime() - dias * MS_POR_DIA);
}
