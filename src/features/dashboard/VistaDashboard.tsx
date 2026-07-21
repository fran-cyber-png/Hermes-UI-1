import { useMemo, useState } from 'react';
import { Loader2, MessageSquareText, Plus, Search, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import { hace } from '../../lib/datos/frescura';
import { BadgeCanal, nombreCanal } from '../canales/BadgeCanal';
import type { Conversacion } from '../canales/conversaciones';
import {
  conversacionDeChat,
  paisDe,
  relevanciaDe,
  useDashboard,
  type LeadChat,
  type LeadFormulario,
} from './dashboard';

/**
 * EL DASHBOARD — la página principal: el radar de leads cayendo.
 *
 * Arriba, el equipo: conversaciones / mensajes / ventas por vendedora (los
 * números de los que sale la comisión, a la vista de todas). Abajo, LA GRILLA:
 * todo lo que está cayendo — chats y comentarios, Lead Ads, y los formularios
 * de las landings (los mismos que caen al "excel", reenviados por Bravo en
 * vivo) — con el orden de columnas que pidió el dueño: de dónde entró, estado,
 * relevancia, etiquetas, nombre, país.
 *
 * Acá se MIRA y se decide; se trabaja en la Bandeja (un clic y estás ahí).
 */

const ETAPA_CHIP: Record<string, string> = {
  nuevo: 'bg-muted text-muted-foreground',
  contactado: 'bg-secondary text-secondary-foreground',
  interesado: 'bg-primary/10 text-primary',
  cotizado: 'bg-navy text-white',
  venta: 'bg-success/10 text-success',
  cierre: 'bg-success/10 text-success',
  convertido: 'bg-success/10 text-success',
  perdido: 'bg-destructive/10 text-destructive',
  descartado: 'bg-destructive/10 text-destructive',
};

const RELEVANCIA_CHIP: Record<string, { clase: string; label: string }> = {
  alta: { clase: 'bg-gold/20 text-gold-ink', label: 'Alta' },
  media: { clase: 'bg-secondary text-secondary-foreground', label: 'Media' },
  baja: { clase: 'bg-muted text-muted-foreground', label: 'Baja' },
};

const FILTROS = [
  { id: '', label: 'Todo' },
  { id: 'chat', label: 'Chats' },
  { id: 'comentario', label: 'Comentarios' },
  { id: 'landing', label: 'Landings' },
  { id: 'lead-ad', label: 'Lead Ads' },
] as const;

type Fila =
  | { fuente: 'chat' | 'comentario'; chat: LeadChat }
  | { fuente: 'landing' | 'lead-ad'; form: LeadFormulario };

function inicialesDe(nombre: string | null): string {
  if (!nombre) return '·';
  const limpio = nombre.replace(/^@/, '').trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  return (partes.length >= 2 ? partes[0][0] + partes[1][0] : limpio.slice(0, 2)).toUpperCase();
}

/** El "+ etiqueta" inline de una fila de la grilla. */
function AgregarEtiqueta({ clave }: { clave: string }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState('');

  const agregar = useMutation({
    mutationFn: (etiqueta: string) =>
      api('/api/gestiones/etiquetas', { method: 'POST', body: JSON.stringify({ clave, etiqueta }) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      setValor('');
      setAbierto(false);
    },
  });

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Agregar etiqueta"
        className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[10.5px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        <Plus size={10} className="inline" />
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && valor.trim()) agregar.mutate(valor.trim());
          if (e.key === 'Escape') setAbierto(false);
        }}
        autoFocus
        placeholder="etiqueta…"
        className="w-20 rounded-md border border-primary bg-card px-1.5 py-0.5 text-[11px] outline-none"
      />
      <button type="button" onClick={() => setAbierto(false)} className="text-muted-foreground hover:text-foreground">
        <X size={11} />
      </button>
    </span>
  );
}

