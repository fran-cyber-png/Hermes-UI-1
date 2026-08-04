import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * EL PADRÓN, DEL LADO DE LA APP — los 72.923 contactos de icarus que nunca
 * escribieron, y el reparto que decide quién ve cuáles.
 *
 * Contra `/api/padron` (`server/src/routes/padron.ts`).
 *
 * ⚠️ **Quién es supervisor lo dice el SERVER, en la respuesta.** Acá no hay
 * ninguna lista de supervisores ni ningún `if` que decida qué mostrar antes de
 * preguntar: el server sirve el padrón entero o la lista propia, y la pantalla
 * dibuja lo que llegó. Un recorte hecho acá sería cosmético — los datos ya
 * habrían viajado — y esta pantalla es la única de Hermes donde el recorte es
 * una frontera de verdad y no un filtro.
 */

export interface ContactoPadron {
  id: number;
  nombre: string | null;
  telefono: string | null;
  correo: string | null;
  pais: string | null;
  etapa: string | null;
  nivel: string | null;
  gastado: string | null;
  /**
   * Lo que icarus dice que compró. **Miente en más de la mitad de los casos**
   * (10.564 lo tienen en > 0, solo 4.783 tienen venta real), así que NUNCA se
   * dibuja solo: va siempre al lado de `conVenta`, que es lo que se sostiene.
   */
  compras: number | null;
  /** El único «compró» afirmable: hay fila en `icarus.sales`. */
  conVenta: boolean;
  curso: string | null;
  fuente: string | null;
  creadoEn: string | null;
}

export interface PaginaPadron {
  contactos: ContactoPadron[];
  /** El total del RECORTE — el número que se está por repartir, no el del padrón. */
  total: number;
  supervisor: boolean;
  porPagina: number;
  paginaActual: number;
  /** Nadie configurado como supervisor: nadie ve el padrón. Se dice, no se dibuja vacío. */
  sinSupervisores: boolean;
}

/** Los filtros tal como viajan. Todos opcionales: lo ausente no recorta. */
export interface FiltrosPadron {
  q?: string;
  etapa?: string;
  nivel?: string;
  pais?: string;
  curso?: string;
  fuente?: string;
  conVenta?: boolean;
  conTelefono?: boolean;
  sinHabilitar?: boolean;
  orden?: 'recientes' | 'antiguos' | 'mas_gastaron' | 'nombre';
  pagina?: number;
  porPagina?: number;
}

function comoQuery(f: FiltrosPadron): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    // `false` y `''` no se mandan: un filtro apagado es un filtro ausente, y
    // mandarlo como `conVenta=false` haría que el server filtre por lo contrario.
    if (v === undefined || v === null || v === '' || v === false) continue;
    p.set(k, String(v));
  }
  return p.toString();
}

/**
 * La página del padrón.
 *
 * `placeholderData` conserva la página anterior mientras llega la nueva: sin eso,
 * cada tecla del buscador vacía la tabla y la pantalla parpadea entre «no hay
 * nada» y los resultados — que es exactamente la lectura falsa que este frente
 * evita en todos lados.
 */
export function usePadron(filtros: FiltrosPadron) {
  return useQuery({
    queryKey: ['padron', filtros],
    queryFn: () => api<PaginaPadron>(`/api/padron/contactos?${comoQuery(filtros)}`),
    placeholderData: (previa) => previa,
    staleTime: 30_000,
  });
}

export interface CargaVendedora {
  vendedoraId: string;
  contactos: number;
}

interface RespuestaReparto {
  /** A quiénes se les puede habilitar. Lo arma el server: es la MISMA lista con
   * la que valida el POST — con dos, la app ofrecería a alguien que después rechaza. */
  destinos: string[];
  carga: CargaVendedora[];
}

/** Sólo responde para el supervisor; para el resto es un 403 y no se pregunta. */
export function useRepartoPadron(habilitado: boolean) {
  return useQuery({
    queryKey: ['padron-reparto'],
    queryFn: () => api<RespuestaReparto>('/api/padron/reparto'),
    enabled: habilitado,
    staleTime: 60_000,
    retry: false,
  });
}

export function useHabilitar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { contactoIds: number[]; vendedoraId: string }) =>
      api<{ ok: true; habilitados: number; vendedoraId: string }>('/api/padron/habilitar', {
        method: 'POST',
        body: JSON.stringify(v),
      }),
    onSuccess: () => {
      // Las dos cambian: la lista (si se está filtrando por «sin habilitar») y la carga.
      void qc.invalidateQueries({ queryKey: ['padron'] });
      void qc.invalidateQueries({ queryKey: ['padron-reparto'] });
    },
  });
}

export function useQuitarDelReparto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactoIds: number[]) =>
      api<{ ok: true; quitados: number }>('/api/padron/quitar', {
        method: 'POST',
        body: JSON.stringify({ contactoIds }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['padron'] });
      void qc.invalidateQueries({ queryKey: ['padron-reparto'] });
    },
  });
}

/**
 * El nombre corto de una vendedora: `ventas10@grupogoberna.com` → `Ventas10`.
 *
 * Los `vendedora_id` nuevos son el correo completo (verificado en el panel de
 * Cerberus el 4-ago: el usuario se llama así y no tiene email registrado) y los
 * viejos son cortos (`luz`, `alan`). Es la misma regla que `canales/dueno.ts`.
 */
export function nombreCorto(vendedoraId: string): string {
  const base = vendedoraId.split('@')[0] ?? vendedoraId;
  return base.charAt(0).toUpperCase() + base.slice(1);
}
