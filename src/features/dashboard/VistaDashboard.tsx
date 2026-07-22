import { useMemo, useState } from 'react';
import { ArrowRight, MessageSquareText, Phone, Search, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import { hace } from '../../lib/datos/frescura';
import { BadgeCanal, nombreCanal } from '../canales/BadgeCanal';
import type { Conversacion } from '../canales/conversaciones';
import { conversacionDeRecordatorio, useAgenda, type Recordatorio } from '../agenda/agenda';
import {
  conversacionDeChat,
  paisDe,
  relevanciaDe,
  useDashboard,
  type LeadChat,
  type LeadFormulario,
} from './dashboard';
import { llamar } from '../../lib/enlacesExternos';

/**
 * EL DASHBOARD — la página de las 9am (veredicto del panel de diseño:
 * vendedora-first + densidad).
 *
 * Orden vertical = orden de urgencia:
 *   A · TU MAÑANA (banda fija h-16): tu deuda — vencidos y lo de hoy — y el
 *       ÚNICO botón primario de la vista: "Atender a {nombre} →".
 *   B · EL RADAR (flex-1, scroll interno): los leads cayendo, filas de 2
 *       líneas, relevancia alta = borde IZQUIERDO ORO (preattentivo, sin chip).
 *   C · EL RIEL (w-80): embudo en una barra, qué cursos piden, el equipo.
 *
 * La página NUNCA scrollea (solo radar y riel, por adentro). Presupuesto de
 * oro cerrado: borde de fila caliente, pills de hoy, punto del toggle. Vencido
 * es rojo: oro = se acaba; rojo = ya se acabó.
 */

const ETAPA_CHIP: Record<string, string> = {
  interesado: 'bg-primary/10 text-primary',
  contactado: 'bg-secondary text-secondary-foreground',
  cotizado: 'bg-navy text-white',
  cierre: 'bg-success/10 text-success',
  perdido: 'bg-destructive/10 text-destructive',
};

const FUENTES = [
  { id: '', label: 'Todo' },
  { id: 'chat', label: 'Chats' },
  { id: 'comentario', label: 'Comentarios' },
  { id: 'landing', label: 'Landings' },
  { id: 'lead-ad', label: 'Lead Ads' },
] as const;

type Fila = { fuente: 'chat' | 'comentario'; chat: LeadChat } | { fuente: 'landing' | 'lead-ad'; form: LeadFormulario };

function inicialesDe(nombre: string | null): string {
  if (!nombre) return '·';
  const limpio = nombre.replace(/^@/, '').trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  return (partes.length >= 2 ? partes[0][0] + partes[1][0] : limpio.slice(0, 2)).toUpperCase();
}

/** El "+" de etiquetas: fantasma → input inline. Enter guarda, Escape cancela. */
function EtiquetaInline({ clave }: { clave: string }) {
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
        onClick={(e) => {
          e.stopPropagation();
          setAbierto(true);
        }}
        title="Etiquetar"
        className="rounded-md border border-dashed border-border px-1.5 text-[10px] leading-4 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        +
      </button>
    );
  }
  return (
    <input
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && valor.trim()) agregar.mutate(valor.trim());
        if (e.key === 'Escape') setAbierto(false);
      }}
      onBlur={() => setAbierto(false)}
      autoFocus
      placeholder="etiqueta…"
      className="w-20 rounded-md border border-primary bg-card px-1.5 text-[10.5px] leading-4 outline-none"
    />
  );
}

