import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, MessageSquareText, Search, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import { hace } from '../../lib/datos/frescura';
import { useSelloDeViejo } from '../../lib/datos/useSelloDeViejo';
import { SelloDeAntes } from '../../components/SelloDeAntes';
import { tempBorde, tempClass } from '../../lib/formato';
import { kicker, sectionLabel } from '../../lib/styles';
import { ETAPAS, ETAPA_CHIP, colorSegmento } from '../../lib/etapas';
import { Columnas } from '../../components/graficos/Columnas';
import { BarraSegmentada } from '../../components/graficos/BarraSegmentada';
import { Chispa } from '../../components/graficos/Chispa';
import { BadgeCanal, nombreCanal } from '../canales/BadgeCanal';
import type { Conversacion } from '../canales/conversaciones';
import { conversacionDeRecordatorio, useAgenda, type Recordatorio } from '../agenda/agenda';
import {
  conversacionDeChat,
  paisDe,
  esDeuda,
  useDashboard,
  type LeadChat,
  type LeadFormulario,
} from './dashboard';
import { BotonLlamar } from '../gestion/BotonLlamar';

/**
 * EL DASHBOARD — la página de las 9am (spec «Cierre de edición» §3.3).
 *
 * Orden vertical = orden de urgencia:
 *   A · TU MAÑANA (banda fija h-16): abre con EL TITULAR — la cifra héroe de
 *       calientes calculada sobre la MISMA unión chats+formularios que el
 *       filtro «Solo calientes» — más tu deuda de Agenda y el ÚNICO botón
 *       primario de la vista: "Atender a {nombre} →".
 *   B · EL RADAR (flex-1, scroll interno): los leads cayendo, filas de 2
 *       líneas. Canon de listas: banda izquierda = TEMPERATURA (tempBorde);
 *       la relevancia alta se marca con el punto dorado, no con la banda.
 *   C · EL RIEL (w-80): Embudo → Los últimos 14 días → Qué piden → Equipo.
 *       Las gráficas hablan en voz de imprenta y no compiten con el titular.
 *
 * La página NUNCA scrollea (solo radar y riel, por adentro). El oro significa
 * tiempo que se acaba: punto de calientes, pills de hoy, ventanita 20–24h.
 * Vencido es rojo: oro = se acaba; rojo = ya se acabó.
 */

const FUENTES = [
  { id: '', label: 'Todo' },
  { id: 'chat', label: 'Chats' },
  { id: 'comentario', label: 'Comentarios' },
  { id: 'landing', label: 'Landings' },
  { id: 'lead-ad', label: 'Lead Ads' },
] as const;

type Fila = { fuente: 'chat' | 'comentario'; chat: LeadChat } | { fuente: 'landing' | 'lead-ad'; form: LeadFormulario };
/** La fila con la clave de urgencia que mandó el server. El front la aplica, no la calcula. */
type FilaConClave = Fila & { nivel: number; orden: number };

/** Anchos variados para el skeleton del radar: anatomía real de 2 líneas. */
const SKELETON_RADAR = [
  ['w-2/5', 'w-3/5'],
  ['w-3/5', 'w-1/3'],
  ['w-1/3', 'w-2/5'],
  ['w-2/5', 'w-1/3'],
  ['w-3/5', 'w-2/5'],
  ['w-1/3', 'w-3/5'],
  ['w-2/5', 'w-3/5'],
  ['w-3/5', 'w-1/3'],
  ['w-1/3', 'w-2/5'],
] as const;

/** Columnas fantasma (alturas %) para el skeleton de la gráfica de 14 días. */
const SKELETON_COLUMNAS = [40, 65, 30, 75, 50, 25, 60, 45, 80, 35, 55, 70, 30, 60] as const;

function inicialesDe(nombre: string | null): string {
  if (!nombre) return '·';
  const limpio = nombre.replace(/^@/, '').trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  return (partes.length >= 2 ? partes[0][0] + partes[1][0] : limpio.slice(0, 2)).toUpperCase();
}