export function VistaDashboard({
  onAbrir,
  onBuscarPersona,
}: {
  onAbrir: (c: Conversacion) => void;
  onBuscarPersona: (telefono: string) => void;
}) {
  const { data, isPending } = useDashboard();
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]['id']>('');

  const filas = useMemo<Fila[]>(() => {
    if (!data) return [];
    const todas: (Fila & { cayo: number })[] = [
      ...data.chats.map((c) => ({ fuente: c.fuente, chat: c, cayo: new Date(c.cayo_at).getTime() }) as Fila & { cayo: number }),
      ...data.formularios.map((f) => ({ fuente: f.fuente, form: f, cayo: new Date(f.cayo_at).getTime() }) as Fila & { cayo: number }),
    ];
    return todas
      .filter((f) => !filtro || f.fuente === filtro)
      .sort((a, b) => b.cayo - a.cayo)
      .slice(0, 80);
  }, [data, filtro]);

  const hayLandings = (data?.formularios ?? []).some((f) => f.fuente === 'landing');

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        {/* ── EL EQUIPO: conversaciones / mensajes / ventas por vendedora ── */}
        <section>
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            El equipo hoy
          </div>
          {isPending ? (
            <div className="h-20 animate-pulse rounded-2xl bg-muted" />
          ) : (data?.porVendedora.length ?? 0) === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-4 text-xs text-muted-foreground">
              Todavía no hay envíos ni ventas registradas hoy. Los números aparecen solos cuando el
              equipo trabaja — nada que configurar.
            </p>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {data!.porVendedora.map((v) => (
                <div
                  key={v.vendedora}
                  className="flex min-w-56 shrink-0 items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-panel"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-navy font-heading text-sm font-bold text-white">
                    {inicialesDe(v.vendedora)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-heading text-[13px] font-bold text-foreground">{v.vendedora}</div>
                    <div className="mt-0.5 flex gap-3 text-[11px] text-muted-foreground">
                      <span title="Conversaciones atendidas hoy">
                        <b className="font-mono text-sm tabular-nums text-foreground">{v.conversaciones_hoy}</b> conv
                      </span>
                      <span title="Mensajes enviados hoy">
                        <b className="font-mono text-sm tabular-nums text-foreground">{v.mensajes_hoy}</b> msj
                      </span>
                      <span title="Ventas registradas hoy">
                        <b className="font-mono text-sm tabular-nums text-success">{v.ventas_hoy}</b> ventas
                      </span>
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      7d: {v.conversaciones_7d} · {v.mensajes_7d} · {v.ventas_7d}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── LA GRILLA: leads cayendo ── */}
        <section className="rounded-2xl border border-border bg-card shadow-panel">
          <header className="flex items-center gap-3 border-b border-border px-4 py-3">
            <h1 className="font-heading text-sm font-bold text-foreground">Leads cayendo</h1>
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-2 animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            <span className="text-[11px] text-muted-foreground">en vivo</span>
            <div className="ml-auto flex gap-1">
              {FILTROS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFiltro(f.id)}
                  className={
                    'rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ' +
                    (filtro === f.id
                      ? 'bg-navy text-white'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground')
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
          </header>

          {!hayLandings && !isPending && (
            <p className="border-b border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
              Las landings todavía no están conectadas: falta apuntar el webhook de Bravo a Hermes
              (un campo por tenant — está en el runbook). Hasta entonces esta fuente se ve vacía; no
              es que no caigan leads.
            </p>
          )}

          {isPending ? (
            <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" /> Cargando el radar…
            </p>
          ) : filas.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-muted-foreground">
              Nada cayó por esta fuente en los últimos días. Si la frescura del header está verde,
              este vacío es real.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    <th className="px-4 py-2.5 font-semibold">De dónde entró</th>
                    <th className="px-3 py-2.5 font-semibold">Estado</th>
                    <th className="px-3 py-2.5 font-semibold">Relevancia</th>
                    <th className="px-3 py-2.5 font-semibold">Etiquetas</th>
                    <th className="px-3 py-2.5 font-semibold">Nombre</th>
                    <th className="px-3 py-2.5 font-semibold">País</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Hace</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((fila) => {
                    const esChat = 'chat' in fila;
                    const base = esChat ? fila.chat : fila.form;
                    const clave = base.clave;
                    const etapa = data!.etapas[clave] ?? (esChat ? null : fila.form.estado_lead) ?? 'nuevo';
                    const relev = relevanciaDe(
                      esChat
                        ? fila.chat
                        : { pide_info: false, ventana_abierta: false, cayo_at: fila.form.cayo_at },
                    );
                    const tags = data!.etiquetas[clave] ?? [];
                    const pais = paisDe(base.pais_dato, esChat ? fila.chat.telefono : fila.form.telefono);
                    const horas = (Date.now() - new Date(base.cayo_at).getTime()) / 3_600_000;

                    return (
                      <tr key={clave} className="group border-b border-border/70 transition-colors last:border-b-0 hover:bg-muted/40">
                        {/* De dónde entró */}
                        <td className="px-4 py-2.5">
                          {esChat ? (
                            <span className="flex items-center gap-2">
                              <BadgeCanal canal={fila.chat.canal} size={16} />
                              <span>
                                <span className="font-medium text-foreground">
                                  {fila.fuente === 'comentario' ? 'Comentario' : nombreCanal(fila.chat.canal)}
                                </span>
                                {fila.chat.contexto_texto && (
                                  <span className="block max-w-44 truncate text-[11px] text-muted-foreground">
                                    en “{fila.chat.contexto_texto}”
                                  </span>
                                )}
                              </span>
                            </span>
                          ) : (
                            <span>
                              <span
                                className={
                                  'rounded-md px-1.5 py-0.5 text-[11px] font-bold ' +
                                  (fila.fuente === 'landing' ? 'bg-navy text-white' : 'bg-secondary text-secondary-foreground')
                                }
                              >
                                {fila.fuente === 'landing' ? 'Landing' : 'Lead Ad'}
                              </span>
                              <span className="block max-w-44 truncate text-[11px] text-muted-foreground">
                                {fila.form.producto ?? fila.form.campana ?? '—'}
                                {fila.form.flyer && fila.form.flyer !== 'ORGANICO' ? ` · ${fila.form.flyer}` : ''}
                              </span>
                            </span>
                          )}
                        </td>
                        {/* Estado */}
                        <td className="px-3 py-2.5">
                          <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ' + (ETAPA_CHIP[etapa] ?? ETAPA_CHIP.nuevo)}>
                            {etapa}
                          </span>
                        </td>
                        {/* Relevancia */}
                        <td className="px-3 py-2.5">
                          <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + RELEVANCIA_CHIP[relev].clase}>
                            {RELEVANCIA_CHIP[relev].label}
                          </span>
                        </td>
                        {/* Etiquetas */}
                        <td className="px-3 py-2.5">
                          <span className="flex flex-wrap items-center gap-1">
                            {tags.map((t) => (
                              <span key={t} className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                                {t}
                              </span>
                            ))}
                            <AgregarEtiqueta clave={clave} />
                          </span>
                        </td>
                        {/* Nombre */}
                        <td className="px-3 py-2.5">
                          <span className="font-heading text-[13px] font-semibold text-foreground">
                            {base.persona_nombre ?? (
                              <span className="font-mono text-xs font-normal text-muted-foreground">
                                {(esChat ? fila.chat.telefono : (fila.form.telefono ?? fila.form.correo)) ?? 'sin dato'}
                              </span>
                            )}
                          </span>
                        </td>
                        {/* País */}
                        <td className="px-3 py-2.5 text-muted-foreground">{pais ?? '—'}</td>
                        {/* Hace */}
                        <td className="px-3 py-2.5 text-right font-mono text-[11.5px] tabular-nums text-muted-foreground">
                          {hace(horas)}
                        </td>
                        {/* Acción */}
                        <td className="px-3 py-2.5 text-right">
                          {esChat ? (
                            <button
                              type="button"
                              title="Abrir en la Bandeja"
                              onClick={() => onAbrir(conversacionDeChat(fila.chat))}
                              className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-secondary hover:text-navy"
                            >
                              <MessageSquareText size={15} />
                            </button>
                          ) : fila.form.telefono ? (
                            <button
                              type="button"
                              title="Buscar su ficha en Personas"
                              onClick={() => onBuscarPersona(fila.form.telefono!)}
                              className="rounded-lg p-1.5 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-secondary hover:text-navy"
                            >
                              <Search size={15} />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
