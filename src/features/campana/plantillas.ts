import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';

/**
 * EL CATÁLOGO DE PLANTILLAS Y SU CREACIÓN, del lado del navegador.
 *
 * Nada se valida acá de nuevo: los reparos los da el server (`nombrePlantilla.ts`,
 * puro y con tests) porque son las reglas de Meta y una segunda copia se
 * desincroniza el día que Meta cambie un largo. La pantalla los MUESTRA.
 */

export interface Reparo {
  campo: 'nombre' | 'cuerpo' | 'header' | 'pie' | 'categoria' | 'idioma';
  problema: string;
  arreglo: string;
}

export interface PlantillaConEstado {
  nombre: string;
  idioma: string;
  estado: string;
  categoria: string | null;
  cuerpo: string | null;
  headerDeImagen: boolean;
  enviable: boolean;
  lectura: { titulo: string; detalle: string | null; tono: 'bien' | 'espera' | 'problema'; enviable: boolean };
  calidad: { texto: string; tono: 'bien' | 'espera' | 'problema' };
  id: string | null;
}

export const CATEGORIAS = [
  { valor: 'MARKETING', rotulo: 'Marketing', ayuda: 'Promociones, ofertas, invitaciones. Es lo que usa una campaña.' },
  { valor: 'UTILITY', rotulo: 'Utilidad', ayuda: 'Confirmaciones y avisos sobre algo que la persona ya pidió.' },
  { valor: 'AUTHENTICATION', rotulo: 'Autenticación', ayuda: 'Códigos de verificación. No sirve para vender.' },
] as const;

export function usePlantillas() {
  return useQuery({
    queryKey: ['campana-plantillas'],
    queryFn: () =>
      api<{ plantillas: PlantillaConEstado[]; resumen: { total: number; enviables: number; conProblema: number } }>(
        '/api/campana/plantillas',
      ),
    staleTime: 60_000,
    retry: false,
  });
}

export interface BorradorPlantilla {
  nombre: string;
  idioma: string;
  categoria: string;
  cuerpo: string;
  headerTexto?: string;
  pie?: string;
}

/**
 * REVISA MIENTRAS SE ESCRIBE.
 *
 * El ciclo con Meta es de **24 horas**: enterarse mañana de que había una
 * variable al final del texto es el peor lazo posible para algo que se corrige
 * en dos segundos. Por eso se revisa en vivo, con debounce del lado del
 * componente.
 */
export function useRevisarPlantilla() {
  return useMutation({
    mutationFn: (b: BorradorPlantilla) =>
      api<{ reparos: Reparo[]; nombreSugerido: string }>('/api/campana/plantillas/revisar', {
        method: 'POST',
        body: JSON.stringify(b),
      }),
  });
}

export function useCrearPlantilla() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: BorradorPlantilla & { headerImagenHandle?: string | null }) =>
      api<{ id: string; estado: string; categoria: string | null }>('/api/campana/plantillas', {
        method: 'POST',
        body: JSON.stringify(b),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campana-plantillas'] }),
  });
}

// ── Listas ──────────────────────────────────────────────────────────────────

export interface Lista {
  id: number;
  nombre: string;
  filtros: Record<string, unknown>;
  nota: string | null;
  creadaPor: string;
  creadaEn: string;
}

export function useListas() {
  return useQuery({
    queryKey: ['campana-listas'],
    queryFn: () => api<{ listas: Lista[] }>('/api/campana/listas'),
    staleTime: 60_000,
    retry: false,
  });
}

export function useGuardarLista() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (l: { nombre: string; filtros: Record<string, unknown>; nota?: string }) =>
      api<Lista>('/api/campana/listas', { method: 'POST', body: JSON.stringify(l) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campana-listas'] }),
  });
}

export function useArchivarLista() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api<{ archivada: boolean }>(`/api/campana/listas/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campana-listas'] }),
  });
}

// ── La firma: quién mandó qué ───────────────────────────────────────────────

export interface FilaDeHistorial {
  id: number;
  piezaRef: string;
  autorizadaPor: string;
  autorizadaEn: string;
  totalPrevisto: number;
  estado: string;
  frenadaPor: string | null;
  motivoDelFreno: string | null;
}

export function useHistorial() {
  return useQuery({
    queryKey: ['campana-historial'],
    queryFn: () => api<{ historial: FilaDeHistorial[] }>('/api/campana/historial'),
    staleTime: 60_000,
    retry: false,
  });
}

export interface CorridaViva {
  id: number;
  piezaRef: string;
  numeroPropio: string;
  autorizadaPor: string;
  autorizadaEn: string;
  totalPrevisto: number;
}

/**
 * QUÉ ESTÁ SALIENDO AHORA.
 *
 * Se pregunta seguido (20 s) y **no pide ser supervisor**: es el kill-switch
 * del ADR 0036, y frenar no puede depender de que la persona indicada esté
 * mirando. El freno existe justamente para cuando no lo está.
 */
export function useCorridasVivas() {
  return useQuery({
    queryKey: ['campana-vivas'],
    queryFn: () => api<{ vivas: CorridaViva[] }>('/api/campana/vivas'),
    refetchInterval: 20_000,
    staleTime: 10_000,
    retry: false,
  });
}

export function useFrenar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      api<{ frenada: boolean }>(`/api/campana/corridas/${id}/frenar`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['campana-vivas'] });
      qc.invalidateQueries({ queryKey: ['campana-corridas'] });
    },
  });
}