/**
 * El "+" de etiquetas: fantasma → input inline. Enter o blur con texto guardan;
 * Escape es el ÚNICO descarte (y no burbujea al listener global — §2.8).
 */
function EtiquetaInline({ clave }: { clave: string }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState('');
  const descartadoRef = useRef(false);
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
        className="rounded-md border border-dashed border-border px-1.5 text-[11px] leading-4 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
      >
        +
      </button>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && valor.trim() && !agregar.isPending) agregar.mutate(valor.trim());
          if (e.key === 'Escape') {
            e.stopPropagation();
            descartadoRef.current = true;
            setValor('');
            setAbierto(false);
          }
        }}
        onBlur={() => {
          if (descartadoRef.current) {
            descartadoRef.current = false;
            return;
          }
          if (agregar.isPending) return;
          if (valor.trim()) agregar.mutate(valor.trim());
          else setAbierto(false);
        }}
        autoFocus
        placeholder="etiqueta…"
        className="w-20 rounded-md border border-primary bg-card px-1.5 text-[11px] leading-4 outline-none"
      />
      {agregar.isError && <span className="shrink-0 text-[11px] text-destructive">No se guardó — probá de nuevo.</span>}
    </span>
  );
}

export function VistaDashboard({
  onAbrir,
  onBuscarPersona,
  onIrAgenda,
  miVendedora,
  onMandarCorreo,
}: {
  onAbrir: (c: Conversacion) => void;
  onBuscarPersona: (telefono: string) => void;
  onIrAgenda: () => void;
  miVendedora: string;
  /** Puente a Correos (§2.9): prellena el Para. Opcional hasta que App lo cablee (Fase 3). */
  onMandarCorreo?: (para: string) => void;
}) {
  // Renombrados como en la cola (`conversaciones.ts`): el vocabulario de
  // react-query no cruza hacia las vistas.
  const { data, isPending, dataUpdatedAt: traidoEn, isFetching: actualizando } = useDashboard();
  // Al abrir la app el radar viene del caché persistido. Mientras eso sea lo que
  // se ve, «en vivo» sería mentira: el sello dice de cuándo es hasta que llega
  // lo fresco (ver `lib/datos/persistencia.ts`).
  const deAntes = useSelloDeViejo(traidoEn);
  const { agenda } = useAgenda();
  const [fuente, setFuente] = useState<(typeof FUENTES)[number]['id']>('');
  const [etapaFiltro, setEtapaFiltro] = useState<string | null>(null);
  const [soloCalientes, setSoloCalientes] = useState(false);
  const [periodo, setPeriodo] = useState<'hoy' | '7d'>('hoy');
  const [correoCopiado, setCorreoCopiado] = useState<string | null>(null);

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

  // ── El titular de las 9am: calientes sobre la MISMA unión que el filtro. ──
  const { nCalientes, masViejaHoras } = useMemo(() => {
    const bases = [
      ...(data?.chats ?? []).map((c) => ({ nivel: c.nivel, cayo_at: c.cayo_at })),
      ...(data?.formularios ?? []).map((f) => ({ nivel: f.nivel, cayo_at: f.cayo_at })),
    ];
    const esperan = bases.filter((b) => esDeuda(b.nivel));
    let masVieja: number | null = null;
    for (const c of esperan) {
      const t = new Date(c.cayo_at).getTime();
      if (masVieja === null || t < masVieja) masVieja = t;
    }
    return {
      nCalientes: esperan.length,
      masViejaHoras: masVieja === null ? null : (Date.now() - masVieja) / 3_600_000,
    };
  }, [data]);

  // ── B · Las filas del radar, con todos los filtros aplicados. ──
  const { filas, totalFiltradas } = useMemo(() => {
    if (!data) return { filas: [] as FilaConClave[], totalFiltradas: 0 };
    const todas: FilaConClave[] = [
      ...data.chats.map((c) => ({ fuente: c.fuente, chat: c, nivel: c.nivel, orden: c.orden }) as FilaConClave),
      ...data.formularios.map((f) => ({ fuente: f.fuente, form: f, nivel: f.nivel, orden: f.orden }) as FilaConClave),
    ];
    const filtradas = todas
      .filter((f) => !fuente || f.fuente === fuente)
      .filter((f) => {
        if (!etapaFiltro) return true;
        const clave = 'chat' in f ? f.chat.clave : f.form.clave;
        const etapa = data.etapas[clave] ?? ('chat' in f ? 'interesado' : f.form.estado_lead === 'nuevo' ? 'interesado' : f.form.estado_lead);
        return etapa === etapaFiltro;
      })
      .filter((f) => !soloCalientes || esDeuda(f.nivel))
      // Esto NO es un criterio del front: es la clave que mandó el server,
      // aplicada tal cual para poder mezclar las dos listas en una. El orden lo
      // decide cola/urgencia.ts, del otro lado.
      .sort((a, b) => a.nivel - b.nivel || a.orden - b.orden);
    return { filas: filtradas.slice(0, 80), totalFiltradas: filtradas.length };
  }, [data, fuente, etapaFiltro, soloCalientes]);

  // El gatillo de "Atender a {nombre} →". Ya NO elige por su cuenta: toma la
  // primera conversación en Deuda de la lista que el server mandó ordenada. Lo
  // que el titular recomienda y lo que está arriba son la misma fila, por
  // construcción — antes eran dos criterios opuestos y se contradecían.
  const atender = useMemo(() => data?.chats.find((c) => esDeuda(c.nivel)) ?? null, [data]);

  // ── El radar que se siente radar: solo las filas NUEVAS del SSE se animan. ──
  const vistosRef = useRef<Set<string> | null>(null);
  const [nuevas, setNuevas] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!data) return;
    const claves = [...data.chats, ...data.formularios].map((x) => x.clave);
    if (vistosRef.current === null) {
      // Primera carga: nada se anima — nuevo es solo lo que llega DESPUÉS.
      vistosRef.current = new Set(claves);
      return;
    }
    const vistos = vistosRef.current;
    const recien = claves.filter((c) => !vistos.has(c));
    if (recien.length === 0) return;
    for (const c of recien) vistos.add(c);
    setNuevas((prev) => new Set([...prev, ...recien]));
    window.setTimeout(() => {
      setNuevas((prev) => {
        const s = new Set(prev);
        for (const c of recien) s.delete(c);
        return s;
      });
    }, 2000);
  }, [data]);

  // "últ. hace X" por fuente, para los pills (¿fuente muerta? se ve acá).
  const ultimaPor = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of data?.chats ?? []) m[c.fuente] = Math.max(m[c.fuente] ?? 0, new Date(c.cayo_at).getTime());
    for (const f of data?.formularios ?? []) m[f.fuente] = Math.max(m[f.fuente] ?? 0, new Date(f.cayo_at).getTime());
    return m;
  }, [data]);

  const countPor = (id: string) =>
    !data ? 0 : id === '' ? data.chats.length + data.formularios.length : [...data.chats, ...data.formularios].filter((x) => x.fuente === id).length;

  const totalEmbudo = ETAPAS.reduce((n, e) => n + (data?.embudo[e] ?? 0), 0);
  const maxCurso = Math.max(1, ...(data?.cursos ?? []).map((c) => c.n));

  // ── Los últimos 14 días: la serie de leads en voz de imprenta. ──
  const { puntosLeads, resumenLeads } = useMemo(() => {
    const serie = data?.series?.leads_dia ?? [];
    const puntos = serie.map((d) => {
      const total = d.chats + d.comentarios + d.formularios;
      const partes = [
        d.chats > 0 ? `${d.chats} ${d.chats === 1 ? 'chat' : 'chats'}` : null,
        d.comentarios > 0 ? `${d.comentarios} ${d.comentarios === 1 ? 'comentario' : 'comentarios'}` : null,
        d.formularios > 0 ? `${d.formularios} ${d.formularios === 1 ? 'formulario' : 'formularios'}` : null,
      ].filter((p): p is string => p !== null);
      return { dia: d.dia, total, detalle: partes.length > 0 ? partes.join(' · ') : undefined };
    });
    const suma = (ps: typeof puntos) => ps.reduce((n, p) => n + p.total, 0);
    return {
      puntosLeads: puntos,
      resumenLeads: `Esta semana cayeron ${suma(puntos.slice(-7))}; la pasada, ${suma(puntos.slice(-14, -7))}.`,
    };
  }, [data]);

  const enviosValores = (data?.series?.envios_dia ?? []).map((d) => d.n);

  const equipo = useMemo(() => {
    const lista = [...(data?.porVendedora ?? [])];
    lista.sort((a, b) => (a.vendedora === miVendedora ? -1 : b.vendedora === miVendedora ? 1 : 0));
    return lista;
  }, [data, miVendedora]);

  const copiarCorreo = (correo: string, clave: string) => {
    void navigator.clipboard.writeText(correo);
    setCorreoCopiado(clave);
    window.setTimeout(() => setCorreoCopiado((v) => (v === clave ? null : v)), 2000);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3">
      {/* ═══ A · TU MAÑANA — abre con el titular; altura fija, cero layout-shift ═══ */}
      <section className="flex h-16 shrink-0 items-center gap-3 overflow-hidden rounded-2xl bg-card px-4 shadow-panel">
        {isPending ? (
          <div className="h-8 w-44 shrink-0 animate-pulse rounded-lg bg-muted" />
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-gold-ink" />
            <span className="font-heading text-2xl font-bold tabular-nums text-foreground">{nCalientes}</span>
            <span className="text-xs text-muted-foreground">
              {nCalientes === 1 ? 'persona espera' : 'personas esperan'}
              {nCalientes > 0 && masViejaHoras !== null
                ? nCalientes === 1
                  ? ` · ${hace(masViejaHoras)}`
                  : ` · la más vieja ${hace(masViejaHoras)}`
                : ''}
            </span>
          </div>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-2">
          {agenda.isPending ? (
            <>
              <div className="h-7 w-36 animate-pulse rounded-full bg-muted" />
              <div className="h-7 w-24 animate-pulse rounded-full bg-muted" />
            </>
          ) : pills.length === 0 ? (
            <span className="truncate text-xs text-muted-foreground">Agenda al día — nada vencido, nada para hoy.</span>
          ) : (
            <>
              {pills.map(({ r, vencida }) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onAbrir(conversacionDeRecordatorio(r))}
                  title={r.nota}
                  className={
                    'max-w-52 truncate rounded-full px-3 py-1.5 text-xs font-semibold transition-[background-color,transform] duration-200 ease-house active:scale-[0.98] ' +
                    (vencida ? 'bg-destructive/10 text-destructive hover:bg-destructive/20' : 'bg-gold/20 text-gold-ink hover:bg-gold/30')
                  }
                >
                  {r.personaNombre ?? r.nota} ·{' '}
                  {vencida
                    ? hace((Date.now() - new Date(r.cuando).getTime()) / 3_600_000)
                    : new Date(r.cuando).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                </button>
              ))}
              {masEnAgenda > 0 && (
                <button type="button" onClick={onIrAgenda} className="shrink-0 text-xs font-semibold text-primary hover:underline">
                  +{masEnAgenda} más →
                </button>
              )}
            </>
          )}
        </div>

        {atender && (
          <button
            type="button"
            onClick={() => onAbrir(conversacionDeChat(atender))}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-[0_4px_14px_-4px_rgba(37,99,235,0.5)] transition-[transform,background-color] duration-200 ease-house hover:bg-primary-hover active:scale-[0.98]"
          >
            Atender a {(atender.persona_nombre ?? atender.telefono ?? 'lead').split(' ')[0]}
            <ArrowRight size={13} />
          </button>
        )}
      </section>

      {/* ═══ B + C ═══ */}
      <div className="flex min-h-0 flex-1 gap-2.5">
        {/* ── B · EL RADAR — el punto vivo + el contador identifican la zona ── */}
        <section aria-label="El radar" className="flex min-h-0 min-w-0 flex-1 flex-col rounded-2xl bg-card shadow-panel">
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{filas.length}</span>
            {deAntes ? (
              <SelloDeAntes texto={deAntes} actualizando={actualizando} />
            ) : (
              <>
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-1.5 animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-success" />
                </span>
                <span className="text-[11px] text-muted-foreground">en vivo</span>
              </>
            )}

            {etapaFiltro && (
              <button
                type="button"
                onClick={() => setEtapaFiltro(null)}
                className="flex items-center gap-1 rounded-full bg-navy px-2.5 py-0.5 text-[11px] font-semibold capitalize text-white"
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
                      'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ' +
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
                  'ml-1 flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ' +
                  (soloCalientes ? 'border-gold-ink bg-gold/15 text-gold-ink' : 'border-border text-muted-foreground hover:text-foreground')
                }
              >
                <span className="size-1.5 rounded-full bg-gold-ink" /> Solo calientes
              </button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isPending ? (
              <div>
                {SKELETON_RADAR.map(([w1, w2], i) => (
                  <div key={i} className="border-b border-border/70 px-4 py-2 last:border-b-0">
                    <div className={'h-3 animate-pulse rounded bg-muted ' + w1} />
                    <div className={'mt-1.5 h-3 animate-pulse rounded bg-muted ' + w2} />
                  </div>
                ))}
              </div>
            ) : filas.length === 0 ? (
              <p className="px-6 py-14 text-center text-xs leading-relaxed text-muted-foreground">
                {/* para sistemas: conectar Bravo → Hermes está en el runbook §9 (docs/plan-hermes-mvp.md). */}
                {fuente === 'landing'
                  ? 'Las landings todavía no llegan a Hermes — falta que Sistemas conecte Bravo. No es que no caigan.'
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
              <>
                {filas.map((fila) => {
                  const esChat = 'chat' in fila;
                  const base = esChat ? fila.chat : fila.form;
                  const clave = base.clave;
                  const etapa =
                    data!.etapas[clave] ?? (esChat ? 'interesado' : fila.form.estado_lead === 'nuevo' ? 'interesado' : fila.form.estado_lead);
                  const alta = esDeuda(fila.nivel);
                  const tags = data!.etiquetas[clave] ?? [];
                  const pais = paisDe(base.pais_dato, esChat ? fila.chat.telefono : fila.form.telefono);
                  const horas = (Date.now() - new Date(base.cayo_at).getTime()) / 3_600_000;
                  const clickeable = esChat || Boolean(fila.form.telefono);
                  const abrir = () => (esChat ? onAbrir(conversacionDeChat(fila.chat)) : onBuscarPersona(fila.form.telefono!));
                  const esNueva = nuevas.has(clave);

                  return (
                    <div
                      key={clave}
                      role={clickeable ? 'button' : undefined}
                      tabIndex={clickeable ? 0 : undefined}
                      onClick={clickeable ? abrir : undefined}
                      onKeyDown={
                        clickeable
                          ? (e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                abrir();
                              }
                            }
                          : undefined
                      }
                      className={
                        'group border-b border-border/70 border-l-[3px] px-4 py-2 transition-colors last:border-b-0 ' +
                        tempBorde(base.cayo_at) +
                        (clickeable ? ' cursor-pointer hover:bg-accent' : '') +
                        (esNueva ? ' animate-entrar bg-secondary' : '')
                      }
                    >
                      {/* L1: caliente + canal + atribución + etapa */}
                      <div className="flex items-center gap-2">
                        {alta && <span title="caliente" className="size-1.5 shrink-0 rounded-full bg-gold-ink" />}
                        {esChat ? <BadgeCanal canal={fila.chat.canal} size={13} /> : null}
                        <span className="truncate text-[11px] text-muted-foreground">
                          {esChat
                            ? `${fila.fuente === 'comentario' ? 'Comentario' : nombreCanal(fila.chat.canal)}${fila.chat.contexto_texto ? ` · “${fila.chat.contexto_texto.slice(0, 48)}”` : ''}`
                            : `${fila.fuente === 'landing' ? 'Landing' : 'Lead Ad'} · ${fila.form.producto ?? fila.form.campana ?? 'sin campaña'}${fila.form.flyer && fila.form.flyer !== 'ORGANICO' ? ` · ${fila.form.flyer}` : ''}`}
                        </span>
                        <span className={'ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ' + (ETAPA_CHIP[etapa] ?? ETAPA_CHIP.interesado)}>
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
                        {pais && <span className="shrink-0 font-mono text-[11px] text-muted-foreground" title={pais}>{pais}</span>}
                        {tags.map((t) => (
                          <span key={t} className="shrink-0 rounded-md border border-border px-1.5 text-[11px] leading-4 text-muted-foreground">
                            {t}
                          </span>
                        ))}
                        <EtiquetaInline clave={clave} />
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                          <span
                            className={
                              'font-mono text-[11px] tabular-nums ' +
                              (esChat && horas > 20 && horas < 24 ? 'text-gold-ink' : tempClass(base.cayo_at))
                            }
                            title={new Date(base.cayo_at).toLocaleString('es')}
                          >
                            {hace(horas)}
                          </span>
                          <span className="flex items-center gap-1.5 text-muted-foreground transition-colors focus-within:text-navy group-hover:text-navy">
                            {(esChat ? fila.chat.telefono : fila.form.telefono) && (
                              <BotonLlamar telefono={(esChat ? fila.chat.telefono : fila.form.telefono)!} compacto />
                            )}
                            {esChat ? (
                              <MessageSquareText size={13} />
                            ) : fila.form.telefono ? (
                              <button
                                type="button"
                                title="Ver en Contactos"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onBuscarPersona(fila.form.telefono!);
                                }}
                                className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 active:scale-[0.96]"
                              >
                                <Search size={13} />
                              </button>
                            ) : fila.form.correo ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => copiarCorreo(fila.form.correo!, clave)}
                                  className="rounded px-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 active:scale-[0.98]"
                                >
                                  {correoCopiado === clave ? 'Copiado' : 'Copiar correo'}
                                </button>
                                {onMandarCorreo && (
                                  <button
                                    type="button"
                                    onClick={() => onMandarCorreo(fila.form.correo!)}
                                    className="rounded px-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 active:scale-[0.98]"
                                  >
                                    Mandar correo
                                  </button>
                                )}
                              </>
                            ) : null}
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })}
                {totalFiltradas > 80 && (
                  <p className="py-3 text-center text-[11px] text-muted-foreground">
                    Mostrando los 80 más recientes de {totalFiltradas} — afiná los filtros para ver el resto.
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        {/* ── C · EL RIEL: Embudo → Los últimos 14 días → Qué piden → Equipo ── */}
        <aside className="flex w-80 shrink-0 flex-col gap-2.5 overflow-y-auto">
          {/* C1 · Embudo: UNA barra segmentada, click filtra */}
          <section className="rounded-xl bg-card p-3.5 shadow-panel">
            <h3 className="text-xs font-medium text-foreground">
              <span className="font-mono tabular-nums">{totalEmbudo}</span> en el embudo
            </h3>
            {isPending ? (
              <div className="mt-2.5 h-2 animate-pulse rounded-full bg-muted" />
            ) : totalEmbudo === 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                El embudo se arma cuando los leads cambian de etapa en Mensajes o el Pipeline.
              </p>
            ) : (
              <>
                <BarraSegmentada
                  className="mt-2.5"
                  segmentos={ETAPAS.map((e, i) => ({ id: e, n: data?.embudo[e] ?? 0, color: colorSegmento(e, i) }))}
                  activo={etapaFiltro}
                  onSegmento={(id) => setEtapaFiltro(etapaFiltro === id ? null : id)}
                />
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
                  {ETAPAS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setEtapaFiltro(etapaFiltro === e ? null : e)}
                      className={
                        'font-mono text-[11px] tabular-nums transition-colors ' +
                        (etapaFiltro === e ? 'font-bold text-navy' : 'text-muted-foreground hover:text-foreground')
                      }
                    >
                      {data?.embudo[e] ?? 0} {e}
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* C2 · Los últimos 14 días: la serie de leads, quieta y honesta */}
          <section className="rounded-xl bg-card p-3.5 shadow-panel">
            <h3 className={sectionLabel}>Los últimos 14 días</h3>
            {isPending ? (
              <div className="mt-2.5 flex h-16 items-end gap-[2px] border-b border-border pb-px">
                {SKELETON_COLUMNAS.map((h, i) => (
                  <div key={i} className="min-w-0 flex-1 animate-pulse rounded-t-[2px] bg-muted" style={{ height: `${h}%` }} />
                ))}
              </div>
            ) : puntosLeads.length === 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                La serie de los últimos 14 días todavía no llega.{' '}
                <span className="font-mono">para sistemas: series.leads_dia en /api/dashboard</span>
              </p>
            ) : (
              <div className="mt-2.5">
                <Columnas puntos={puntosLeads} resumen={resumenLeads} unidad="leads" />
              </div>
            )}
          </section>

          {/* C3 · Qué piden */}
          <section className="rounded-xl bg-card p-3.5 shadow-panel">
            <h3 className={sectionLabel}>Qué piden</h3>
            {isPending ? (
              <div className="mt-2 space-y-1.5">
                {['w-full', 'w-4/5', 'w-3/5', 'w-5/6', 'w-2/3'].map((w) => (
                  <div key={w} className={'h-3 animate-pulse rounded bg-muted ' + w} />
                ))}
              </div>
            ) : (data?.cursos.length ?? 0) === 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Nadie mencionó un curso todavía — los intereses se registran desde el chat o al cotizar.
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-1.5">
                {data!.cursos.slice(0, 5).map((c, i) => (
                  <div key={c.curso} className="flex items-center gap-2 text-xs">
                    <span className="w-3 shrink-0 font-mono text-[11px] text-muted-foreground">{i + 1}</span>
                    <span className={'min-w-0 flex-1 truncate ' + (i === 0 ? 'font-semibold text-foreground' : 'text-foreground')} title={c.curso}>
                      {c.curso}
                    </span>
                    <span className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full bg-secondary-foreground/50" style={{ width: `${(c.n / maxCurso) * 100}%` }} />
                    </span>
                    <span className="w-5 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{c.n}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* C4 · Equipo — el único kicker de la vista; la chispa es el pulso */}
          <section className="rounded-xl bg-card p-3.5 shadow-panel">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className={kicker}>Equipo</h3>
                {enviosValores.length >= 2 && (
                  <Chispa
                    valores={enviosValores}
                    etiqueta={`Mensajes enviados por día, últimos 14 días: hoy ${enviosValores[enviosValores.length - 1] ?? 0}`}
                    ancho={64}
                    alto={20}
                    className="text-navy"
                  />
                )}
              </div>
              <div className="flex rounded-full border border-border p-0.5">
                {(['hoy', '7d'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriodo(p)}
                    className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + (periodo === p ? 'bg-navy text-white' : 'text-muted-foreground')}
                  >
                    {p === 'hoy' ? 'Hoy' : '7d'}
                  </button>
                ))}
              </div>
            </div>
            {isPending ? (
              <div className="mt-2 space-y-1.5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-6 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : equipo.length === 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                Nadie registró actividad todavía — el día arranca con la primera respuesta.
              </p>
            ) : (
              <div className="mt-2">
                <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
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
                    <div key={v.vendedora} className="flex items-center gap-2 border-t border-border/60 py-1.5 text-xs">
                      <span
                        title={soyYo ? 'vos' : undefined}
                        className={
                          'flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-secondary font-heading text-[11px] font-bold text-navy' +
                          (soyYo ? ' ring-2 ring-navy' : '')
                        }
                      >
                        {inicialesDe(v.vendedora)}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{v.vendedora}</span>
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
