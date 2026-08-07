import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { tokenGuardado } from '../../lib/datos/token';
import { API_URL } from '../../config';
import type { PiezaDeclarada } from './procedenciaComposer';

/** Un adjunto del hilo: el archivo ya vive en el server, esto es la referencia. */
export interface MediaHilo {
  clase: 'imagen' | 'video' | 'audio' | 'documento' | 'sticker';
  archivo: string;
  mime: string | null;
  nombre?: string | null;
}

/**
 * Una reacción a un mensaje — 👍 al flyer, ❤️ al temario.
 *
 * **Opcional a propósito, y ausente en vez de `[]`**: un server viejo no la
 * manda y la migración puede no estar aplicada. Sin el campo, la burbuja se
 * dibuja como siempre; con `[]` habría que distinguir «no tiene reacciones» de
 * «no se pudo saber», y esa diferencia no le sirve a nadie acá.
 */
/** La escala de los ✓✓. Espeja `entrega/dominio.ts` del server. */
export type EstadoEntregaWa = 'enviado' | 'entregado' | 'leido' | 'fallido';

export interface ReaccionWa {
  emoji: string;
  /** La puso Goberna por esta línea, no el lead. */
  nuestra: boolean;
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
  /** Si este mensaje trajo el origen del lead (anuncio/landing). Solo el primero suele traerlo. */
  origen?: { fuente: string; titulo?: string | null } | null;
  /**
   * Lo mandó la AUTO-RESPUESTA fuera de horario, no una persona (#125, ADR 0015).
   * Sale de `envios_wa.automatico`. La vendedora TIENE que poder distinguirlo de
   * un vistazo: sin la marca, abre el chat creyendo que ella escribió eso.
   */
  automatico?: boolean;
  /**
   * Quién le dio el OK antes de que saliera (modo supervisado, ADR 0016). Null
   * en modo automático, donde justamente no lo miró nadie. La distinción no es
   * cosmética: «esto lo mandó la máquina sola» y «esto lo mandó la máquina
   * porque Ana lo aprobó» son dos cosas distintas para quien lee el hilo tres
   * días después.
   */
  aprobada_por?: string | null;
  /** Las reacciones a ESTE mensaje, en el orden en que se pusieron. */
  reacciones?: ReaccionWa[];
  /**
   * ¿LE LLEGÓ? ¿LO LEYÓ? Solo en los SALIENTES.
   *
   * **Ausente = no se sabe**, y eso NO es lo mismo que «enviado»: los mensajes
   * anteriores a este frente no tienen estado —sus recibos pasaron cuando no los
   * escuchábamos— y dibujar un ✓ ahí sería afirmar algo que nadie confirmó.
   */
  entrega?: EstadoEntregaWa;
}

/**
 * La URL para ver/bajar un adjunto del hilo. OJO: está detrás del perímetro
 * (Bearer), así que NO va directa a un `<img src>` — se consume vía
 * `useBlobAutenticado` (src/lib/datos/blobAutenticado.ts), el mecanismo
 * central de media autenticada.
 */
export function urlMedia(archivo: string): string {
  return `${API_URL}/api/whatsapp/media/${encodeURIComponent(archivo)}`;
}

/**
 * CUÁNTO ACEPTA ESTA LÍNEA, por clase de adjunto (bytes).
 *
 * Lo publica `GET /api/whatsapp/sesion` porque el tope **es de la línea, no de
 * Hermes**: la del bot es Cloud API y Meta corta el video en 16 MB y la imagen
 * en 5; las de las vendedoras son whatsmeow y no tienen ese tope. Sin esto, la
 * app dejaba elegir un video de 17,9 MB, lo subía entero y mostraba el JSON de
 * Meta con su `fbtrace_id`.
 *
 * **Opcional a propósito**: un server viejo no lo manda, y ahí el front no
 * frena nada — que es exactamente como se comportaba antes. La garantía no es
 * ésta: el server verifica igual y responde 409 con el motivo redactado.
 */
export type LimitesMediaWa = Partial<Record<'imagen' | 'video' | 'audio' | 'documento', number>>;

/** El estado de la sesión de WhatsApp (para el banner). Espeja `EstadoSesion` del server. */
export type EstadoSesionWa = {
  /** Qué hay del otro lado. Ausente en un server viejo. */
  transporte?: 'whatsmeow' | 'cloud-api' | 'falso';
  limitesMedia?: LimitesMediaWa;
} & (
  | { estado: 'sin-vincular'; qr: string | null; codigo: string | null }
  | { estado: 'conectando' }
  | { estado: 'conectado'; telefono: string }
  | { estado: 'desconectado'; motivo: string }
  | { estado: 'cerrada'; motivo: string }
  | { estado: 'baneado'; codigo: string; expira: string }
);

