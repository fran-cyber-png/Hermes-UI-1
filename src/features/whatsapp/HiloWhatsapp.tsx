import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, Loader2, Megaphone, Paperclip, Phone, QrCode, Send, Link2, WifiOff, X } from 'lucide-react';
import { ErrorApi } from '../../lib/datos/cliente';
import type { Conversacion } from '../canales/conversaciones';
import {
  urlMedia,
  useConversacionWa,
  useSesionWa,
  type EstadoSesionWa,
  type MediaHilo,
  type OrigenLead,
} from './conversacionWa';

/**
 * El adjunto dentro de la burbuja, como en WhatsApp Web: la imagen se ve, el
 * video y el audio se reproducen, el documento se baja. Los mensajes multimedia
 * viejos (de antes de que Hermes bajara adjuntos) no tienen archivo — para esos
 * queda el aviso honesto de siempre.
 */
function MediaEnBurbuja({ media }: { media: MediaHilo }) {
  const src = urlMedia(media.archivo);

  if (media.clase === 'imagen' || media.clase === 'sticker') {
    return (
      <a href={src} target="_blank" rel="noreferrer" title="Ver completa">
        <img
          src={src}
          alt={media.nombre ?? 'imagen recibida'}
          className={
            media.clase === 'sticker'
              ? 'size-28 object-contain'
              : 'max-h-72 w-full rounded-lg object-cover'
          }
          loading="lazy"
        />
      </a>
    );
  }
  if (media.clase === 'video') {
    return <video src={src} controls preload="metadata" className="max-h-72 w-full rounded-lg" />;
  }
  if (media.clase === 'audio') {
    return <audio src={src} controls preload="metadata" className="w-56 max-w-full" />;
  }
  // Documento (el flyer, el PDF del temario…): tarjeta con nombre y descarga.
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      download={media.nombre ?? undefined}
      className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/60 px-3 py-2.5 transition-colors hover:bg-muted"
    >
      <FileText size={18} className="shrink-0 text-navy" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-foreground">{media.nombre ?? 'Documento'}</span>
        <span className="block text-[10.5px] text-muted-foreground">{media.mime ?? 'archivo'} · tocá para abrir</span>
      </span>
    </a>
  );
}

/**
 * LA CONVERSACIÓN NATIVA DE WHATSAPP — ver el hilo y responder, desde Hermes.
 *
 * Reemplaza al webview de WhatsApp Web: el hilo viene de NUESTRO backend (que lo
 * ingirió del transporte), y el envío pasa por `EnvioControlado`. La vendedora no
 * vincula nada acá —eso es de la consola del operador (D13)— solo ve el estado y
 * responde.
 */
