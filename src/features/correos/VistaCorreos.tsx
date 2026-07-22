import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Mail, Send } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';

/**
 * CORREOS — enviar un email sin salir de Hermes.
 *
 * Un correo = una vendedora, un destinatario, una acción humana (misma
 * filosofía que WhatsApp: sin listas, sin campañas). Abajo, los últimos
 * enviados del equipo — coordinación a la vista, incluidos los fallidos.
 * Si el SMTP no está conectado, se dice QUÉ falta; no se finge un canal.
 */

interface Correo {
  id: number;
  vendedoraId: string;
  para: string;
  asunto: string;
  estado: 'enviado' | 'fallido';
  motivo: string | null;
  creadoAt: string;
}

export function VistaCorreos() {
  const qc = useQueryClient();
  const [para, setPara] = useState('');
  const [asunto, setAsunto] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const estado = useQuery({
    queryKey: ['correos', 'estado'],
    queryFn: () => api<{ conectado: boolean; desde: string | null }>('/api/correos/estado'),
  });
  const enviados = useQuery({
    queryKey: ['correos', 'lista'],
    queryFn: () => api<{ correos: Correo[] }>('/api/correos'),
  });

  const enviar = useMutation({
    mutationFn: () =>
      api<{ ok: true }>('/api/correos/enviar', {
        method: 'POST',
        body: JSON.stringify({ para, asunto, cuerpo }),
      }),
    onSuccess: () => {
      setAviso({ tipo: 'ok', texto: `Enviado a ${para}.` });
      setPara('');
      setAsunto('');
      setCuerpo('');
      void qc.invalidateQueries({ queryKey: ['correos', 'lista'] });
      window.setTimeout(() => setAviso(null), 5000);
    },
    onError: (err) => {
      setAviso({ tipo: 'error', texto: err instanceof ErrorApi ? err.message : 'No se pudo enviar.' });
    },
  });

  const conectado = estado.data?.conectado ?? false;

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto p-5">
      <div className="w-full max-w-2xl">
        {/* ── El composer ── */}
        <section className="rounded-2xl bg-card p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-navy" />
            <h1 className="font-heading text-sm font-bold text-foreground">Nuevo correo</h1>
            {estado.data?.desde && (
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">desde {estado.data.desde}</span>
            )}
          </div>

          {!estado.isPending && !conectado ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-xs leading-relaxed text-gold-ink">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                El canal de correo todavía no está conectado: falta cargar{' '}
                <code className="font-mono">SMTP_HOST · SMTP_USER · SMTP_PASS</code> (y opcional{' '}
                <code className="font-mono">SMTP_FROM</code>) en el <code className="font-mono">.env</code> del
                server. La cuenta vive en <b>mail.goberna.us</b> — es un paso del operador, dos minutos. Esta
                pantalla se enciende sola cuando esté.
              </span>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2.5">
              <input
                value={para}
                onChange={(e) => setPara(e.target.value)}
                type="email"
                placeholder="Para: persona@correo.com"
                className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm outline-none transition-colors focus:border-primary placeholder:font-sans"
              />
              <input
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
                placeholder="Asunto"
                className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm outline-none transition-colors focus:border-primary"
              />
              <textarea
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                rows={8}
                placeholder="Escribí el correo… (va en texto plano, con tu firma de siempre)"
                className="resize-y rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm leading-relaxed outline-none transition-colors focus:border-primary"
              />

              {aviso && (
                <p
                  className={
                    'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ' +
                    (aviso.tipo === 'ok' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')
                  }
                >
                  {aviso.tipo === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />}
                  {aviso.texto}
                </p>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => enviar.mutate()}
                  disabled={enviar.isPending || !para.trim() || !asunto.trim() || !cuerpo.trim()}
                  className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground shadow-[0_4px_16px_-4px_rgba(37,99,235,0.5)] transition-all hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
                >
                  {enviar.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Enviar
                </button>
                <p className="text-[11px] text-muted-foreground">
                  Se envía solo a esta persona, con tu nombre. Nada masivo.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ── Los últimos enviados del equipo ── */}
        <section className="mt-4">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Últimos enviados
          </h2>
          {(enviados.data?.correos.length ?? 0) === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              Todavía no salió ningún correo desde Hermes.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-card shadow-panel">
              {enviados.data!.correos.map((c) => (
                <div key={c.id} className="flex items-center gap-3 border-b border-border/70 px-4 py-2.5 text-xs last:border-b-0">
                  <span
                    className={
                      'size-1.5 shrink-0 rounded-full ' + (c.estado === 'enviado' ? 'bg-success' : 'bg-destructive')
                    }
                    title={c.estado === 'fallido' ? (c.motivo ?? 'falló') : 'enviado'}
                  />
                  <span className="w-24 shrink-0 truncate font-semibold text-foreground">{c.vendedoraId}</span>
                  <span className="w-48 shrink-0 truncate font-mono text-muted-foreground">{c.para}</span>
                  <span className="min-w-0 flex-1 truncate text-foreground">{c.asunto}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {new Date(c.creadoAt).toLocaleDateString('es', { day: '2-digit', month: 'short' })}{' '}
                    {new Date(c.creadoAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
