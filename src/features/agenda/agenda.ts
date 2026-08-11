import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import type { Conversacion } from '../canales/conversaciones';

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
  estado: 'pendiente' | 'hecho';
}

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
    }) => api<{ ok: true; recordatorio: Recordatorio }>('/api/agenda', { method: 'POST', body: JSON.stringify(r) }),
    // Agendar puede mover la etapa a 'contactado' (server): el embudo también se refresca.
    onSuccess: () => {
      invalidar();
      invalidarEmbudo();
    },
  });

  const cambiarEstado = useMutation({
    mutationFn: (v: { id: number; estado: 'pendiente' | 'hecho' }) =>
      api(`/api/agenda/${v.id}`, { method: 'PATCH', body: JSON.stringify({ estado: v.estado }) }),
    onSuccess: invalidar,
  });

  const borrar = useMutation({
    mutationFn: (id: number) => api(`/api/agenda/${id}`, { method: 'DELETE' }),
    onSuccess: invalidar,
  });

  return { agenda, crear, cambiarEstado, borrar };
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

export function opcionesRapidas(ahora = new Date()): { etiqueta: string; cuando: Date }[] {
  const enDosHoras = new Date(ahora.getTime() + 2 * 3600 * 1000);
  enDosHoras.setMinutes(0, 0, 0);

  const manana = a(9, new Date(ahora.getTime() + 24 * 3600 * 1000));

  const lunes = new Date(ahora);
  lunes.setDate(lunes.getDate() + ((8 - lunes.getDay()) % 7 || 7));
  const lunes9 = a(9, lunes);

  return [
    { etiqueta: `Hoy ${enDosHoras.getHours()}:00`, cuando: enDosHoras },
    { etiqueta: 'Mañana 9:00', cuando: manana },
    { etiqueta: 'Lunes 9:00', cuando: lunes9 },
  ];
}

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
