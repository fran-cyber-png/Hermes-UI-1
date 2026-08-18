import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import type { Conversacion } from '../../dominio/conversaciones';

/**
 * LA AGENDA DE LA VENDEDORA — datos y reglas de agrupado.
 *
 * Un recordatorio es una promesa propia atada a una conversación ("llamarla
 * mañana"). Nunca dispara nada: organiza. El server guarda por vendedora; acá
 * viven la query compartida (la vista y el badge del header la deduplican) y
 * las fechas rápidas de "en dos toques".
 */

export interface Recordatorio {
  id: number;
  clave: string;
  canal: string;
  personaId: string | null;
  personaNombre: string | null;
  numeroPropio: string | null;
  nota: string;
  cuando: string;
  /** `llamada` | `wsp` | `reunion` | `seguimiento` | `recordatorio` | `otro`. */
  tipo?: string | null;
  /** Minutos. `null` = no se dijo (se pinta el bloque estándar). */
  duracionMin?: number | null;
  /** `cancelado` NO es `hecho`: son dos finales distintos. */
  estado: EstadoRecordatorio;
  importancia?: 'alta' | 'media' | 'baja';
}

/** Los tres finales de una promesa. */
export type EstadoRecordatorio = 'pendiente' | 'hecho' | 'cancelado';

export function useAgenda() {
  const qc = useQueryClient();
  const invalidar = () => void qc.invalidateQueries({ queryKey: ['agenda'] });

  const invalidarEmbudo = () => {
    void qc.invalidateQueries({ queryKey: ['gestiones'] });
    void qc.invalidateQueries({ queryKey: ['embudo'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const agenda = useQuery({
    queryKey: ['agenda'],
    queryFn: () => api<{ recordatorios: Recordatorio[] }>('/api/agenda'),
    refetchInterval: 60_000, // "mañana" se vuelve "vencido" aunque nadie toque nada
  });

  const crear = useMutation({
    mutationFn: (r: {
      clave: string;
      canal: string;
      personaId: string | null;
      personaNombre: string | null;
      numeroPropio: string | null;
      nota: string;
      cuando: string;
      tipo?: string;
      duracionMin?: number | null;
      importancia?: 'alta' | 'media' | 'baja' | null;
    }) => api<{ ok: true; recordatorio: Recordatorio }>('/api/agenda', { method: 'POST', body: JSON.stringify(r) }),
    // Agendar puede mover la etapa a 'contactado' (server): el embudo también se refresca.
    onSuccess: () => {
      invalidar();
      invalidarEmbudo();
    },
  });

  const cambiarEstado = useMutation({
    mutationFn: (v: { id: number; estado: EstadoRecordatorio }) =>
      api(`/api/agenda/${v.id}`, { method: 'PATCH', body: JSON.stringify({ estado: v.estado }) }),
    onSuccess: invalidar,
  });

  const borrar = useMutation({
    mutationFn: (id: number) => api(`/api/agenda/${id}`, { method: 'DELETE' }),
    onSuccess: invalidar,
  });

  const actualizarHora = useMutation({
    mutationFn: (v: { id: number; cuando: string }) =>
      api(`/api/agenda/${v.id}`, { method: 'PATCH', body: JSON.stringify({ cuando: v.cuando }) }),
    onSuccess: invalidar,
  });

  const actualizarImportancia = useMutation({
    mutationFn: (v: { id: number; importancia?: 'alta' | 'media' | 'baja' }) =>
      api(`/api/agenda/${v.id}`, { method: 'PATCH', body: JSON.stringify({ importancia: v.importancia }) }),
    onSuccess: invalidar,
  });

  return { agenda, crear, cambiarEstado, borrar, actualizarHora, actualizarImportancia };
}

/** Cuántas promesas están venciendo: vencidas + las de hoy. Para el badge del header. */
export function pendientesQueApuran(rs: Recordatorio[] | undefined): number {
  if (!rs) return 0;
  const finDeHoy = new Date();
  finDeHoy.setHours(23, 59, 59, 999);
  return rs.filter((r) => r.estado === 'pendiente' && new Date(r.cuando) <= finDeHoy).length;
}

// ── Fechas rápidas (dos toques, no un formulario) ──────────────────────────

function a(hora: number, base: Date): Date {
  const d = new Date(base);
  d.setHours(hora, 0, 0, 0);
  return d;
}

/**
 * LOS DÍAS QUE SE OFRECEN AL AGENDAR, en el orden en que se piensan: hoy,
 * mañana, pasado mañana largo, la semana que viene.
 *
 * ⚠️ **El índice 1 es «Mañana» y hay quien lo lee por posición**
 * (`VistaAgenda` lo usa de fecha inicial del formulario). Agregá al final o al
 * medio con cuidado: mover ese elemento cambia con qué abre el modal.
 *
 * @param hora Si se pasa, TODAS las opciones caen a esa hora — es lo que hace
 *   que elegir «10:00» y después «Mañana» sean dos toques y no un formulario.
 *   Sin ella cada opción usa su hora natural (hoy: dentro de dos horas; el
 *   resto: 9:00, que es cuando arranca el día de trabajo).
 */
export function opcionesRapidas(ahora = new Date(), hora?: number): { etiqueta: string; cuando: Date }[] {
  const hoy = hora != null ? a(hora, ahora) : redondearADosHoras(ahora);
  const dentroDe = (dias: number) => {
    const d = new Date(ahora.getTime() + dias * 24 * 3600 * 1000);
    return a(hora ?? 9, d);
  };

  const lunes = new Date(ahora);
  lunes.setDate(lunes.getDate() + ((8 - lunes.getDay()) % 7 || 7));

  return [
    { etiqueta: `Hoy ${hoy.getHours()}:00`, cuando: hoy },
    { etiqueta: `Mañana ${dentroDe(1).getHours()}:00`, cuando: dentroDe(1) },
    { etiqueta: 'En 3 días', cuando: dentroDe(3) },
    { etiqueta: 'Próxima semana', cuando: a(hora ?? 9, lunes) },
  ];
}

/** «Dentro de dos horas», en punto: la opción de hoy que no obliga a pensar. */
function redondearADosHoras(ahora: Date): Date {
  const d = new Date(ahora.getTime() + 2 * 3600 * 1000);
  d.setMinutes(0, 0, 0);
  return d;
}

/**
 * LAS HORAS QUE SE OFRECEN. Son las de la jornada comercial de Goberna, sin la
 * hora del almuerzo: ofrecer 24 casilleros es hacer buscar, y la vendedora
 * agenda casi siempre en una de estas seis.
 */
export const HORAS_RAPIDAS = [10, 11, 12, 15, 16, 17];

/** `Conversacion` mínima para reabrir el chat desde un recordatorio. */
export function conversacionDeRecordatorio(r: Recordatorio): Conversacion {
  return {
    clave: r.clave,
    canal: r.canal as Conversacion['canal'],
    tipo: r.clave.startsWith('int:') ? 'comentario' : 'mensaje',
    persona_id: r.personaId,
    persona_nombre: r.personaNombre,
    numero_propio: r.numeroPropio,
    texto: null,
    contexto_texto: null,
    respondida: false,
    ventana_abierta: false,
    pregunto: false,
    n: 1,
    referencia: r.cuando,
    ultimo_at: r.cuando,
    dias: 0,
    nivel: 5, // neutro: el «resto» de la escala 0–5; la cola recalcula el real al cargar
  };
}