export function VistaDashboard({
  onAbrir,
  onBuscarPersona,
  onIrAgenda,
  miVendedora,
}: {
  onAbrir: (c: Conversacion) => void;
  onBuscarPersona: (telefono: string) => void;
  onIrAgenda: () => void;
  miVendedora: string;
}) {
  const { data, isPending } = useDashboard();
  const { agenda } = useAgenda();
  const [fuente, setFuente] = useState<(typeof FUENTES)[number]['id']>('');
  const [etapaFiltro, setEtapaFiltro] = useState<string | null>(null);
  const [soloCalientes, setSoloCalientes] = useState(false);
  const [periodo, setPeriodo] = useState<'hoy' | '7d'>('hoy');

  // ── A · Tu mañana: la deuda personal, de la Agenda ya cargada. ──
  const { vencidas, deHoy } = useMemo(() => {
    const rs = agenda.data?.recordatorios ?? [];
    const inicioHoy = new Date();
    inicioHoy.setHours(0, 0, 0, 0);
    const finHoy = new Date(inicioHoy.getTime() + 86_400_000);
    return {
      vencidas: rs.filter((r) => r.estado === 'pendiente' && new Date(r.cuando) < inicioHoy),
      deHoy: rs.filter((r) => {
        const d = new Date(r.cuando);
        return r.estado === 'pendiente' && d >= inicioHoy && d < finHoy;
      }),
    };
  }, [agenda.data]);
  const pills: { r: Recordatorio; vencida: boolean }[] = [
    ...vencidas.map((r) => ({ r, vencida: true })),
    ...deHoy.map((r) => ({ r, vencida: false })),
  ].slice(0, 3);
  const masEnAgenda = vencidas.length + deHoy.length - pills.length;

  // ── B · Las filas del radar, con todos los filtros aplicados. ──
  const filas = useMemo<Fila[]>(() => {
    if (!data) return [];
    const todas: (Fila & { cayo: number })[] = [
      ...data.chats.map((c) => ({ fuente: c.fuente, chat: c, cayo: new Date(c.cayo_at).getTime() }) as Fila & { cayo: number }),
      ...data.formularios.map((f) => ({ fuente: f.fuente, form: f, cayo: new Date(f.cayo_at).getTime() }) as Fila & { cayo: number }),
    ];
    return todas
      .filter((f) => !fuente || f.fuente === fuente)
      .filter((f) => {
        if (!etapaFiltro) return true;
        const clave = 'chat' in f ? f.chat.clave : f.form.clave;
        const etapa = data.etapas[clave] ?? ('chat' in f ? 'interesado' : f.form.estado_lead === 'nuevo' ? 'interesado' : f.form.estado_lead);
        return etapa === etapaFiltro;
      })
      .filter((f) => {
        if (!soloCalientes) return true;
        const base = 'chat' in f ? f.chat : { pide_info: false, ventana_abierta: false, cayo_at: f.form.cayo_at };
        return relevanciaDe(base) === 'alta';
      })
      .sort((a, b) => b.cayo - a.cayo)
      .slice(0, 80);
  }, [data, fuente, etapaFiltro, soloCalientes]);

  // El caliente más antiguo sin atender: el gatillo de "Atender a {nombre} →".
  const atender = useMemo(() => {
    const calientes = (data?.chats ?? []).filter((c) => relevanciaDe(c) === 'alta');
    return calientes.sort((a, b) => a.cayo_at.localeCompare(b.cayo_at))[0] ?? null;
  }, [data]);
  const nCalientes = (data?.chats ?? []).filter((c) => relevanciaDe(c) === 'alta').length;

  // "últ. hace X" por fuente, para los pills (¿fuente muerta? se ve acá).
  const ultimaPor = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of data?.chats ?? []) m[c.fuente] = Math.max(m[c.fuente] ?? 0, new Date(c.cayo_at).getTime());
    for (const f of data?.formularios ?? []) m[f.fuente] = Math.max(m[f.fuente] ?? 0, new Date(f.cayo_at).getTime());
    return m;
  }, [data]);

  const countPor = (id: string) =>
    !data ? 0 : id === '' ? data.chats.length + data.formularios.length : [...data.chats, ...data.formularios].filter((x) => x.fuente === id).length;

  const ETAPAS_BARRA = ['interesado', 'contactado', 'cotizado', 'cierre', 'perdido'] as const;
  const totalEmbudo = ETAPAS_BARRA.reduce((n, e) => n + (data?.embudo[e] ?? 0), 0);
  const maxCurso = Math.max(1, ...(data?.cursos ?? []).map((c) => c.n));

  const equipo = useMemo(() => {
    const lista = [...(data?.porVendedora ?? [])];
    lista.sort((a, b) => (a.vendedora === miVendedora ? -1 : b.vendedora === miVendedora ? 1 : 0));
    return lista;
  }, [data, miVendedora]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3">
      {/* ═══ A · TU MAÑANA — altura fija, cero layout-shift ═══ */}
      <section className="flex h-16 shrink-0 items-center gap-3 overflow-hidden rounded-2xl bg-card px-4 shadow-panel">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {agenda.isPending ? (
            <span className="text-xs text-muted-foreground">Cargando tu agenda…</span>
          ) : pills.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              Agenda al día — nada vencido, nada para hoy{nCalientes === 0 ? ' · sin calientes ahora' : ''}.
            </span>
          ) : (
            <>
              {pills.map(({ r, vencida }) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onAbrir(conversacionDeRecordatorio(r))}
                  title={r.nota}
                  className={
                    'max-w-52 truncate rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-transform hover:scale-[1.02] ' +
                    (vencida ? 'bg-destructive/10 text-destructive' : 'bg-gold/20 text-gold-ink')
                  }
                >
                  {r.personaNombre ?? r.nota} ·{' '}
                  {vencida
                    ? new Date(r.cuando).toLocaleDateString('es', { weekday: 'short' })
                    : new Date(r.cuando).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                </button>
              ))}
              {masEnAgenda > 0 && (
                <button type="button" onClick={onIrAgenda} className="shrink-0 text-[11.5px] font-semibold text-primary hover:underline">
                  +{masEnAgenda} más →
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[11.5px] tabular-nums text-muted-foreground">
            <span className="size-1.5 rounded-full bg-gold-ink" /> {nCalientes} calientes
          </span>
          {atender && (
            <button
              type="button"
              onClick={() => onAbrir(conversacionDeChat(atender))}
              className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-[0_4px_14px_-4px_rgba(37,99,235,0.5)] transition-all hover:bg-primary-hover active:scale-[0.97]"
            >
              Atender a {(atender.persona_nombre ?? atender.telefono ?? 'lead').split(' ')[0]}
              <ArrowRight size={13} />
            </button>
          )}
        </div>
      </section>

      {/* ═══ B + C ═══ */}
      <div className="flex min-h-0 flex-1 gap-2.5">
        {/* ── B · EL RADAR ── */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl bg-card shadow-panel">
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            <h2 className="font-heading text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              El radar
            </h2>
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">· {filas.length}</span>
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-1.5 animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            <span className="text-[10.5px] text-muted-foreground">en vivo</span>

            {etapaFiltro && (
              <button
                type="button"
                onClick={() => setEtapaFiltro(null)}
                className="flex items-center gap-1 rounded-full bg-navy px-2.5 py-0.5 text-[10.5px] font-semibold capitalize text-white"
              >
                {etapaFiltro} <X size={10} />
              </button>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-1">
              {FUENTES.map((f) => {
                const ult = f.id && ultimaPor[f.id] ? (Date.now() - ultimaPor[f.id]) / 3_600_000 : null;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFuente(f.id)}
                    className={
                      'rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-colors ' +
                      (fuente === f.id ? 'bg-navy text-white' : 'text-muted-foreground hover:bg-secondary hover:text-foreground')
                    }
                  >
                    {f.label} {countPor(f.id) > 0 && <span className="font-mono">{countPor(f.id)}</span>}
                    {ult !== null && ult > 24 && <span className="ml-1 font-normal opacity-70">· sin caídas {hace(ult)}</span>}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setSoloCalientes((v) => !v)}
                className={
                  'ml-1 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold transition-colors ' +
                  (soloCalientes ? 'border-gold-ink bg-gold/15 text-gold-ink' : 'border-border text-muted-foreground hover:text-foreground')
                }
              >
                <span className="size-1.5 rounded-full bg-gold-ink" /> Solo calientes
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isPending ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-11 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            ) : filas.length === 0 ? (
              <p className="px-6 py-14 text-center text-xs leading-relaxed text-muted-foreground">
                {fuente === 'landing'
                  ? 'Sin landings acá todavía — falta apuntar el webhook de Bravo a Hermes (runbook §9). No es que no caigan.'
                  : 'Nada cayó con estos filtros. Si la frescura del header está verde, este vacío es real.'}
                {(fuente || etapaFiltro || soloCalientes) && (
                  <button
                    type="button"
                    onClick={() => {
                      setFuente('');
                      setEtapaFiltro(null);
                      setSoloCalientes(false);
                    }}
                    className="ml-1.5 font-bold text-primary hover:underline"
                  >
                    Volver a Todo
                  </button>
                )}
              </p>
            ) : (
              filas.map((fila) => {
                const esChat = 'chat' in fila;
                const base = esChat ? fila.chat : fila.form;
                const clave = base.clave;
                const etapa =
                  data!.etapas[clave] ?? (esChat ? 'interesado' : fila.form.estado_lead === 'nuevo' ? 'interesado' : fila.form.estado_lead);
                const alta = relevanciaDe(esChat ? fila.chat : { pide_info: false, ventana_abierta: false, cayo_at: fila.form.cayo_at }) === 'alta';
                const tags = data!.etiquetas[clave] ?? [];
                const pais = paisDe(base.pais_dato, esChat ? fila.chat.telefono : fila.form.telefono);
                const horas = (Date.now() - new Date(base.cayo_at).getTime()) / 3_600_000;

                return (
                  <div
                    key={clave}
                    role="button"
                    tabIndex={0}
                    onClick={() => (esChat ? onAbrir(conversacionDeChat(fila.chat)) : fila.form.telefono && onBuscarPersona(fila.form.telefono))}
                    className={
                      'group cursor-pointer border-b border-border/70 px-4 py-2 transition-colors last:border-b-0 hover:bg-accent ' +
                      (alta ? 'border-l-[3px] border-l-gold' : 'border-l-[3px] border-l-transparent')
                    }
                  >
                    {/* L1: canal + atribución + etapa */}
                    <div className="flex items-center gap-2">
                      {esChat ? <BadgeCanal canal={fila.chat.canal} size={13} /> : null}
                      <span className="truncate text-[11px] text-muted-foreground">
                        {esChat
                          ? `${fila.fuente === 'comentario' ? 'Comentario' : nombreCanal(fila.chat.canal)}${fila.chat.contexto_texto ? ` · “${fila.chat.contexto_texto.slice(0, 48)}”` : ''}`
                          : `${fila.fuente === 'landing' ? 'Landing' : 'Lead Ad'} · ${fila.form.producto ?? fila.form.campana ?? 'sin campaña'}${fila.form.flyer && fila.form.flyer !== 'ORGANICO' ? ` · ${fila.form.flyer}` : ''}`}
                      </span>
                      <span className={'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold capitalize ' + (ETAPA_CHIP[etapa] ?? ETAPA_CHIP.interesado)}>
                        {etapa}
                      </span>
                    </div>
                    {/* L2: nombre + país + etiquetas + hace + acciones */}
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">
                        {base.persona_nombre ?? (
                          <span className="font-mono text-xs text-muted-foreground">
                            {(esChat ? fila.chat.telefono : (fila.form.telefono ?? fila.form.correo)) ?? 'sin dato'}
                          </span>
                        )}
                      </span>
                      {pais && <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground" title={pais}>{pais}</span>}
                      {tags.map((t) => (
                        <span key={t} className="shrink-0 rounded-md border border-border px-1.5 text-[10px] leading-4 text-muted-foreground">
                          {t}
                        </span>
                      ))}
                      <EtiquetaInline clave={clave} />
                      <span className="ml-auto flex shrink-0 items-center gap-1">
                        <span className={'font-mono text-[11px] tabular-nums ' + (esChat && horas > 20 && horas < 24 ? 'text-gold-ink' : 'text-muted-foreground')} title={new Date(base.cayo_at).toLocaleString('es')}>
                          {hace(horas)}
                        </span>
                        <span className="flex items-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                          {(esChat ? fila.chat.telefono : fila.form.telefono) && (
                            <Phone
                              size={13}
                              className="cursor-pointer text-success"
                              aria-label="Llamar"
                              onClick={(e) => {
                                e.stopPropagation();
                                llamar((esChat ? fila.chat.telefono : fila.form.telefono)!);
                              }}
                            />
                          )}
                          {esChat ? (
                            <MessageSquareText size={13} className="text-navy" />
                          ) : fila.form.telefono ? (
                            <Search
                              size={13}
                              className="cursor-pointer text-navy"
                              onClick={(e) => {
                                e.stopPropagation();
                                onBuscarPersona(fila.form.telefono!);
                              }}
                            />
                          ) : null}
                        </span>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* ── C · EL RIEL ── */}
        <aside className="flex w-80 shrink-0 flex-col gap-2.5 overflow-y-auto">
          {/* C1 · Embudo: UNA barra, click filtra */}
          <section className="rounded-2xl bg-card p-4 shadow-panel">
            <h3 className="font-heading text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              Embudo <span className="font-mono normal-case tracking-normal">· {totalEmbudo}</span>
            </h3>
            {totalEmbudo === 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                El embudo se arma cuando los leads cambian de etapa en Mensajes o el Pipeline.
              </p>
            ) : (
              <>
                <div className="mt-2.5 flex h-2 gap-px overflow-hidden rounded-full">
                  {ETAPAS_BARRA.map((e, i) => {
                    const n = data?.embudo[e] ?? 0;
                    if (!n) return null;
                    const color = e === 'cierre' ? 'bg-success' : e === 'perdido' ? 'bg-muted-foreground/30' : ['bg-navy/40', 'bg-navy/60', 'bg-navy'][i] ?? 'bg-navy';
                    return (
                      <button
                        key={e}
                        type="button"
                        title={`${e}: ${n}`}
                        onClick={() => setEtapaFiltro(etapaFiltro === e ? null : e)}
                        style={{ flexGrow: n }}
                        className={color + ' transition-opacity hover:opacity-80 ' + (etapaFiltro === e ? 'ring-2 ring-navy ring-offset-1' : '')}
                      />
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                  {ETAPAS_BARRA.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setEtapaFiltro(etapaFiltro === e ? null : e)}
                      className={'font-mono text-[10.5px] tabular-nums transition-colors ' + (etapaFiltro === e ? 'font-bold text-navy' : 'text-muted-foreground hover:text-foreground')}
                    >
                      {data?.embudo[e] ?? 0} {e.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* C2 · Qué piden */}
          <section className="rounded-2xl bg-card p-4 shadow-panel">
            <h3 className="font-heading text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Qué piden</h3>
            {(data?.cursos.length ?? 0) === 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Nadie mencionó un curso todavía — los intereses se registran desde el chat o al cotizar.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-1.5">
                {data!.cursos.slice(0, 5).map((c, i) => (
                  <div key={c.curso} className="flex items-center gap-2 text-[11.5px]">
                    <span className="w-3 shrink-0 font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                    <span className={'min-w-0 flex-1 truncate ' + (i === 0 ? 'font-semibold text-foreground' : 'text-foreground')} title={c.curso}>
                      {c.curso}
                    </span>
                    <span className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-secondary-foreground/50" style={{ width: `${(c.n / maxCurso) * 100}%` }} />
                    </span>
                    <span className="w-5 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-muted-foreground">{c.n}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* C3 · Equipo */}
          <section className="rounded-2xl bg-card p-4 shadow-panel">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Equipo</h3>
              <div className="flex rounded-full border border-border p-0.5">
                {(['hoy', '7d'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriodo(p)}
                    className={'rounded-full px-2 py-0.5 text-[10px] font-semibold ' + (periodo === p ? 'bg-navy text-white' : 'text-muted-foreground')}
                  >
                    {p === 'hoy' ? 'Hoy' : '7d'}
                  </button>
                ))}
              </div>
            </div>
            {equipo.length === 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Nadie registró actividad todavía — el día arranca con la primera respuesta.
              </p>
            ) : (
              <div className="mt-2">
                <div className="mb-1 flex items-center gap-2 text-[9.5px] uppercase tracking-wider text-muted-foreground">
                  <span className="flex-1" />
                  <span className="w-9 text-right">conv</span>
                  <span className="w-9 text-right">msj</span>
                  <span className="w-9 text-right">vtas</span>
                </div>
                {equipo.map((v) => {
                  const soyYo = v.vendedora === miVendedora;
                  const [conv, msj, vtas] =
                    periodo === 'hoy'
                      ? [v.conversaciones_hoy, v.mensajes_hoy, v.ventas_hoy]
                      : [v.conversaciones_7d, v.mensajes_7d, v.ventas_7d];
                  return (
                    <div key={v.vendedora} className="flex items-center gap-2 border-t border-border/60 py-1.5 text-[11.5px]">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-[8px] bg-secondary font-heading text-[9px] font-bold text-navy">
                        {inicialesDe(v.vendedora)}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                        {v.vendedora}
                        {soyYo && <span className="ml-1 rounded bg-secondary px-1 text-[9px] text-secondary-foreground">vos</span>}
                      </span>
                      <span className="w-9 text-right font-mono tabular-nums text-foreground">{conv}</span>
                      <span className="w-9 text-right font-mono tabular-nums text-foreground">{msj}</span>
                      <span className={'w-9 text-right font-mono tabular-nums ' + (vtas > 0 ? 'font-bold text-success' : 'text-foreground')}>
                        {vtas}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
