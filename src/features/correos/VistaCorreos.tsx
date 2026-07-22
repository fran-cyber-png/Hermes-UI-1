import { Fragment, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Mail, Send, X } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { kicker } from '../../lib/styles';
import { fechaCorta } from '../../lib/formato';

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

interface VistaCorreosProps {
  /** Puente (§2.9): llega desde la ficha con el Para ya lleno. */
  correoInicial?: string | null;
  /** Avisa al shell que el puente ya se consumió, para que lo limpie. */
  onConsumido?: () => void;
}

function mismoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** «hoy» / «ayer» / «lun 14 jul» (con año si es de otro año). */
function etiquetaDia(fecha: string): string {
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) return fecha;
  const hoy = new Date();
  if (mismoDia(d, hoy)) return 'hoy';
  const ayer = new Date(hoy);
  ayer.setDate(hoy.getDate() - 1);
  if (mismoDia(d, ayer)) return 'ayer';
  if (d.getFullYear() !== hoy.getFullYear()) return fechaCorta(fecha);
  return d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
}

/** «recién» / «hace 40 min» / «hace 2 h» / «hace 3 días». */
function hace(fecha: string): string {
  const ms = Date.now() - new Date(fecha).getTime();
  if (Number.isNaN(ms)) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

export function VistaCorreos({ correoInicial, onConsumido }: VistaCorreosProps) {
  const qc = useQueryClient();
  const [para, setPara] = useState('');
  const [asunto, setAsunto] = useState('');
  const [cuerpo, setCuerpo] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  // El puente desde la ficha: prellena el Para y avisa para que el shell lo limpie.
  useEffect(() => {
    if (!correoInicial) return;
    setPara(correoInicial);
    onConsumido?.();
  }, [correoInicial, onConsumido]);

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
    onMutate: () => {
      setAviso(null);
    },
    onSuccess: () => {
      setAviso({ tipo: 'ok', texto: `Enviado a ${para}.` });
      setPara('');
      setAsunto('');
      setCuerpo('');
      void qc.invalidateQueries({ queryKey: ['correos', 'lista'] });
    },
    onError: (err) => {
      setAviso({
        tipo: 'error',
        texto: err instanceof ErrorApi ? err.message : 'No se pudo enviar — probá de nuevo.',
      });
    },
  });

  const conectado = estado.data?.conectado ?? false;
  const puedeEnviar = !enviar.isPending && para.trim() !== '' && asunto.trim() !== '' && cuerpo.trim() !== '';

  // Los enviados, agrupados por día (vienen del más nuevo al más viejo).
  const grupos: { dia: string; etiqueta: string; correos: Correo[] }[] = [];
  for (const c of enviados.data?.correos ?? []) {
    const d = new Date(c.creadoAt);
    const dia = Number.isNaN(d.getTime()) ? c.creadoAt : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.dia === dia) ultimo.correos.push(c);
    else grupos.push({ dia, etiqueta: etiquetaDia(c.creadoAt), correos: [c] });
  }

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto p-5">
      <div className="w-full max-w-2xl">
        {/* ── El composer ── */}
        <section className="rounded-2xl bg-card p-5 shadow-panel">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-navy" />
            <h1 className="font-heading text-lg font-bold text-foreground">Nuevo correo</h1>
            {conectado && estado.data?.desde && (
              <span className="ml-auto animate-[entrar_240ms_var(--ease-house)] font-mono text-[11px] text-muted-foreground">
                desde {estado.data.desde}
              </span>
            )}
          </div>

          {estado.isError ? (
            <div className="mt-4 rounded-xl bg-muted/50 p-3.5 text-xs leading-relaxed text-foreground">
              <p>No se pudo consultar el estado del canal de correo — reintentá en un momento.</p>
              <button
                type="button"
                onClick={() => void estado.refetch()}
                className="mt-2.5 rounded-lg border border-border px-3 py-1.5 font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
              >
                Reintentar
              </button>
            </div>
          ) : estado.data?.conectado === false ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3.5 text-xs leading-relaxed text-warning-foreground">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p>
                  El canal de correo todavía no está conectado. Es un paso de sistemas — dos minutos — y esta
                  pantalla se enciende sola cuando esté. La cuenta vive en{' '}
                  <span className="font-semibold">mail.goberna.us</span>.
                </p>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  para sistemas: SMTP_HOST · SMTP_USER · SMTP_PASS en el .env
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-2.5">
              <input
                value={para}
                onChange={(e) => setPara(e.target.value)}
                type="email"
                aria-label="Para"
                placeholder="Para: persona@correo.com"
                className="rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm outline-none transition-[border-color,box-shadow] duration-200 placeholder:font-sans focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
              />
              <input
                value={asunto}
                onChange={(e) => setAsunto(e.target.value)}
                aria-label="Asunto"
                placeholder="Asunto"
                className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-200 focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
              />
              <textarea
                value={cuerpo}
                onChange={(e) => setCuerpo(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (puedeEnviar) enviar.mutate();
                  }
                }}
                rows={8}
                aria-label="Cuerpo del correo"
                placeholder="Escribí el correo… (va en texto plano, con tu firma de siempre)"
                className="resize-y rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm leading-relaxed outline-none transition-[border-color,box-shadow] duration-200 focus:border-primary focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
              />

              {aviso && (
                <div
                  role="status"
                  className={
                    'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ' +
                    (aviso.tipo === 'ok' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')
                  }
                >
                  {aviso.tipo === 'ok' ? (
                    <Check size={13} className="shrink-0" />
                  ) : (
                    <AlertTriangle size={13} className="shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">{aviso.texto}</span>
                  <button
                    type="button"
                    onClick={() => setAviso(null)}
                    aria-label="Cerrar aviso"
                    className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => enviar.mutate()}
                  disabled={!puedeEnviar}
                  className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground shadow-[0_4px_16px_-4px_rgba(37,99,235,0.5)] transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
                >
                  {enviar.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Enviar
                </button>
                <p className="text-[11px] text-muted-foreground">
                  Se envía solo a esta persona, con tu nombre. Nada masivo.{' '}
                  <span className="font-mono">⌘↵</span> para enviar.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ── Los últimos enviados del equipo ── */}
        <section className="mt-4">
          <h2 className={'mb-2 ' + kicker}>Últimos enviados</h2>
          {enviados.isPending ? (
            <div className="overflow-hidden rounded-2xl bg-card shadow-panel">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 border-b border-border/70 px-4 py-3 last:border-b-0">
                  <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-muted" />
                  <span className="h-3 w-24 shrink-0 animate-pulse rounded bg-muted" />
                  <span className="h-3 w-48 shrink-0 animate-pulse rounded bg-muted" />
                  <span className="h-3 min-w-0 flex-1 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : enviados.isError ? (
            <div className="rounded-2xl border border-border bg-card p-5 text-center text-xs text-foreground">
              <p>No se pudo cargar la lista — no es que no haya correos.</p>
              <button
                type="button"
                onClick={() => void enviados.refetch()}
                className="mt-2.5 rounded-lg border border-border px-3 py-1.5 font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1"
              >
                Reintentar
              </button>
            </div>
          ) : grupos.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
              Todavía no salió ningún correo desde Hermes. El primero se escribe acá arriba.
            </p>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-card shadow-panel">
              {grupos.map((g) => (
                <Fragment key={g.dia}>
                  <div className="border-b border-border/70 bg-muted/30 px-4 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {g.etiqueta}
                  </div>
                  {g.correos.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 border-b border-border/70 px-4 py-2.5 text-xs last:border-b-0"
                    >
                      {c.estado === 'enviado' ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-success" title="enviado" />
                      ) : (
                        <span aria-hidden className="size-1.5 shrink-0" />
                      )}
                      <span className="hidden w-24 shrink-0 truncate font-semibold text-foreground sm:block">
                        {c.vendedoraId}
                      </span>
                      <span className="min-w-0 shrink basis-48 truncate font-mono text-muted-foreground">{c.para}</span>
                      <span className="min-w-0 flex-1 truncate text-foreground">{c.asunto}</span>
                      {c.estado === 'fallido' && (
                        <span className="max-w-48 shrink-0 truncate rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">
                          falló{c.motivo ? ` · ${c.motivo}` : ''}
                        </span>
                      )}
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {hace(c.creadoAt)}
                      </span>
                    </div>
                  ))}
                </Fragment>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
