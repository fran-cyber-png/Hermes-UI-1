import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import type { Intencion } from './types';

/**
 * Una fila de la cola unificada: o un comentario suelto (FB/IG) o una
 * conversación de mensajes agrupada (WhatsApp/Messenger). El servidor ya la
 * ordena por la urgencia de seis niveles (`server/src/cola/urgencia.ts`);
 * el front no reordena nada.
 */
export interface Conversacion {
  /** Clave estable: `int:<id>` para comentarios, `conv:<canal>:<persona>:<num>` para chats. */
  clave: string;
  canal: 'facebook' | 'instagram' | 'whatsapp';
  tipo: 'comentario' | 'mensaje';
  persona_id: string | null;
  persona_nombre: string | null;
  /** El número propio de Goberna por el que entró (solo mensajes). */
  numero_propio: string | null;
  texto: string | null;
  contexto_texto: string | null;
  /** Clase del último mensaje (imagen/video/audio/documento/sticker): para «📷 Foto» cuando no hay texto.
   *  Opcional: solo la cola (`/api/conversaciones`) la trae; el radar/agenda arman Conversacion sin ella. */
  ultima_clase?: string | null;
  /** Origen del último mensaje (anuncio/landing): para «📣 Vino del anuncio» cuando no hay texto ni media. */
  ultima_origen?: { fuente: string; titulo?: string | null } | null;
  /** Derivada: hay un saliente posterior al último entrante. Nunca estado de fila. */
  respondida: boolean;
  ventana_abierta: boolean;
  pide_info: boolean;
  /** Cuántos mensajes agrupa la conversación (1 en comentarios). */
  n: number;
  referencia: string;
  ultimo_at: string;
  dias: number;
  /** La escala canónica de urgencia: 0 vivo · 1 vencido · 2 expira · 3 espera ·
   *  4 silencio · 5 resto — la misma que el radar del Dashboard. */
  nivel: 0 | 1 | 2 | 3 | 4 | 5;
}

type Pagina = { conversaciones: Conversacion[]; total?: number; hayMas: boolean };

/**
 * La cola unificada. Mismo patrón que `useInteracciones` (infinite query cacheada
 * por filtros), pero contra `/api/conversaciones`: una fila por conversación, no
 * por mensaje.
 */
export function useConversaciones(intencion: Intencion, canal = '') {
  const filtros = { intencion, canal, porTanda: 30 };

  const q = useInfiniteQuery({
    queryKey: ['conversaciones', filtros],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: '30', offset: String(pageParam) });
      if (canal) p.set('canal', canal);
      if (intencion) p.set('intencion', intencion);
      return api<Pagina>(`/api/conversaciones?${p}`);
    },
    getNextPageParam: (ultima, todas) =>
      ultima.hayMas ? todas.reduce((n, p) => n + p.conversaciones.length, 0) : undefined,
    // El tiempo real lo maneja el SSE (invalida al instante). Esto es la red de
    // seguridad: si el stream se cae, la cola igual se refresca al volver a la app
    // y cada 25s. Con SSE vivo, esto casi nunca dispara.
    refetchOnWindowFocus: true,
    refetchInterval: 25_000,
  });

  return {
    items: q.data?.pages.flatMap((p) => p.conversaciones) ?? [],
    total: q.data?.pages[0]?.total ?? 0,
    hayMas: Boolean(q.hasNextPage),
    cargando: q.isPending,
    cargandoMas: q.isFetchingNextPage,
    cargarMas: () => void q.fetchNextPage(),
    /**
     * Cuándo se trajo esto. Al abrir la app la cola se pinta desde el caché
     * persistido, y hasta que llegue lo fresco hay que decir de cuándo es
     * (ver `lib/datos/persistencia.ts`).
     */
    traidoEn: q.dataUpdatedAt,
    actualizando: q.isFetching,
  };
}
