import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bot, MessageSquareText, Search, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/datos/cliente';
import { hace } from '../../lib/datos/frescura';
import { iniciales } from '../../lib/iniciales';
import { useSelloDeViejo } from '../../lib/datos/useSelloDeViejo';
import { SelloDeAntes } from '../../components/SelloDeAntes';
import { tempBorde, tempClass } from '../../lib/formato';
import { kicker, sectionLabel } from '../../lib/styles';
import { ETAPAS, ETAPA_CHIP, colorSegmento, rotuloEtapa } from '../../lib/etapas';
import { Columnas } from '../../components/graficos/Columnas';
import { BarraSegmentada } from '../../components/graficos/BarraSegmentada';
import { Chispa } from '../../components/graficos/Chispa';
import { BadgeCanal, nombreCanal } from '../canales/BadgeCanal';
import { HojaContacto } from '../panel/HojaContacto';
import type { Conversacion } from '../canales/conversaciones';
import { conversacionDeRecordatorio, useAgenda, type Recordatorio } from '../agenda/agenda';
import { conversacionDeTelefono } from '../canales/conversacionNueva';
import { useSesionWa } from '../whatsapp/conversacionWa';
import {
  conversacionDeChat,
  paisDe,
  esDeuda,
  useDashboard,
  type LeadChat,
  type LeadFormulario,
} from './dashboard';
import { textoDePreview } from '../../lib/preview';
import { marcaDeFila, TINTA_MARCA } from './marca';
import { useNegocio } from './negocio';
import { FiltrosNegocio, PanelNegocio, type FiltrosNegocioState } from './PanelNegocio';
import { BotonLlamar } from '../gestion/BotonLlamar';

