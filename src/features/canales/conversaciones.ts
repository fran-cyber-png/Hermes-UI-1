import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import { parametrosDeCola, type EstadoCola } from './cola';
import type { FilaDesglose } from '../vistas/tablero';

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
  /** Derivada: alguna vez salió un mensaje nuestro. Distinto de `respondida`
   *  (que es de quién es el turno HOY): quien volvió a escribir después de que
   *  la atendimos no es una desconocida. */
  ya_le_hablamos?: boolean;
  /** Derivada (`cola/precio.ts`): ya le pasamos el precio o la forma de pagarlo. */
  precio_enviado?: boolean;
  /** Los cursos de interés REGISTRADOS de la conversación — lo que abre la
   *  compuerta de Cotizado. Antes se pedían de a uno por tarjeta. */
  cursos?: string[];
  /** El nombre real del formulario (solo con `?lead=1`). Le gana al pushname. */
  lead_nombre?: string | null;
  /** La etapa del embudo dicha por el SERVER (ADR 0013): max(manual, derivada),
   *  `perdido` terminal. Opcional hasta que el server desplegado la sirva (#88). */
  etapa_efectiva?: string | null;
  /** La última gestión asentada a mano (o null). Informativa; la que manda es la efectiva. */
  etapa_manual?: string | null;
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
  /** Estado PERSONAL de la vendedora sobre la conversación (cola potenciada #49).
   *  Opcionales: solo la cola (`/api/conversaciones`) los trae; radar/agenda no. */
  /** Fijada (pin): sube a la banda de arriba de todo (tope 3). */
  fijada?: boolean;
  /** Favorita: entra al tab «Favoritos». */
  favorita?: boolean;
  /** Sin leer: hay un entrante posterior al cursor de lectura. Distinto de `respondida`. */
  no_leido?: boolean;
  /** Las categorías (etiquetas) asignadas, en minúsculas — para la píldora de color. */
  categorias?: string[];
  /** CANDIDATOS del chip de curso (#72). La precedencia la decide `curso.ts`, no el server. */
  /** El interés más reciente asentado para esta conversación. */
  interes_curso?: string | null;
  /** El curso del formulario que la persona llenó (lead emparejado por teléfono). */
  lead_curso?: string | null;
}

type Pagina = {
  conversaciones: Conversacion[];
  total?: number;
  hayMas: boolean;
  /** El server sirvió la cola SIN estado personal (la tabla no existe todavía). */
  sinEstado?: boolean;
  /** Conteos reales por etapa efectiva sobre la misma ventana (#89). Solo primera página. */
  conteos?: Record<string, number>;
  /** Cuántas filas daría cada filtro secundario dentro del recorte actual. Primera página. */
  conteosFiltro?: { pideInfo: number; sinResponder: number };
  /** La misma foto abierta por «ya le hablamos» × precio × viva. Solo primera página. */
  desglose?: FilaDesglose[];
};

/**
 * La cola unificada. Mismo patrón que `useInteracciones` (infinite query cacheada
 * por filtros), pero contra `/api/conversaciones`: una fila por conversación, no
 * por mensaje. Los ejes (tab, filtro secundario, categoría, etapa) van en
 * `estado` y se traducen a query-params con `parametrosDeCola` (lógica pura,
 * testeada aparte).
 *
 * `etapa` (#89/#90): la carga POR COLUMNA del Pipeline — filtra por etapa
 * efectiva en el server. Solo entra a la queryKey/URL cuando se pide, así las
 * queries de siempre (Mensajes) conservan su clave y su caché persistido.
 */
export function useConversaciones(
  estado: EstadoCola | string = { tab: 'todo', filtroSec: '', categoria: null },
  canal = '',
  etapa = '',
) {
  // Compat: `VistaEmbudo` (otro frente) todavía llama `useConversaciones(intencion, canal, etapa)`
  // por posición, con el string viejo de intención. Un string legado se normaliza
  // a un estado: `''` = todo, y solo `pide-info`/`por-vencer` sobreviven como
  // filtro secundario; `canal`/`etapa` posicionales entran igual al estado.
  const norm: EstadoCola =
    typeof estado === 'string'
      ? {
          tab: 'todo',
          filtroSec: estado === 'pide-info' || estado === 'sin-responder' ? estado : '',
          categoria: null,
          canal: canal || undefined,
          etapa: etapa || undefined,
        }
      : estado;
  const base = parametrosDeCola(norm);

  const q = useInfiniteQuery({
    queryKey: ['conversaciones', base],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ ...base, limit: '30', offset: String(pageParam) });
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
    /** Los conteos del embudo (primera página): el total real de cada columna del tablero. */
    conteos: q.data?.pages[0]?.conteos,
    /** Cuántas daría cada chip de filtro sin salir del recorte actual (#72). */
    conteosFiltro: q.data?.pages[0]?.conteosFiltro,
    /** El desglose (primera página): las bandas de la bandeja y el recorte por precio. */
    desglose: q.data?.pages[0]?.desglose,
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
    /**
     * El server no pudo leer el estado personal (falta el `db:push` de
     * `estado_conversacion`). La cola igual sirve; la UI lo dice en voz alta en
     * vez de fingir que nadie fijó ni marcó nada.
     */
    sinEstado: q.data?.pages[0]?.sinEstado === true,
  };
}

/** Un cambio de estado personal de una conversación (pin / favorita / leído). */
export interface CambioEstadoConversacion {
  clave: string;
  fijada?: boolean;
  favorita?: boolean;
  leido?: boolean;
}

/**
 * Fijar / marcar favorita / marcar leído — la mutación contra
 * `PUT /api/conversaciones/estado`. Es una ESCRITURA (una acción humana): al
 * terminar invalida la cola para que el pin/estrella/punto azul se repinten.
 * Fijar con el tope lleno devuelve 409 (`ErrorApi`), que la UI muestra sin
 * esconder. `marcarLeido` avanza el cursor cross-canal al abrir cualquier hilo.
 */
export function useEstadoConversacion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cambio: CambioEstadoConversacion) =>
      api('/api/conversaciones/estado', { method: 'PUT', body: JSON.stringify(cambio) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversaciones'] });
    },
  });
}
