import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * EL CONTRATO DE LA PANTALLA DE CAMPAÑAS.
 *
 * ⚠️ **Nada se deriva acá.** Las proporciones, el aviso y el «en curso» vienen
 * calculados del server (`campana/corridas.ts`, puro y con tests). Recalcularlos
 * en el navegador sería la segunda implementación que #37 dejó documentada como
 * la cicatriz más cara del repo: la pantalla afirmaría «todo bien» sobre una
 * plantilla que el server sabe pausada.
 *
 * Lo único que vive de este lado es **presentación**: cómo se escribe un número
 * de minutos y de qué color va cada cosa.
 */

/** Una proporción que no se puede leer sin su denominador. */
export interface Proporcion {
  n: number;
  de: number;
  pct: number;
}

export interface ComoVaLaCorrida {
  pieza: string;
  empezo: string | null;
  termino: string | null;
  enCurso: boolean;
  enviados: number;
  fallidos: number;
  fallosPorMotivo: { motivo: string; n: number }[];
  respondieron: Proporcion;
  /** «Respuestas» que eran el WhatsApp Business de otra empresa. */
  autoRespuestas: number;
  medianaRespuestaMin: number | null;
  enLaPrimeraHora: number;
  sinAtender: Proporcion;
  masViejaSinAtenderMin: number | null;
  porDuena: { duena: string; enviados: number; respondieron: number; sinAtender: number }[];
  /** Lo que hay que mirar YA. `null` = la campaña está sana. */
  aviso: string | null;
}

export interface Esperando {
  telefono: string;
  nombre: string | null;
  duena: string | null;
  contestoEn: string;
  texto: string | null;
  minutosEsperando: number;
}

export function useCorridas(dias = 30) {
  return useQuery({
    queryKey: ['campana-corridas', dias],
    queryFn: () => api<{ corridas: ComoVaLaCorrida[] }>(`/api/campana/corridas?dias=${dias}`),
    /**
     * 30 s, y no más: mientras un lote sale, este número cambia solo. Un
     * `staleTime` largo haría que la pantalla diga «5 sin atender» diez minutos
     * después de que alguien las atendió — y el supervisor entraría a resolver
     * algo ya resuelto.
     */
    staleTime: 30_000,
    refetchInterval: 60_000,
    /** Sólo responde para el supervisor; para el resto es un 403 y no se insiste. */
    retry: false,
  });
}

export function useEsperando(pieza: string | null) {
  return useQuery({
    queryKey: ['campana-esperando', pieza],
    queryFn: () => api<{ esperando: Esperando[] }>(`/api/campana/corridas/${encodeURIComponent(pieza ?? '')}/esperando`),
    enabled: Boolean(pieza),
    staleTime: 30_000,
    retry: false,
  });
}

/** `12 min` · `3 h 20 min` · `2 d 4 h`. Un número de minutos grande no se lee. */
export function enCriollo(minutos: number): string {
  const m = Math.round(minutos);
  if (m < 1) return 'recién';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}

/**
 * DE QUÉ COLOR VA «SIN ATENDER».
 *
 * **Sin oro**: el oro significa tiempo que se acaba, y acá el tiempo ya se
 * pasó — eso es rojo. La escala es por la ESPERA, no por la cantidad: una
 * persona esperando tres horas es peor que diez esperando cinco minutos.
 */
export function tonoDeEspera(minutos: number | null): 'bien' | 'aviso' | 'mal' {
  if (minutos === null) return 'bien';
  if (minutos > 60) return 'mal';
  if (minutos > 15) return 'aviso';
  return 'bien';
}

/**
 * QUÉ TAN LEJOS ESTÁ DE PODER DECIDIRSE.
 *
 * Con menos de 30 respuestas una tasa no distingue nada — es la misma
 * `MUESTRA_MINIMA` del lazo de resultados (ADR 0022). Decirlo evita que alguien
 * declare ganadora una plantilla con 2 de 3.
 */
export const MUESTRA_MINIMA = 30;

export function tasaEsDecidible(p: Proporcion): boolean {
  return p.de >= MUESTRA_MINIMA;
}
