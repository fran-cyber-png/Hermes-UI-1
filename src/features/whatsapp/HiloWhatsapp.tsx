import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Phone, QrCode, Send, WifiOff } from 'lucide-react';
import { ErrorApi } from '../../lib/datos/cliente';
import type { Conversacion } from '../canales/conversaciones';
import { useConversacionWa, useSesionWa, type EstadoSesionWa } from './conversacionWa';

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
  const { hilo, enviar, marcarLeido } = useConversacionWa(telefono);
  const [texto, setTexto] = useState('');
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

  async function onEnviar() {
    const t = texto.trim();
    if (!t) return;
    try {
      await enviar.mutateAsync({ numeroPropio, telefono, texto: t, referencia: conversacion.clave });
      setTexto('');
    } catch {
      // El error se muestra abajo (enviar.error); no limpiamos el texto para no perderlo.
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
                  'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-[0_1px_2px_rgba(14,42,82,0.06)] ' +
                  (m.direccion === 'saliente'
                    ? 'rounded-br-md bg-secondary text-navy'
                    : 'rounded-bl-md bg-card text-foreground ring-1 ring-border')
                }
              >
                {m.texto ?? <span className="italic text-muted-foreground">(no es texto — velo en el teléfono)</span>}
                <div className="mt-0.5 text-right font-mono text-[10px] text-muted-foreground">
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
        {enviar.isError && (
          <div className="mb-2 flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {enviar.error instanceof ErrorApi ? enviar.error.message : 'No se pudo enviar.'}
          </div>
        )}
        <div className="flex items-end gap-2">
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
            placeholder={conectado ? `Escribile a ${conversacion.persona_nombre ?? telefono}…` : 'La sesión no está conectada'}
            className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void onEnviar()}
            disabled={!conectado || !texto.trim() || enviar.isPending}
            className="group flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_2px_10px_-2px_rgba(37,99,235,0.5)] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-primary-hover hover:shadow-[0_4px_16px_-2px_rgba(37,99,235,0.55)] active:scale-[0.94] disabled:opacity-40 disabled:shadow-none"
          >
            {enviar.isPending ? (
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
