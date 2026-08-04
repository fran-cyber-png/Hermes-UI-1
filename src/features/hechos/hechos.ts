import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * LOS DATOS RECOMENDADOS del panel — `GET /api/hechos?clave=…`.
 *
 * El server elige cuáles con `momentoDeVenta()`, el MISMO clasificador que
 * decide las dos secuencias sugeridas y el acuse de la auto-respuesta nocturna.
 * Acá no se filtra nada: filtrar de este lado sería la segunda cabeza que
 * después diverge (la lección de #37).
 *
 * Endpoint aparte del de sugerencias **a propósito**: hoy en producción no hay
 * ni una secuencia cargada, y estas frases tienen que estar igual.
 */

export interface HechoRecomendado {
  clave: string;
  rotulo: string;
  texto: string;
  momentos: string[];
  orden: number;
}

export type MomentoDeVenta =
  | 'enfriada'
  | 'cotizada'
  | 'material-sin-precio'
  | 'primer-contacto'
  | 'pidiendo-info'
  | 'en-conversacion';

export interface RespuestaHechos {
  momento: MomentoDeVenta;
  hechos: HechoRecomendado[];
  /** `false` = la tabla no está (falta el `db:push`): se sirve el catálogo medido, sin poder editarlo. */
  editable: boolean;
  origen: 'tabla' | 'defecto' | 'sin-tabla';
}

/**
 * Por qué le estamos ofreciendo ESTAS frases y no otras. En la voz de la
 * vendedora, no en la del clasificador: «cotizada» no le dice nada a nadie.
 */
export const PORQUE_DEL_MOMENTO: Record<MomentoDeVenta, string> = {
  enfriada: 'Ya tiene el precio y dejó de contestar',
  cotizada: 'Ya tiene el precio: falta que decida',
  'material-sin-precio': 'Vio el material y todavía no sabe cuánto cuesta',
  'primer-contacto': 'Es el primer contacto',
  'pidiendo-info': 'Está preguntando ahora',
  'en-conversacion': 'La conversación está abierta',
};

/**
 * Los seis momentos como LISTA, para recorrerlos en la pantalla del catálogo.
 *
 * Se DERIVA del `Record` de arriba en vez de escribirse otra vez: el `Record<
 * MomentoDeVenta, string>` no compila si falta uno, así que agregar un momento
 * al union type obliga a describirlo y la lista se actualiza sola. Una tercera
 * copia a mano en este mismo archivo sería la que se olvida.
 *
 * El orden es el de declaración, que es el mismo de `MOMENTOS_DE_VENTA` en el
 * server — y eso lo fija su test de paridad, que lee este archivo.
 */
export const MOMENTOS = Object.keys(PORQUE_DEL_MOMENTO) as MomentoDeVenta[];

export function useHechos(clave: string | null, activo: boolean) {
  return useQuery({
    queryKey: ['hechos', clave],
    queryFn: ({ signal }) =>
      api<RespuestaHechos>(`/api/hechos?clave=${encodeURIComponent(clave ?? '')}`, {
        // El mismo techo que la ficha y las sugerencias: un bloque en esqueleto
        // eterno no dice nada, y el error sí.
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
      }),
    enabled: activo && Boolean(clave?.startsWith('conv:')),
    staleTime: 60_000,
    retry: false,
  });
}