export function useSesionWa(numeroPropio?: string | null) {
  const params = numeroPropio ? `?numeroPropio=${encodeURIComponent(numeroPropio)}` : '';
  return useQuery({
    queryKey: ['wa', 'sesion', numeroPropio ?? ''],
    queryFn: () => api<EstadoSesionWa>(`/api/whatsapp/sesion${params}`),
    refetchInterval: 10_000,
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
  /**
   * Marcar leído al abrir. Hace DOS cosas del otro lado: los ticks azules para el
   * lead y el cursor de lectura de la vendedora (lo que apaga el punto azul de
   * la fila).
   *
   * ⚠️ **`numeroPropio` no es opcional para el cursor**: `estado_conversacion` se
   * indexa por la clave completa `conv:whatsapp:<tel>:<linea>`, y sin la línea el
   * server no puede saber cuál conversación marcar — manda los ticks y no toca el
   * cursor, que es lo correcto: mejor no apagar la marca que apagar la de otra.
   *
   * La cola se revalida al terminar. La conversación **no se mueve de lugar**:
   * el orden es por urgencia y leer no es atender (decisión del 7-ago-2026).
   */
  const marcarLeido = useMutation({
    mutationFn: (vars: { telefono: string; numeroPropio?: string | null }) => {
      const q = vars.numeroPropio ? `?numeroPropio=${encodeURIComponent(vars.numeroPropio)}` : '';
      return api<{ ok: true; cursor: boolean }>(`/api/whatsapp/leido/${vars.telefono}${q}`, {
        method: 'POST',
        body: '{}',
      });
    },
    onSuccess: (r) => {
      // Solo si el cursor se movió: sin `numeroPropio` no cambió nada y refrescar
      // la cola entera sería un viaje al pedo.
      if (r?.cursor) void qc.invalidateQueries({ queryKey: ['conversaciones'] });
    },
  });

  const enviar = useMutation({
    mutationFn: (vars: {
      numeroPropio: string;
      telefono: string;
      texto: string;
      referencia: string;
      /** De qué pieza salió (#169). Ausente = escrito a mano: la línea de base. */
      pieza?: PiezaDeclarada;
    }) =>
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
      const token = tokenGuardado();
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

  /**
   * REACCIONAR a un mensaje del lead. Emoji vacío quita la reacción.
   *
   * Optimista a propósito: la píldora aparece al instante y se corrige sola si
   * el server dice que no. Reaccionar es el gesto más liviano del chat — que
   * tarde medio segundo en aparecer lo hace sentir roto.
   */
  const reaccionar = useMutation({
    mutationFn: (vars: { numeroPropio: string; telefono: string; mensajeId: string; emoji: string }) =>
      api<{ ok: true; quitada: boolean }>('/api/whatsapp/reaccionar', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onMutate: async (vars) => {
      const clave = ['wa', 'conversacion', telefono];
      await qc.cancelQueries({ queryKey: clave });
      const antes = qc.getQueryData(clave);
      qc.setQueryData(clave, (viejo: { mensajes: MensajeHilo[] } | undefined) => {
        if (!viejo) return viejo;
        return {
          ...viejo,
          mensajes: viejo.mensajes.map((m) => {
            if (m.external_id !== `wa:${vars.mensajeId}` && m.external_id !== vars.mensajeId) return m;
            // Las de OTROS quedan como están: solo se toca la nuestra, que es
            // la única que este gesto puede cambiar.
            const ajenas = (m.reacciones ?? []).filter((r) => !r.nuestra);
            const nuestras = vars.emoji ? [{ emoji: vars.emoji, nuestra: true }] : [];
            const todas = [...ajenas, ...nuestras];
            return { ...m, reacciones: todas.length ? todas : undefined };
          }),
        };
      });
      return { antes, clave };
    },
    onError: (_e, _v, ctx) => {
      // Se deshace: dejar la píldora puesta sobre algo que no salió es peor que
      // no haberla mostrado.
      if (ctx?.antes) qc.setQueryData(ctx.clave, ctx.antes);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['wa', 'conversacion', telefono] }),
  });

  return { hilo, enviar, enviarMedia, marcarLeido, reaccionar };
}
