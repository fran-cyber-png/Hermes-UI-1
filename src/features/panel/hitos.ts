import type { InteresRegistrado } from '../gestion/lineaDeTiempo';

/**
 * LA HISTORIA DE UNA PERSONA CON GOBERNA, EN UNA SOLA LÍNEA.
 *
 * Hasta ahora las dos mitades vivían separadas y en planos distintos del panel:
 * lo que compró estaba adentro de la pestaña Ficha (o sea, invisible salvo que
 * la vendedora fuera a buscarlo) y lo que le interesa, en un bloque arriba. Son
 * la MISMA pregunta —«¿qué pasó antes con esta persona?»— y separadas obligan a
 * reconstruir el orden de memoria: un interés de marzo arriba, una compra de
 * abril adentro de una pestaña, y la vendedora armando la secuencia en la cabeza
 * mientras escribe.
 *
 * Esto es lógica pura y va acá, fuera del JSX, por lo de siempre: el caso que
 * importa —una compra y un interés el MISMO día, o un dato sin fecha— no se
 * puede interrogar dentro de un componente.
 *
 * ⚠ **EL TIEMPO ACÁ ES HISTORIA, NO URGENCIA: nada de oro.** Es la misma regla
 * que ya sigue `lineaDeTiempo.ts` — el dorado de la marca significa una sola
 * cosa, tiempo que se acaba, y una compra de marzo no es eso.
 */

/** Una venta como la devuelve Cerberus (`cerberus/ficha.ts`). */
export interface VentaDeFicha {
  folio: string;
  estado: string;
  monto: string;
  moneda: string;
  /** Como viene de Cerberus. Puede ser vacío o no parseable — se tolera. */
  fecha: string;
}

export type Hito =
  | {
      tipo: 'compra';
      /** ISO, o `null` si Cerberus no mandó una fecha usable. */
      at: string | null;
      folio: string;
      estado: string;
      monto: string;
      moneda: string;
    }
  | {
      tipo: 'interes';
      /** ISO, o `null` cuando viene del caché plano viejo (ADR 0007). */
      at: string | null;
      curso: string;
    };

/**
 * `DD/MM/YYYY HH:mm` — el formato en el que Cerberus manda `fecha_venta`.
 *
 * ⚠ **`new Date()` no lo puede leer, y falla en SILENCIO**: `"17/07/2026"` lo
 * interpreta como mes 17 y devuelve `Invalid Date`. El síntoma no es un error
 * sino un timeline entero diciendo «sin fecha» — que se lee como «Cerberus no
 * mandó la fecha» cuando en realidad la mandó y nosotros no la supimos leer.
 * Medido contra producción: las 3 compras de un cliente real, las 3 sin fecha.
 *
 * Se tolera acá, del lado del front, y no solo normalizando en el server: el
 * caché de IndexedDB (ADR 0007) ya tiene fichas guardadas con este formato, así
 * que aunque el borde empiece a emitir ISO mañana, lo viejo sigue llegando.
 */
const DD_MM_YYYY = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/;

/**
 * Normaliza a ISO lo que se pueda leer; `null` si no. Se guarda ISO en el hito
 * —y no el crudo— para que el `dateTime` del `<time>` sea válido: un atributo de
 * fecha con `17/07/2026 00:34` adentro no lo entiende ningún lector de pantalla.
 */
export function aIso(valor: string | null): string | null {
  const t = instante(valor);
  return t === null ? null : new Date(t).toISOString();
}

/** El instante de una fecha, o `null` si no se puede leer. Nunca lanza. */
function instante(valor: string | null): number | null {
  if (!valor) return null;

  const m = DD_MM_YYYY.exec(valor.trim());
  if (m) {
    const [, d, mes, a, h = '0', min = '0'] = m;
    // Local, no UTC: la fecha que Cerberus muestra es la de Perú, y correrla a
    // UTC haría que una compra de las 00:34 se leyera del día anterior.
    const t = new Date(Number(a), Number(mes) - 1, Number(d), Number(h), Number(min)).getTime();
    return Number.isNaN(t) ? null : t;
  }

  const t = new Date(valor).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Los hitos de una persona, **del más nuevo al más viejo**.
 *
 * Dos decisiones que no son obvias:
 *
 * · **Lo SIN FECHA va al final, nunca arriba.** Un dato sin fecha ordenado
 *   primero se lee como «lo más reciente», que es afirmar algo que no sabemos.
 *   Al final se lee como lo que es: algo que pasó, sin cuándo.
 * · **Con la misma fecha, la COMPRA va antes que el interés.** Es el hecho más
 *   fuerte de los dos: si ese día compró, eso es lo que la vendedora tiene que
 *   ver primero al abrir el chat.
 */
export function hitosDe(datos: {
  ventas?: readonly VentaDeFicha[];
  intereses?: readonly InteresRegistrado[];
}): Hito[] {
  const hitos: Hito[] = [
    ...(datos.ventas ?? []).map(
      (v): Hito => ({
        tipo: 'compra',
        at: aIso(v.fecha),
        folio: v.folio,
        estado: v.estado,
        monto: v.monto,
        moneda: v.moneda,
      }),
    ),
    ...(datos.intereses ?? []).map(
      (i): Hito => ({ tipo: 'interes', at: aIso(i.creadoAt), curso: i.curso }),
    ),
  ];

  return hitos.sort((a, b) => {
    const ta = instante(a.at);
    const tb = instante(b.at);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1; // sin fecha, al fondo
    if (tb === null) return -1;
    if (ta !== tb) return tb - ta; // más nuevo primero
    // Mismo instante: la compra pesa más que el interés.
    return a.tipo === b.tipo ? 0 : a.tipo === 'compra' ? -1 : 1;
  });
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * «14 mar» · «14 mar 25» si es de otro año · `''` sin fecha.
 *
 * El año se omite dentro del año en curso y se agrega si no: adentro del ciclo
 * de venta el año es ruido, pero **una compra de hace dos años tiene que
 * delatarse** — es la diferencia entre «es cliente» y «fue cliente». Misma regla
 * que `lineaDeTiempo.ts`, para que las dos mitades del panel no fechen distinto.
 */
export function etiquetaDeFecha(iso: string | null, ahora = new Date()): string {
  const t = instante(iso);
  if (t === null) return '';
  const d = new Date(t);
  const base = `${d.getDate()} ${MESES[d.getMonth()]}`;
  return d.getFullYear() === ahora.getFullYear() ? base : `${base} ${String(d.getFullYear()).slice(-2)}`;
}

/**
 * «S/ 1.200» — el monto como se lee, o `''` si no hay con qué.
 *
 * Sin moneda NO se inventa una: un número suelto al lado de una compra se lee
 * como soles, y en la Escuela hay ventas en dólares. Se muestra el número pelado
 * y que la vendedora abra Cerberus si necesita la moneda.
 */
export function etiquetaDeMonto(monto: string, moneda: string): string {
  const limpio = (monto ?? '').trim();
  if (!limpio || Number(limpio) === 0) return '';
  const n = Number(limpio);
  const texto = Number.isFinite(n) ? n.toLocaleString('es-PE', { maximumFractionDigits: 2 }) : limpio;
  const m = (moneda ?? '').trim();
  return m ? `${m} ${texto}` : texto;
}