/**
 * EL DASHBOARD — DOS LECTURAS de la misma mesa, en un conmutador (#128, #126).
 *
 * · **Mi turno** — el radar de la vendedora: «¿a quién atiendo ahora?». Es lo
 *   que sigue abajo y es el default: quien abre Hermes casi siempre viene a eso.
 * · **El negocio** — la del que pone la plata: «¿qué curso se está vendiendo,
 *   cuál estoy dejando pasar, y en qué anuncio conviene invertir?»
 *   (`PanelNegocio.tsx`).
 *
 * Son dos pantallas y no dos mitades de una porque son dos personas con dos
 * ritmos, y esta app NO scrollea: apiladas, ninguna de las dos se lee. La BANDA
 * de arriba es la bisagra — mantiene el conmutador siempre en el mismo lugar y
 * NO cambia de altura al conmutar (h-16 fija): a la izquierda el conmutador, a
 * la derecha lo que cada lectura necesita — el titular y la agenda en «Mi
 * turno», la fila de filtros en «El negocio». Cero salto de layout.
 *
 * ─── MI TURNO ──────────────────────────────────────────────────────────────
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
  /**
   * LA FICHA AL COSTADO, TAMBIÉN ACÁ (ADR 0037, PR #292).
   *
   * El radar contesta «¿a quién atiendo?», y la pregunta que sigue —«¿quién es
   * esta persona?»— se contestaba yéndose a Mensajes: se perdía el radar y había
   * que volver. Es el mismo problema que la hoja ya cerró en Pipeline y en el
   * padrón, y no había motivo para que el Dashboard fuera la excepción.
   */
  const [ficha, setFicha] = useState<Conversacion | null>(null);

  // Renombrados como en la cola (`conversaciones.ts`): el vocabulario de
  // react-query no cruza hacia las vistas.
  const { data, isPending, dataUpdatedAt: traidoEn, isFetching: actualizando } = useDashboard();
  // Al abrir la app el radar viene del caché persistido. Mientras eso sea lo que
  // se ve, «en vivo» sería mentira: el sello dice de cuándo es hasta que llega
  // lo fresco (ver `lib/datos/persistencia.ts`).
  const deAntes = useSelloDeViejo(traidoEn);
  const { agenda } = useAgenda();
  const [fuente, setFuente] = useState<(typeof FUENTES)[number]['id']>('');
  /**
   * La línea propia para la clave de una ficha SIN hilo (un lead de formulario).
   * Sin WhatsApp conectado queda `null` y la ficha se abre igual — el porqué
   * está escrito en `conversacionDeTelefono`. Mismo uso que en el padrón.
   */
  const { data: sesionWa } = useSesionWa();
  const miLinea = sesionWa?.estado === 'conectado' ? sesionWa.telefono : null;
  const [etapaFiltro, setEtapaFiltro] = useState<string | null>(null);
  const [soloCalientes, setSoloCalientes] = useState(false);
  const [periodo, setPeriodo] = useState<'hoy' | '7d'>('hoy');
  const [correoCopiado, setCorreoCopiado] = useState<string | null>(null);

  // ── Las dos lecturas. El default es el radar: quien abre Hermes viene a atender. ──
  const [lectura, setLectura] = useState<'turno' | 'negocio'>('turno');
  const [filtros, setFiltros] = useState<FiltrosNegocioState>({ periodo: '7d', numero: null, dimension: 'curso' });

  /**
   * DE QUIÉN ES ESTE DASHBOARD (5-ago-2026). Lo decide el SERVER y viaja en la
   * respuesta: acá no hay lista de supervisores ni recorte propio — un recorte
   * hecho en el navegador sería cosmético, los datos ya viajaron.
   *
   * ⚠️ **`?? true` y no `?? false`.** El campo falta en dos casos reales: un
   * server viejo, y una respuesta rehidratada del caché de IndexedDB (ADR 0007).
   * Con `false` por default, «El negocio» desaparecería **para todos, incluido
   * el supervisor**, en la ventana entre el deploy del front (N4, sin restart) y
   * el del server (N5, a botón). Ausente = como era antes.
   */
  const puedeVerNegocio = data?.supervisor ?? true;
  /** El server sirvió SOLO lo asignado a quien mira. Lo que explica los huecos. */
  const soloMisAsignadas = data?.soloMisAsignadas ?? false;
  const negocio = useNegocio({ ...filtros, activo: lectura === 'negocio' && puedeVerNegocio });

  // Si estaba en «El negocio» y la respuesta dice que no le toca, vuelve al radar.
  // Pasa de verdad: el caché persistido pinta la pantalla antes de que llegue lo
  // fresco, así que la primera respuesta del server puede cambiar la respuesta.
  const lecturaEfectiva = lectura === 'negocio' && !puedeVerNegocio ? 'turno' : lectura;

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

  /**
   * Con el Dashboard personal, los chips de lo que NO tiene dueño no se dibujan.
   *
   * Un lead de formulario y un comentario de FB/IG no se reparten —el reparto
   * asigna conversaciones, y su clave es `int:<id>`— así que para quien ve solo
   * lo suyo esos chips serían ceros permanentes: tres botones que no filtran
   * nada y que se leen como «hoy no cayó ninguno», que es distinto de «esto no
   * te toca». El mismo criterio de los chips del bot: se dibujan donde tienen
   * algo que decir.
   */
  const fuentesVisibles = soloMisAsignadas
    ? FUENTES.filter((f) => f.id === '' || f.id === 'chat')
    : FUENTES;

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

  // El server ya apartó lo que firma el software (`dashboard/equipo.ts`). Un
  // server viejo —o una respuesta rehidratada del caché de IndexedDB, ADR 0007—
  // no manda el campo: `undefined` y el renglón no se dibuja, que es exactamente
  // el comportamiento de antes.
  const automaticos = data?.automaticos ?? null;

  const copiarCorreo = (correo: string, clave: string) => {
    void navigator.clipboard.writeText(correo);
    setCorreoCopiado(clave);
    window.setTimeout(() => setCorreoCopiado((v) => (v === clave ? null : v)), 2000);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3">
      {/* ═══ A · LA BANDA — el conmutador fijo + lo que cada lectura necesita.
              Altura fija h-16 en las DOS: conmutar no mueve nada de lugar. ═══ */}
      <section className="flex h-16 shrink-0 items-center gap-3 overflow-hidden rounded-2xl bg-card px-4 shadow-panel">
        {/* El conmutador solo existe si hay entre qué conmutar: para quien no ve
            «El negocio», un segmentado de un solo segmento es un botón que no
            hace nada. En su lugar va el rótulo de qué se está mirando — que ahora
            hace falta, porque el radar dejó de ser el de todos. */}
        {puedeVerNegocio ? (
          <div className="flex shrink-0 rounded-full bg-muted p-0.5">
            {(
              [
                ['turno', 'Mi turno'],
                ['negocio', 'El negocio'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLectura(id)}
                aria-pressed={lecturaEfectiva === id}
                className={
                  'rounded-full px-3 py-1 text-xs font-bold transition-[background-color,color] duration-200 ease-house ' +
                  (lecturaEfectiva === id ? 'bg-card text-navy shadow-panel' : 'text-muted-foreground hover:text-foreground')
                }
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="shrink-0 font-heading text-xs font-bold text-navy">Mi turno</h2>
        )}
        <span className="h-7 w-px shrink-0 bg-border" aria-hidden="true" />

        {lecturaEfectiva === 'negocio' ? (
          <FiltrosNegocio valor={filtros} onCambio={setFiltros} datos={negocio.data} />
        ) : (
          <>
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
          </>
        )}
      </section>

      {lecturaEfectiva === 'negocio' && (
        <PanelNegocio
          datos={negocio.data}
          cargando={negocio.isPending || (negocio.isFetching && !negocio.data)}
          actualizando={negocio.isFetching && Boolean(negocio.data)}
          dimension={filtros.dimension}
        />
      )}

      {/* ═══ B + C — MI TURNO ═══ */}
      <div className={'min-h-0 flex-1 gap-2.5 ' + (lecturaEfectiva === 'turno' ? 'flex' : 'hidden')}>
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
                className="flex items-center gap-1 rounded-full bg-navy px-2.5 py-0.5 text-[11px] font-semibold text-white"
              >
                {rotuloEtapa(etapaFiltro, 'varios')} <X size={10} />
              </button>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-1">
              {fuentesVisibles.map((f) => {
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
                  : /* 🔴 EL VACÍO TIENE QUE DECIR SU MOTIVO. Con el Dashboard
                       personal, «nada cayó» sería FALSO: cayó, no es tuyo. Y sin
                       el motivo, la vendedora lee «se rompió algo» o «hoy no hay
                       trabajo», que son las dos conclusiones equivocadas. */
                    soloMisAsignadas && !fuente && !etapaFiltro && !soloCalientes
                    ? 'Todavía no tenés conversaciones asignadas. Acá aparecen las que te reparte el supervisor — no es que no haya caído nada.'
                    : soloMisAsignadas
                      ? 'Ninguna de las tuyas con estos filtros. Este radar muestra solo lo que te asignaron.'
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
                  // Por qué esta fila está donde está (#22, #23). Un formulario no
                  // tiene Ventana —no hay comentario público del que colgarse— ni
                  // agenda, así que no tiene nada que explicar.
                  const marca = esChat
                    ? marcaDeFila({
                        nivel: fila.nivel,
                        ventana_dias: fila.chat.ventana_dias,
                        seguimiento_nota: fila.chat.seguimiento_nota,
                      })
                    : null;
                  // Con la Ventana cerrada ya no se puede escribir en privado, así
                  // que la fila deja de ofrecerlo: un botón que no lleva a ningún
                  // lado enseña a desconfiar de todos los demás. `null` es WhatsApp,
                  // donde no hay ventana y siempre se puede escribir.
                  const puedeEscribirPrivado = !esChat || fila.chat.ventana_dias == null || fila.chat.ventana_dias > 0;
                  const clickeable = esChat || Boolean(fila.form.telefono);
                  /**
                   * EL CLIC ABRE LA FICHA AL COSTADO, no conmuta de vista.
                   *
                   * Antes saltaba a Mensajes, y eso costaba el radar entero para
                   * responder «¿quién es?». Ahora es el mismo gesto que en
                   * Pipeline: la hoja se superpone, se puede tocar otra fila y
                   * cambia de persona sin cerrarse — que es lo que se hace
                   * mientras se elige a quién atender.
                   *
                   * El salto a Mensajes NO se pierde: vive en el botón de
                   * escribir de la fila, que es donde corresponde una acción
                   * que te saca de acá.
                   *
                   * 🔴 **Y UN FORMULARIO TAMBIÉN ABRE LA FICHA** (8-ago-2026).
                   * Acá decía «un formulario sin chat no tiene ficha que
                   * mostrar, así que sigue yendo al buscador», y era falso: la
                   * ficha de un lead es justo lo que hace falta —quién es, de
                   * qué landing vino, cuándo llenó, si ya compró— y la mitad
                   * que responde eso se busca por TELÉFONO, no por hilo. Es
                   * exactamente el caso que `conversacionDeTelefono` existe
                   * para cubrir (ADR 0035, el padrón: 72.923 personas que
                   * nunca escribieron y sí tienen ficha).
                   *
                   * Lo que se ve es la verdad: timeline, señales e intereses
                   * vacíos —porque no hay hilo— y la ficha de Cerberus + el
                   * lead-form completos. Mandar al buscador costaba el radar
                   * entero para responder «¿quién es este?».
                   */
                  const abrir = () =>
                    esChat
                      ? setFicha(conversacionDeChat(fila.chat))
                      : setFicha(
                          conversacionDeTelefono({
                            telefono: fila.form.telefono!,
                            numeroPropio: miLinea,
                            nombre: fila.form.persona_nombre,
                          }),
                        );
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
                      {/* L1 · QUIÉN — metadato en voz chica: canal, nombre, país,
                          etiquetas, la marca que explica la posición, y a la
                          derecha el reloj y la etapa. Todo esto ANTES ocupaba el
                          renglón principal y tapaba lo único que contesta el
                          «por qué a ese» (#20). */}
                      <div className="flex items-center gap-2">
                        {/* El grupo de la izquierda CEDE espacio (min-w-0): sin esto
                            la suma de metadatos desborda la fila en una ventana
                            angosta y el radar aparece con scroll horizontal — que
                            en esta app no existe, se scrollea solo el riel. */}
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {alta && <span title="caliente" className="size-1.5 shrink-0 rounded-full bg-gold-ink" />}
                          {esChat ? <BadgeCanal canal={fila.chat.canal} size={13} /> : null}
                          <span className="max-w-[40%] shrink truncate text-[11px] font-semibold text-foreground">
                            {base.persona_nombre ?? (
                              <span className="font-mono font-normal text-muted-foreground">
                                {(esChat ? fila.chat.telefono : (fila.form.telefono ?? fila.form.correo)) ?? 'sin dato'}
                              </span>
                            )}
                          </span>
                          {pais && <span className="shrink-0 font-mono text-[11px] text-muted-foreground" title={pais}>{pais}</span>}
                          {/* El nombre del canal es lo PRIMERO que se sacrifica si
                              falta lugar: el badge de la izquierda ya lo dice. */}
                          <span className="min-w-0 shrink truncate font-mono text-[11px] text-muted-foreground">
                            {esChat
                              ? fila.fuente === 'comentario'
                                ? 'Comentario'
                                : nombreCanal(fila.chat.canal)
                              : fila.fuente === 'landing'
                                ? 'Landing'
                                : 'Lead Ad'}
                          </span>
                          {tags.map((t) => (
                            <span key={t} className="shrink-0 rounded-md border border-border px-1.5 text-[11px] leading-4 text-muted-foreground">
                              {t}
                            </span>
                          ))}
                          <EtiquetaInline clave={clave} />
                          {/* La marca trunca en vez de empujar: vale más una marca
                              recortada que una fila que se sale de la pantalla. */}
                          {marca && (
                            <span
                              title={marca.texto}
                              className={'min-w-0 shrink truncate text-[11px] font-semibold ' + TINTA_MARCA[marca.tono]}
                            >
                              {marca.texto}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span
                            className={
                              'font-mono text-[11px] tabular-nums ' +
                              (esChat && horas > 20 && horas < 24 ? 'text-gold-ink' : tempClass(base.cayo_at))
                            }
                            title={new Date(base.cayo_at).toLocaleString('es')}
                          >
                            {hace(horas)}
                          </span>
                          {/* El chip de UNA conversación: singular, y por el rótulo
                              canónico — antes pintaba el IDENTIFICADOR crudo con un
                              `capitalize` de CSS, que con ids de una palabra se veía
                              bien de casualidad. */}
                          <span className={'rounded-full px-2 py-0.5 text-[11px] font-semibold ' + (ETAPA_CHIP[etapa] ?? ETAPA_CHIP.interesado)}>
                            {rotuloEtapa(etapa)}
                          </span>
                        </span>
                      </div>

                      {/* L2 · QUÉ DIJO — el renglón principal. Es el único campo
                          que contesta «¿por qué a ese?», y viajaba desde el server
                          sin que nadie lo pintara. Un formulario no tiene mensaje:
                          su equivalente es el producto que pidió. */}
                      <div className="mt-0.5 flex items-center gap-2">
                        {esChat && fila.chat.pregunto && (
                          <span className="shrink-0 rounded bg-primary/10 px-1 py-px text-[11px] font-semibold text-primary">
                            Preguntó
                          </span>
                        )}
                        <p className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                          {esChat
                            ? textoDePreview({
                                texto: fila.chat.texto,
                                clase: fila.chat.texto_clase,
                                origen: fila.chat.texto_origen,
                                soloClic: fila.chat.solo_clic,
                              })
                            : (fila.form.producto ?? fila.form.campana ?? 'sin campaña')}
                        </p>
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                          <span className="flex items-center gap-1.5 text-muted-foreground transition-colors focus-within:text-navy group-hover:text-navy">
                            {(esChat ? fila.chat.telefono : fila.form.telefono) && (
                              <BotonLlamar telefono={(esChat ? fila.chat.telefono : fila.form.telefono)!} compacto />
                            )}
                            {esChat ? (
                              /* ⚠️ ESTE ÍCONO ERA DECORATIVO Y AHORA HACE ALGO.
                                 Mientras el clic de la fila saltaba a Mensajes,
                                 alcanzaba con insinuar «acá se puede escribir».
                                 Ahora la fila abre la ficha al costado, así que
                                 el salto necesita su propia puerta — y esta es
                                 la que ya prometía serlo. `stopPropagation`
                                 porque la fila entera es clicable. */
                              puedeEscribirPrivado ? (
                                <button
                                  type="button"
                                  title="Escribirle — abre la conversación en Mensajes"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onAbrir(conversacionDeChat(fila.chat));
                                  }}
                                  className="rounded p-0.5 transition-colors hover:text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                >
                                  <MessageSquareText size={13} />
                                </button>
                              ) : null
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

                      {/* L3 · DÓNDE lo dijo — solo para comentarios, y solo si hay
                          contexto. Antes iba pegado a la atribución en L1, donde
                          competía con el nombre; acá abajo no le quita renglón a
                          nada y sigue diciendo bajo qué publicación comentó. */}
                      {esChat && fila.fuente === 'comentario' && fila.chat.contexto_texto && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          en “{fila.chat.contexto_texto}”
                        </p>
                      )}
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
                  segmentos={ETAPAS.map((e, i) => ({
                    id: e,
                    n: data?.embudo[e] ?? 0,
                    color: colorSegmento(e, i),
                    // Sin esto el `title` y el `aria-label` de la barra dicen el id.
                    label: rotuloEtapa(e, 'varios'),
                  }))}
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
                      {/* La leyenda del riel: contaba montones y decía el IDENTIFICADOR
                          en minúscula («611 cotizado»). Es el mismo defecto que el chip
                          de la fila, en el mismo panel — lo destapó la captura, no un test. */}
                      {data?.embudo[e] ?? 0} {rotuloEtapa(e, 'varios')}
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
                {/* Honestidad: esto lee `intereses`, que se llena TIPEANDO. En prod
                    tiene un solo registro, así que este vacío es lo normal, no una
                    falla — y el dato bueno (el curso que la persona eligió en el
                    formulario) ya está, del otro lado del conmutador. */}
                Nadie tipeó un curso todavía — los intereses se registran a mano desde el chat o al cotizar.{' '}
                {/* ⚠️ El atajo a «El negocio» solo se ofrece a quien puede
                    abrirlo. Para el resto sería un callejón: un link a una
                    pantalla que no existe en su app, y el 403 del server
                    esperándolo del otro lado. */}
                {puedeVerNegocio && (
                  <button type="button" onClick={() => setLectura('negocio')} className="font-semibold text-primary hover:underline">
                    El curso que eligieron en el formulario está en El negocio →
                  </button>
                )}
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
                {/* Con una sola fila —la propia— «Equipo» es un rótulo falso: no
                    hay equipo del que este cuadro hable. */}
                <h3 className={kicker}>{soloMisAsignadas ? 'Vos' : 'Equipo'}</h3>
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
            ) : equipo.length === 0 && !automaticos ? (
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
                {equipo.length === 0 && (
                  <p className="border-t border-border/60 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    {soloMisAsignadas
                      ? 'Todavía no registraste actividad hoy.'
                      : 'Nadie del equipo registró actividad todavía.'}
                  </p>
                )}
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
                        {iniciales(v.vendedora)}
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
                {/* Lo que mandó el SOFTWARE — `bot` y `goberna-admin` firman
                    `envios_wa` igual que una vendedora, y salían como filas del
                    equipo (537 de 620 envíos el 4-ago). Va como RENGLÓN y no
                    como fila: sin avatar de iniciales ni ring de «vos», porque
                    no es alguien. Pero va: borrarlo dejaría el cuadro diciendo
                    que el equipo mandó 83 mensajes cuando salieron 620, y esa
                    resta invisible es peor que el ruido que vino a sacar.
                    `conv` y `vtas` son «—» de verdad: las conversaciones son un
                    DISTINCT por actor y sumarlas contaría dos veces a quien
                    atendieron los dos. */}
                {automaticos && (
                  <div
                    className="flex items-center gap-2 border-t border-border/60 py-1.5 text-[11px] text-muted-foreground"
                    title={`No son del equipo: ${automaticos.quienes.join(', ')}`}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center">
                      <Bot size={13} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">Automático</span>
                    <span className="w-9 text-right">—</span>
                    <span className="w-9 text-right font-mono tabular-nums">
                      {periodo === 'hoy' ? automaticos.mensajes_hoy : automaticos.mensajes_7d}
                    </span>
                    <span className="w-9 text-right">—</span>
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>

      {/* LA FICHA AL COSTADO — el mismo molde que Pipeline y el padrón.
          Se superpone sin scrim a propósito: tapar el radar del que se está
          eligiendo haría falsa la pregunta que el radar contesta. Se puede
          tocar otra fila y la hoja cambia de persona sin cerrarse. */}
      {ficha && (
        <HojaContacto
          conversacion={ficha}
          onCerrar={() => setFicha(null)}
          miVendedora={miVendedora}
        />
      )}
    </div>
  );
}
