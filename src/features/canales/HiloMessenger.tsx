import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Lock } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import type { Conversacion } from './conversaciones';

/**
 * EL HILO DE MESSENGER — leer la conversación completa, con las dos mitades.
 *
 * Mata al dead-end ("abrilo en Business Suite" sin mostrar nada): el hilo ya
 * estaba en la base — la ingesta guarda lo que la persona escribió Y lo que la
 * página respondió — solo que nadie lo dibujaba.
 *
 * Es LECTURA. Responder Messenger queda fuera a propósito: Meta solo permite
 * responder dentro de las 24 h del último mensaje (y casi todo el backlog está
 * vencido); la etiqueta HUMAN_AGENT exige App Review. La caja de abajo lo dice
 * con el motivo y el link — deshabilitada honesta, no rota.
 */

interface Mensaje {
  id: number;
  direccion: string;
  autor: string;
  texto: string | null;
  occurred_at: string;
}

function useHiloMessenger(canal: string, personaId: string | null) {
  return useQuery({
    queryKey: ['hilo-messenger', canal, personaId],
    queryFn: () =>
      api<{ historial: Mensaje[]; nombre: string | null; total: number }>(
        `/api/persona/conv/${canal}/${encodeURIComponent(personaId ?? '')}`,
      ),
    enabled: Boolean(personaId),
  });
}

export function HiloMessenger({ conversacion }: { conversacion: Conversacion }) {
  const { data, isPending } = useHiloMessenger(conversacion.canal, conversacion.persona_id);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView();
  }, [data?.historial.length]);

  const nombre = conversacion.persona_nombre ?? data?.nombre ?? 'Conversación';

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="flex size-8 items-center justify-center rounded-[11px] bg-secondary font-heading text-xs font-bold text-navy">
          {nombre.slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate font-heading text-sm font-bold text-foreground">{nombre}</div>
          <div className="text-xs text-muted-foreground">
            Messenger · {data ? `${data.total} mensajes` : 'cargando…'}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/30 p-4">
        {isPending ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : !data || data.historial.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No hay mensajes capturados de esta conversación.
          </p>
        ) : (
          data.historial.map((m) => (
            <div key={m.id} className={'flex ' + (m.direccion === 'saliente' ? 'justify-end' : 'justify-start')}>
              <div
                className={
                  'max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-[0_1px_2px_rgba(14,42,82,0.06)] ' +
                  (m.direccion === 'saliente'
                    ? 'rounded-br-md bg-secondary text-navy'
                    : 'rounded-bl-md bg-card text-foreground ring-1 ring-border')
                }
              >
                {m.texto ?? <span className="italic text-muted-foreground">(sin texto)</span>}
                <div className="mt-0.5 text-right font-mono text-[11px] text-muted-foreground">
                  {new Date(m.occurred_at).toLocaleDateString('es', { day: '2-digit', month: 'short' })}{' '}
                  {new Date(m.occurred_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={finRef} />
      </div>

      {/* La caja deshabilitada honesta: por qué no, y a dónde ir. */}
      <footer className="shrink-0 border-t border-border bg-muted/40 px-4 py-3">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Lock size={13} className="mt-0.5 shrink-0" />
          <span>
            Meta solo permite responder DMs dentro de las 24 h del último mensaje, y este canal todavía
            no está conectado para envíos.{' '}
            <a
              href="https://business.facebook.com/latest/inbox/all"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-bold text-primary hover:underline"
            >
              Abrilo en Business Suite <ExternalLink size={10} />
            </a>
          </span>
        </p>
      </footer>
    </div>
  );
}