export function HiloWhatsapp({ conversacion }: { conversacion: Conversacion }) {
  const telefono = conversacion.persona_id ?? '';
  const numeroPropio = conversacion.numero_propio ?? '';
  const { data: sesion } = useSesionWa();
  const { hilo, enviar, enviarMedia, marcarLeido } = useConversacionWa(telefono);
  const [texto, setTexto] = useState('');
  const [adjunto, setAdjunto] = useState<File | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const finRef = useRef<HTMLDivElement>(null);

  // Al abrir la conversación: marcar leído (una vez por teléfono).
  useEffect(() => {
    if (telefono) marcarLeido.mutate(telefono);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telefono]);

  // Autoscroll al último mensaje cuando llega algo.
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [hilo.data?.mensajes.length]);

  const conectado = sesion?.estado === 'conectado';
  const enviando = enviar.isPending || enviarMedia.isPending;

  async function onEnviar() {
    const t = texto.trim();
    try {
      if (adjunto) {
        // Con adjunto, el texto de la caja viaja como caption (como en WhatsApp).
        await enviarMedia.mutateAsync({ numeroPropio, telefono, referencia: conversacion.clave, archivo: adjunto, caption: t });
        setAdjunto(null);
        setTexto('');
        return;
      }
      if (!t) return;
      await enviar.mutateAsync({ numeroPropio, telefono, texto: t, referencia: conversacion.clave });
      setTexto('');
    } catch {
      // El error se muestra abajo; no limpiamos texto ni adjunto para no perderlos.
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
      {/* Cabecera del contacto */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-secondary text-xs font-bold text-navy">
          {(conversacion.persona_nombre ?? telefono ?? '·').slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold text-foreground">
            {conversacion.persona_nombre ?? telefono}
          </div>
          <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
            <Phone size={10} /> {telefono}
          </div>
        </div>
      </header>

      <BannerSesion sesion={sesion} />
      <BadgeOrigen origen={hilo.data?.origen ?? null} />

      {/* El hilo */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
        <p className="mb-3 rounded-lg bg-secondary/60 px-3 py-2 text-center text-xs text-secondary-foreground">
          Esta conversación se ve desde que se vinculó el número. Lo anterior está en el teléfono.
        </p>
        {hilo.isPending ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : (
          hilo.data?.mensajes.map((m) => (
            <div
              key={m.id}
              className={
                'flex duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] animate-in fade-in slide-in-from-bottom-1 ' +
                (m.direccion === 'saliente' ? 'justify-end' : 'justify-start')
              }
            >
              <div
                className={
                  'max-w-[75%] rounded-2xl text-sm shadow-[0_1px_2px_rgba(14,42,82,0.06)] ' +
                  (m.media && (m.media.clase === 'imagen' || m.media.clase === 'video') ? 'p-1.5 ' : 'px-3.5 py-2 ') +
                  (m.direccion === 'saliente'
                    ? 'rounded-br-md bg-secondary text-navy'
                    : 'rounded-bl-md bg-card text-foreground ring-1 ring-border')
                }
              >
                {m.media && <MediaEnBurbuja media={m.media} />}
                {m.texto ? (
                  <div className={m.media ? 'px-2 pt-1.5' : ''}>{m.texto}</div>
                ) : m.media ? null : (
                  <span className="italic text-muted-foreground">(no es texto — velo en el teléfono)</span>
                )}
                <div className={'mt-0.5 text-right font-mono text-[10px] text-muted-foreground ' + (m.media ? 'px-2 pb-1' : '')}>
                  {new Date(m.occurred_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={finRef} />
      </div>

      {/* Caja de envío */}
      <footer className="shrink-0 border-t border-border p-3">
        {(enviar.isError || enviarMedia.isError) && (
          <div className="mb-2 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {(enviar.error ?? enviarMedia.error) instanceof ErrorApi
              ? ((enviar.error ?? enviarMedia.error) as ErrorApi).message
              : 'No se pudo enviar.'}
          </div>
        )}

        {/* El adjunto elegido, antes de mandarlo: se ve, se puede sacar. */}
        {adjunto && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-secondary/50 px-3 py-2">
            {adjunto.type.startsWith('image/') ? (
              <img src={URL.createObjectURL(adjunto)} alt="" className="size-10 rounded-lg object-cover" />
            ) : (
              <FileText size={18} className="shrink-0 text-navy" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-foreground">{adjunto.name}</div>
              <div className="text-[10.5px] text-muted-foreground">
                {(adjunto.size / 1024 / 1024).toFixed(1)} MB · el texto de abajo va como leyenda
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAdjunto(null)}
              title="Quitar adjunto"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={archivoRef}
            type="file"
            accept="image/*,video/*,audio/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              if (f) setAdjunto(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => archivoRef.current?.click()}
            disabled={!conectado}
            title="Adjuntar imagen, video o documento"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onEnviar();
              }
            }}
            disabled={!conectado}
            rows={1}
            placeholder={
              !conectado
                ? 'La sesión no está conectada'
                : adjunto
                  ? 'Leyenda del adjunto (opcional)…'
                  : `Escribile a ${conversacion.persona_nombre ?? telefono}…`
            }
            className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void onEnviar()}
            disabled={!conectado || (!texto.trim() && !adjunto) || enviando}
            className="group flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_2px_10px_-2px_rgba(37,99,235,0.5)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-primary-hover hover:shadow-[0_4px_16px_-2px_rgba(37,99,235,0.55)] active:scale-[0.94] disabled:opacity-40 disabled:shadow-none"
          >
            {enviando ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} className="transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
          Se envía solo a esta persona, con tu nombre. Nada masivo, nada automático.
        </p>
      </footer>
    </div>
  );
}

/**
 * De dónde vino el lead — la captura del embudo, hecha visible. Que la vendedora
 * sepa "esta persona vino del anuncio X" cambia cómo le habla.
 */
function BadgeOrigen({ origen }: { origen: OrigenLead }) {
  if (!origen) return null;

  if (origen.fuente === 'anuncio') {
    return (
      <div className="flex items-center gap-2 border-b border-border bg-gold/10 px-4 py-2 text-xs text-gold-ink">
        <Megaphone size={13} className="shrink-0" />
        <span>
          Vino del anuncio{origen.anuncio ? <b> “{origen.anuncio}”</b> : ''}
          {origen.campana ? <> · campaña <b>{origen.campana}</b></> : ''}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-4 py-2 text-xs text-secondary-foreground">
      <Link2 size={13} className="shrink-0" />
      <span>Vino de la landing <b>{origen.ref}</b></span>
    </div>
  );
}

/** El banner de estado de sesión. Cada estado se ve distinto porque lo arregla gente distinta. */
function BannerSesion({ sesion }: { sesion: EstadoSesionWa | undefined }) {
  if (!sesion || sesion.estado === 'conectado') return null;

  if (sesion.estado === 'baneado') {
    return (
      <div className="flex items-start gap-2 border-b border-border bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
        <WifiOff size={14} className="mt-0.5 shrink-0" />
        <span>
          <b>WhatsApp suspendió este número</b> (código {sesion.codigo}). Se levanta {sesion.expira}. Hasta
          entonces no se puede enviar. No es la app: es el riesgo de un número no oficial.
        </span>
      </div>
    );
  }
  if (sesion.estado === 'sin-vincular') {
    return (
      <div className="flex items-start gap-2 border-b border-border bg-secondary px-4 py-2.5 text-xs text-secondary-foreground">
        <QrCode size={14} className="mt-0.5 shrink-0" />
        <span>
          <b>Número sin vincular.</b> Vinculalo desde la consola del operador (<code className="font-mono">wa:vincular</code>). Acá no se vincula.
        </span>
      </div>
    );
  }
  const motivo = 'motivo' in sesion ? sesion.motivo : '';
  return (
    <div className="flex items-center gap-2 border-b border-border bg-warning/10 px-4 py-2.5 text-xs text-gold-ink">
      <WifiOff size={14} className="shrink-0" /> WhatsApp {sesion.estado}. {motivo}
    </div>
  );
}
