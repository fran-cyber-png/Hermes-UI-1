import { diaLimaISO, medianocheLima } from "../lib/horaLima.js";

/**
 * EL PERÍODO DEL PANEL DE NEGOCIO — «día / semana / mes» del pedido del dueño
 * (#128), dicho de forma que no pueda mentir.
 *
 * DOS DECISIONES, las dos por honestidad:
 *
 * 1. **Todo corta a la MEDIANOCHE DE LIMA**, nunca en UTC ni en «hace N × 24 h».
 *    Es el mismo corte que ya usan las series y el por-vendedora (#4,
 *    `lib/horaLima.ts`): el negocio vive en Lima y el server corre en UTC, así
 *    que un rango anclado al reloj del proceso le movería el día a la mitad de
 *    las métricas. Con esto, «hoy» a las 9 am y «hoy» a las 9 pm son el mismo
 *    rango — un panel que cambia de números porque se miró más tarde no sirve
 *    para decidir.
 *
 * 2. **Las claves se llaman como lo que miden**: `7d`, `30d`, `90d`, no «semana»
 *    ni «mes». Son ventanas móviles de N días de calendario terminando hoy; un
 *    botón que dijera «Mes» y mostrara los últimos 30 días estaría mintiendo la
 *    mitad del mes. La pantalla además imprime el rango literal debajo del
 *    filtro, así nadie tiene que adivinar qué se está sumando.
 *
 * `hasta` es SIEMPRE exclusivo (`occurred_at < hasta`) y cae en una medianoche:
 * así dos períodos contiguos no comparten ni pierden un solo mensaje.
 */

export const CLAVES_PERIODO = ["hoy", "7d", "30d", "90d"] as const;
export type ClavePeriodo = (typeof CLAVES_PERIODO)[number];

/** Cuántos días de calendario abarca cada preset, contando hoy. */
const DIAS_POR_CLAVE: Record<ClavePeriodo, number> = { hoy: 1, "7d": 7, "30d": 30, "90d": 90 };

/** La ventana, como instantes UTC exactos. `desde` inclusivo, `hasta` exclusivo. */
export interface Rango {
  desde: Date;
  hasta: Date;
}

const MS_POR_DIA = 86_400_000;
/** Un día-calendario ISO y nada más: `2026-07-25`. */
const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export function rangoDePeriodo(ahora: Date, clave: ClavePeriodo): Rango {
  const inicioDeHoy = medianocheLima(diaLimaISO(ahora));
  const hasta = new Date(inicioDeHoy.getTime() + MS_POR_DIA); // mañana a las 00:00 de Lima
  return { desde: new Date(hasta.getTime() - DIAS_POR_CLAVE[clave] * MS_POR_DIA), hasta };
}

/**
 * El rango libre, en días-calendario de Lima. `hastaISO` es el último día que la
 * persona quiere ver, así que entra ENTERO: el `hasta` que devuelve es la
 * medianoche del día siguiente. Devuelve `null` —no una excepción, no un
 * default silencioso— ante cualquier cosa que no sea un rango usable: la ruta lo
 * traduce a un 400 y la pantalla nunca muestra un período que no pidió nadie.
 */
export function rangoLibre(desdeISO: string, hastaISO: string): Rango | null {
  if (!DIA_ISO.test(desdeISO) || !DIA_ISO.test(hastaISO)) return null;
  const desde = medianocheLima(desdeISO);
  const finDelUltimoDia = medianocheLima(hastaISO);
  if (Number.isNaN(desde.getTime()) || Number.isNaN(finDelUltimoDia.getTime())) return null;
  // `medianocheLima` acepta cualquier string que `Date` parsee: `2026-13-01`
  // vuelve como enero del 27. El ida y vuelta lo delata sin tabla de meses.
  if (diaLimaISO(desde) !== desdeISO || diaLimaISO(finDelUltimoDia) !== hastaISO) return null;
  const hasta = new Date(finDelUltimoDia.getTime() + MS_POR_DIA);
  if (hasta <= desde) return null;
  return { desde, hasta };
}

export type RangoResuelto = Rango & { clave: ClavePeriodo | "libre" };

const esClave = (v: unknown): v is ClavePeriodo =>
  typeof v === "string" && (CLAVES_PERIODO as readonly string[]).includes(v);

/**
 * Lo que la ruta consume: query params (todos opcionales, todos strings) → un
 * rango. El rango libre gana sobre el preset cuando es usable; si no lo es se
 * cae al preset, y sin preset válido a `7d` (el default de la pantalla: un día
 * solo es demasiado poco para leer una campaña, un trimestre demasiado para
 * mirar todos los días).
 */
export function resolverRango(
  ahora: Date,
  q: { periodo?: string; desde?: string; hasta?: string },
): RangoResuelto {
  if (q.desde && q.hasta) {
    const libre = rangoLibre(q.desde, q.hasta);
    if (libre) return { ...libre, clave: "libre" };
  }
  const clave: ClavePeriodo = esClave(q.periodo) ? q.periodo : "7d";
  return { ...rangoDePeriodo(ahora, clave), clave };
}
