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
  /**
   * ⚠️ **El curso que DECLARÓ, no el que compró.** Lo llena la landing con lo que
   * la persona dijo que le interesaba: de los 19.776 contactos de `landing`,
   * 19.405 tienen curso y solo 1.086 compraron. Los 477 que entran por el webhook
   * de Cerberus tienen venta en el 100 % de los casos y curso en NINGUNO.
   *
   * Por eso una fila puede decir «Sí compró» con el curso vacío: son datos
   * distintos y se dibujan distinto.
   */
  curso: string | null;
  /** QUÉ COMPRÓ — el producto de su última venta. Los 4.783 compradores lo tienen. */
  comprado: string | null;
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

/**
 * Las cinco dimensiones multivalor. El orden es el de la pantalla, y el rótulo
 * vive con ellas: si mañana entra una sexta, se agrega acá y aparece sola.
 */
export const DIMENSIONES = [
  { id: 'pais', rotulo: 'País' },
  { id: 'curso', rotulo: 'Curso' },
  { id: 'etapa', rotulo: 'Etapa' },
  { id: 'nivel', rotulo: 'Nivel' },
  { id: 'fuente', rotulo: 'Fuente' },
] as const;

export type Dimension = (typeof DIMENSIONES)[number]['id'];

/**
 * Los filtros tal como viajan. Todos opcionales: lo ausente no recorta.
 *
 * Las dimensiones son LISTAS: OR adentro de cada una, AND entre ellas. Con un
 * valor por dimensión, «Perú o México» no se podía pedir en una sola pasada y el
 * supervisor perdía el total, que es el número con el que decide.
 */
export interface FiltrosPadron {
  q?: string;
  etapa?: string[];
  nivel?: string[];
  pais?: string[];
  curso?: string[];
  fuente?: string[];
  conVenta?: boolean;
  conTelefono?: boolean;
  sinHabilitar?: boolean;
  orden?: 'recientes' | 'antiguos' | 'mas_gastaron' | 'nombre';
  pagina?: number;
  porPagina?: number;
}

export function comoQuery(f: FiltrosPadron): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    // `false`, `''` y la lista vacía no se mandan: un filtro apagado es un filtro
    // AUSENTE. Mandar `conVenta=false` haría filtrar por lo contrario, y una lista
    // vacía leída como filtro significaría «ninguno» en vez de «cualquiera».
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      p.set(k, v.join(','));
      continue;
    }
    p.set(k, String(v));
  }
  return p.toString();
}

/** Cuántas cosas están recortando ahora — para el contador de «filtros activos». */
export function contarActivos(f: FiltrosPadron): number {
  let n = DIMENSIONES.reduce((s, d) => s + (f[d.id]?.length ?? 0), 0);
  if (f.q?.trim()) n += 1;
  if (f.conVenta) n += 1;
  if (f.conTelefono) n += 1;
  if (f.sinHabilitar) n += 1;
  return n;
}

/** Prende o apaga un valor de una dimensión, sin mutar. */
export function alternar(actuales: string[] | undefined, valor: string): string[] {
  const previos = actuales ?? [];
  return previos.includes(valor) ? previos.filter((v) => v !== valor) : [...previos, valor];
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

/** Un valor elegible, con cuántos contactos tiene en el recorte actual. */
export interface OpcionFaceta {
  valor: string;
  contactos: number;
}

export type Facetas = Record<Dimension, OpcionFaceta[]>;

/**
 * QUÉ SE PUEDE ELEGIR, con su conteo.
 *
 * ⚠️ **La queryKey ignora `pagina` a propósito.** Las facetas no dependen de la
 * página, así que pasar de la 3 a la 4 no tiene por qué disparar cinco `GROUP BY`
 * sobre 72.923 filas: con la página adentro de la clave, react-query las pediría
 * de nuevo en cada paso.
 */
export function useFacetas(filtros: FiltrosPadron, habilitado: boolean) {
  const { pagina: _pagina, porPagina: _porPagina, ...sinPaginar } = filtros;
  return useQuery({
    queryKey: ['padron-facetas', sinPaginar],
    queryFn: () => api<{ facetas: Facetas }>(`/api/padron/facetas?${comoQuery(sinPaginar)}`),
    enabled: habilitado,
    placeholderData: (previa) => previa,
    staleTime: 60_000,
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

/**
 * REPARTIR TODO LO FILTRADO — viaja el recorte, no 17.014 ids.
 *
 * La lista pesaría ~700 KB en cada sentido para algo que el server resuelve con
 * una consulta. Y el recorte es lo que el supervisor quiso decir («todos los
 * peruanos con venta»); una lista de ids es su fotografía, y las dos dejan de
 * coincidir apenas entra un contacto nuevo.
 *
 * ⚠️ Por eso mismo el server puede habilitar un número distinto al que la
 * pantalla mostraba: devuelve **cuántos habilitó de verdad**, y eso es lo que se
 * muestra en el acuse.
 */
export function useHabilitarRecorte() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { filtros: FiltrosPadron; excluidos: number[]; vendedoraId: string }) =>
      api<{ ok: true; habilitados: number; vendedoraId: string }>('/api/padron/habilitar-recorte', {
        method: 'POST',
        body: JSON.stringify({
          vendedoraId: v.vendedoraId,
          excluidos: v.excluidos,
          // Sin paginar: repartir «lo filtrado» no depende de en qué página estaba.
          filtros: { ...v.filtros, pagina: undefined, porPagina: undefined },
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['padron'] });
      void qc.invalidateQueries({ queryKey: ['padron-facetas'] });
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
