import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { API_URL } from '../../config';

/** Un adjunto del hilo: el archivo ya vive en el server, esto es la referencia. */
export interface MediaHilo {
  clase: 'imagen' | 'video' | 'audio' | 'documento' | 'sticker';
  archivo: string;
  mime: string | null;
  nombre?: string | null;
}

/** Un mensaje del hilo, tal como lo devuelve el backend. */
export interface MensajeHilo {
  id: number;
  direccion: 'entrante' | 'saliente';
  autor: string;
  texto: string | null;
  occurred_at: string;
  external_id: string;
  media?: MediaHilo | null;
}

/** La URL para ver/bajar un adjunto del hilo. */
export function urlMedia(archivo: string): string {
  return `${API_URL}/api/whatsapp/media/${encodeURIComponent(archivo)}`;
}

/** El estado de la sesión de WhatsApp (para el banner). Espeja `EstadoSesion` del server. */
export type EstadoSesionWa =
  | { estado: 'sin-vincular'; qr: string | null; codigo: string | null }
  | { estado: 'conectando' }
  | { estado: 'conectado'; telefono: string }
  | { estado: 'desconectado'; motivo: string }
  | { estado: 'cerrada'; motivo: string }
  | { estado: 'baneado'; codigo: string; expira: string };

export function useSesionWa() {
  return useQuery({
    queryKey: ['wa', 'sesion'],
    queryFn: () => api<EstadoSesionWa>('/api/whatsapp/sesion'),
    refetchInterval: 10_000, // el estado cambia solo (caídas, ban): se revisa seguido
  });
}

/** De dónde vino el lead, enriquecido con Meta si vino de un anuncio. */
export type OrigenLead =
  | { fuente: 'anuncio'; adId?: string; titulo?: string; anuncio?: string; campana?: string }
  | { fuente: 'landing'; ref: string }
  | null;

export function useConversacionWa(telefono: string | null) {
  const qc = useQueryClient();

  const hilo = useQuery({
    queryKey: ['wa', 'conversacion', telefono],
    queryFn: () =>
      api<{ telefono: string; mensajes: MensajeHilo[]; origen: OrigenLead }>(`/api/whatsapp/conversacion/${telefono}`),
    enabled: Boolean(telefono),
    refetchInterval: telefono ? 5_000 : false, // mientras está abierta, se refresca sola
  });

  // Marcar leído al abrir (ticks azules — decisión de Estephano). Sin bloquear la vista.
  const marcarLeido = useMutation({
    mutationFn: (tel: string) => api(`/api/whatsapp/leido/${tel}`, { method: 'POST', body: '{}' }),
  });

  const enviar = useMutation({
    mutationFn: (vars: { numeroPropio: string; telefono: string; texto: string; referencia: string }) =>
      api<{ ok: true; idExterno: string }>('/api/whatsapp/enviar', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    // Al enviar, el hilo y la cola quedan viejos: se revalidan.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wa', 'conversacion', telefono] });
      void qc.invalidateQueries({ queryKey: ['conversaciones'] });
    },
  });

  // Adjuntos: el archivo viaja crudo (no JSON), por eso no pasa por `api()` —
  // pero lleva el mismo Bearer y los mismos estados que cualquier envío.
  const enviarMedia = useMutation({
    mutationFn: async (vars: {
      numeroPropio: string;
      telefono: string;
      referencia: string;
      archivo: File;
      caption: string;
    }) => {
      const token = localStorage.getItem('hermes.token');
      const q = new URLSearchParams({
        telefono: vars.telefono,
        numeroPropio: vars.numeroPropio,
        referencia: vars.referencia,
        nombre: vars.archivo.name,
        ...(vars.caption.trim() ? { caption: vars.caption.trim() } : {}),
      });
      const res = await fetch(`${API_URL}/api/whatsapp/enviar-media?${q}`, {
        method: 'POST',
        headers: {
          'content-type': vars.archivo.type || 'application/octet-stream',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: vars.archivo,
      });
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => ({}));
        throw new ErrorApi(cuerpo.message ?? `Error ${res.status}`, res.status);
      }
      return res.json() as Promise<{ ok: true; idExterno: string }>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['wa', 'conversacion', telefono] });
      void qc.invalidateQueries({ queryKey: ['conversaciones'] });
    },
  });

  return { hilo, enviar, enviarMedia, marcarLeido };
}
