import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * EL PANEL DEL NEGOCIO — la segunda lectura del Dashboard (#128, #126).
 *
 * El server (`server/src/dashboard/negocio.ts`) manda los conteos crudos: qué
 * llegó, qué se respondió, qué está esperando, y qué no se pudo atribuir. Acá
 * viven solo las derivaciones de PRESENTACIÓN — los tres estados disjuntos de la
 * barra, los formatos y los picos que se rotulan. Nada de aritmética de negocio:
 * si la pantalla necesitara recalcular una métrica, el seam estaría incompleto.
 */

export const CLAVES_PERIODO = ['hoy', '7d', '30d', '90d'] as const;
export type ClavePeriodo = (typeof CLAVES_PERIODO)[number];

export type Dimension = 'curso' | 'anuncio';

export interface FilaNegocio {
  /** El curso o el título del anuncio. `null` = no se pudo atribuir. */
  clave: string | null;
  ad_id: string | null;
  llegaron: number;
  respondidos: number;
  nunca_respondidos: number;
  /** La última palabra es de la persona. Incluye a las que jamás recibieron respuesta. */
  esperan: number;
  demora_mediana_min: number | null;
  cotizados: number;
  cerrados: number;
  precio_mencionado: number;
}

export interface PuntoCobertura {
  hora: number;
  entran: number;
  salen: number;
}

export interface Atencion {
  conversaciones: number;
  esperan: number;
  nunca_respondidos: number;
  sin_atender_24h: number;
  demora_mediana_en_horario_min: number | null;
  demora_mediana_fuera_min: number | null;
  llegaron_fuera_de_horario: number;
  cobertura: PuntoCobertura[];
}

export interface DatosNegocio {
  rango: { desde: string; hasta: string };
  periodo: ClavePeriodo | 'libre';
  numeros: string[];
  numero_propio: string | null;
  dimension: Dimension;
  atencion: Atencion;
  filas: FilaNegocio[];
  sin_atribuir: number;
  subregistro: { cotizados: number; precio_mencionado: number };
}

/** El horario de atención, espejo del server (`dashboard/horarioAtencion.ts`). */
export const HORA_APERTURA = 8;
export const HORA_CIERRE = 21;

export function useNegocio(params: {
  periodo: ClavePeriodo;
  numero: string | null;
  dimension: Dimension;
  /** El panel escanea la historia entera: no se pide si nadie lo está mirando. */
  activo: boolean;
}) {
  const qs = new URLSearchParams({ periodo: params.periodo, dimension: params.dimension });
  if (params.numero) qs.set('numero', params.numero);
  return useQuery({
    queryKey: ['dashboard', 'negocio', params.periodo, params.numero, params.dimension],
    queryFn: () => api<DatosNegocio>(`/api/dashboard/negocio?${qs.toString()}`),
    enabled: params.activo,
    // El panel no es la cola: se mira, se piensa y se cambia de período. Sin
    // refetchInterval a propósito — un número que se mueve solo mientras lo leés
    // es ruido, y el escaneo no es gratis.
    staleTime: 60_000,
    // Regla del kit: al refrescar se sostiene el render anterior, no se vuelve a
    // un esqueleto. Sin esto, cambiar de período hace saltar todo el layout.
    placeholderData: (previo) => previo,
  });
}

// ── Derivaciones de presentación ─────────────────────────────────────────────

/**
 * LOS TRES ESTADOS DE LA BARRA, disjuntos y sumando el total.
 *
 * El server manda `esperan` (la última palabra es de la persona) y
 * `nunca_respondidos` (nadie contestó jamás), y el segundo está CONTENIDO en el
 * primero. Una barra part-to-whole necesita partes que no se pisen, así que
 * «esperan» se parte en dos: las que ya habían recibido una respuesta y volvieron
 * a escribir, y las que nunca recibieron ninguna. La severidad crece de
 * izquierda a derecha — al día · esperando · jamás — y ese orden es el que le da
 * sentido al color (azul · oro · rojo).
 *
 * Los `max(0, …)` no son paranoia decorativa: si alguna vez las dos consultas
 * miraran universos distintos, prefiero una barra que cierra a una barra con un
 * segmento negativo que el navegador dibuja al revés sin avisar.
 */
export function bucketsDeFila(f: {
  llegaron: number;
  esperan: number;
  nunca_respondidos: number;
}): { alDia: number; esperanTrasRespuesta: number; jamas: number } {
  const jamas = Math.min(Math.max(f.nunca_respondidos, 0), f.llegaron);
  const esperan = Math.min(Math.max(f.esperan, 0), f.llegaron);
  const esperanTrasRespuesta = Math.max(esperan - jamas, 0);
  return {
    alDia: Math.max(f.llegaron - jamas - esperanTrasRespuesta, 0),
    esperanTrasRespuesta,
    jamas,
  };
}

/**
 * Minutos → algo que se lee de un vistazo. La medición de prod da 10 min en
 * horario y 496 fuera; «496 min» obliga a dividir mentalmente, «8 h 16 min» no.
 */
export function formatearDemora(minutos: number | null): string {
  if (minutos === null || !Number.isFinite(minutos)) return '—';
  if (minutos < 1) return '<1 min';
  const m = Math.round(minutos);
  if (m < 60) return `${m} min`;
  const horas = Math.floor(m / 60);
  if (horas < 24) {
    const resto = m % 60;
    return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
  }
  const dias = Math.floor(horas / 24);
  const restoH = horas % 24;
  return restoH === 0 ? `${dias} d` : `${dias} d ${restoH} h`;
}

/** Porcentaje entero. Sin total no hay porcentaje: 0, nunca un NaN en pantalla. */
export function pct(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 100) : 0;
}

/** Lo que pasa cuando no hay nadie atendiendo — el tamaño del agujero, en números. */
export function fueraDeHorario(
  cobertura: PuntoCobertura[],
  apertura = HORA_APERTURA,
  cierre = HORA_CIERRE,
): { entran: number; salen: number } {
  return cobertura
    .filter((c) => c.hora < apertura || c.hora >= cierre)
    .reduce((acc, c) => ({ entran: acc.entran + c.entran, salen: acc.salen + c.salen }), { entran: 0, salen: 0 });
}

/**
 * La hora más alta de una serie — el ÚNICO punto que lleva rótulo directo. Un
 * número sobre cada una de las 24 horas sería ruido que nadie lee; el pico y el
 * eje alcanzan, y el resto lo da el hover y la tabla.
 */
export function picoDe(cobertura: PuntoCobertura[], serie: 'entran' | 'salen'): { hora: number; valor: number } | null {
  let mejor: { hora: number; valor: number } | null = null;
  for (const c of cobertura) {
    if (c[serie] > 0 && (mejor === null || c[serie] > mejor.valor)) mejor = { hora: c.hora, valor: c[serie] };
  }
  return mejor;
}

/** El rango del período en palabras, para el rótulo bajo el filtro. */
export function rotuloRango(rango: { desde: string; hasta: string }): string {
  const desde = new Date(rango.desde);
  // `hasta` es exclusivo y cae en una medianoche: el último día visible es el anterior.
  const ultimo = new Date(new Date(rango.hasta).getTime() - 1);
  const f = (d: Date) => d.toLocaleDateString('es', { day: 'numeric', month: 'short' });
  return f(desde) === f(ultimo) ? f(desde) : `${f(desde)} — ${f(ultimo)}`;
}
