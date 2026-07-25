import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Check, Loader2, Plus, Tag, X } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { usePopover } from '../../lib/teclado/usePopover';
import type { Conversacion } from '../canales/conversaciones';
import { opcionesRapidas, useAgenda } from '../agenda/agenda';
import { BotonLlamar } from './BotonLlamar';
import { Intereses } from './Intereses';
import { MenuHerramientas } from './MenuHerramientas';
import { useCategorias, useMutacionesCategorias } from './categorias';
import {
  CLASE_FONDO,
  CLASE_TEXTO,
  COLORES,
  NOMBRE_COLOR,
  claseBorde,
  normalizarNombre,
  resolverColor,
  type ColorCategoria,
} from './paletaCategorias';

/**
 * LA BARRA DE GESTIÓN — el embudo entero manejable DESDE el chat.
 *
 * Vive arriba de toda conversación abierta (WhatsApp, comentario, Messenger):
 * la ETAPA se cambia con un clic (las compuertas del server frenan y explican
 * acá mismo — y la barra señala DÓNDE destrabarla), las ETIQUETAS y los CURSOS
 * DE INTERÉS se agregan inline, y AGENDAR es un popover de dos toques. Perdido
 * vive aparte del segmented y pide confirmación: no es una etapa más, es tirar
 * la toalla.
 */

const ETAPAS_BARRA = [
  { id: 'interesado', label: 'Interesado' },
  { id: 'contactado', label: 'Contactado' },
  { id: 'cotizado', label: 'Cotizado' },
  { id: 'cierre', label: 'Cierre' },
] as const;

/**
 * Etiquetas inline: las CATEGORÍAS (con color) asignadas a esta conversación.
 *
 * La ASIGNACIÓN sigue contra el endpoint compartido del equipo
 * (`/api/gestiones/etiquetas`, por string); el COLOR se resuelve en el front
 * contra el catálogo de la vendedora (`/api/categorias`) — una etiqueta que
 * matchea una categoría del que mira toma su color; la que no, se pinta neutra.
 * El «+» elige de las categorías propias o crea una nueva (nombre + color de la
 * paleta) y la asigna en dos pasos. Regla dura: la píldora usa BORDE de color,
 * nunca sombra, nunca oro.
 */
function EtiquetasInline({ clave }: { clave: string }) {
  const qc = useQueryClient();
  const { data: lista = [] } = useQuery({
    queryKey: ['etiquetas', clave],
    queryFn: () => api<{ etiquetas: Record<string, string[]> }>(`/api/gestiones/etiquetas?claves=${encodeURIComponent(clave)}`),
    select: (d) => d.etiquetas[clave] ?? [],
  });
  const { data: categorias = [] } = useCategorias();
  const { crear } = useMutacionesCategorias();
  const [abierto, setAbierto] = useState(false);
  const [nuevo, setNuevo] = useState('');
  const [colorNuevo, setColorNuevo] = useState<ColorCategoria>('azul');

  // Antes solo cerraba con clic afuera: con el foco en el «+» (no en el input),
  // Escape no lo tocaba y llegaba al shell, que cerraba la conversación de atrás
  // y dejaba el panel flotando sobre otra cosa. El Escape de ADENTRO del input
  // lo sigue manejando el input, que es de quien es.
  const { propsOverlay } = usePopover(abierto, () => setAbierto(false), { z: 'z-20' });

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['etiquetas', clave] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['categorias'] });
  };
  const asignar = useMutation({
    mutationFn: (etiqueta: string) =>
      api('/api/gestiones/etiquetas', { method: 'POST', body: JSON.stringify({ clave, etiqueta }) }),
    onSuccess: invalidar,
  });
  const quitar = useMutation({
    mutationFn: (etiqueta: string) =>
      api('/api/gestiones/etiquetas', { method: 'DELETE', body: JSON.stringify({ clave, etiqueta }) }),
    onSuccess: invalidar,
  });

  const asignadas = new Set(lista);
  const disponibles = categorias.filter((c) => !asignadas.has(c.nombre));

  function crearYAsignar() {
    const limpio = normalizarNombre(nuevo);
    if (!limpio) return;
    // Dos pasos: crea la categoría (con color) y la asigna a esta conversación.
    crear.mutate(
      { nombre: limpio, color: colorNuevo },
      {
        onSettled: () => {
          asignar.mutate(limpio);
          setNuevo('');
          setAbierto(false);
        },
      },
    );
  }

  return (
    <span className="relative flex items-center gap-1">
      <Tag size={11} className="shrink-0 text-muted-foreground" />
      {lista.map((etq) => {
        const color = resolverColor(etq, categorias);
        return (
          <span
            key={etq}
            className={
              'group/tag inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] font-semibold ' +
              claseBorde(color) +
              (color ? ' ' + CLASE_TEXTO[color] : ' text-muted-foreground')
            }
          >
            {color && <span className={'h-1.5 w-1.5 rounded-full ' + CLASE_FONDO[color]} />}
            {etq}
            <button
              type="button"
              aria-label={`Quitar ${etq}`}
              onClick={() => quitar.mutate(etq)}
              className="opacity-40 transition-opacity focus-visible:opacity-100 group-hover/tag:opacity-100"
            >
              <X size={9} />
            </button>
          </span>
        );
      })}

      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        title="Asignar categoría"
        aria-label="Asignar categoría"
        className={
          'rounded-full border border-dashed px-1.5 py-0.5 text-[11px] transition-colors ' +
          (abierto
            ? 'border-primary text-foreground'
            : 'border-border text-muted-foreground hover:border-primary hover:text-foreground')
        }
      >
        +
      </button>

      {abierto && (
        <>
          <span {...propsOverlay} />
          <div className="absolute left-4 top-6 z-30 w-56 rounded-xl bg-card p-2 shadow-panel">
            {disponibles.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {disponibles.map((c) => {
                  const color = resolverColor(c.nombre, categorias);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        asignar.mutate(c.nombre);
                        setAbierto(false);
                      }}
                      className={
                        'inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 text-[11px] font-semibold transition-transform hover:scale-105 ' +
                        claseBorde(color) +
                        (color ? ' ' + CLASE_TEXTO[color] : ' text-muted-foreground')
                      }
                    >
                      {color && <span className={'h-1.5 w-1.5 rounded-full ' + CLASE_FONDO[color]} />}
                      {c.nombre}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="rounded-lg border border-border p-1.5">
              <div className="flex items-center gap-1">
                <input
                  value={nuevo}
                  maxLength={30}
                  onChange={(e) => setNuevo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') crearYAsignar();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setAbierto(false);
                    }
                  }}
                  autoFocus
                  placeholder="nueva categoría…"
                  className="min-w-0 flex-1 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] outline-none focus:border-primary"
                />
                <button
                  type="button"
                  aria-label="Crear y asignar"
                  onClick={crearYAsignar}
                  disabled={!normalizarNombre(nuevo) || crear.isPending}
                  className="flex items-center rounded-md bg-primary p-1 text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40"
                >
                  {crear.isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label="Elegir color">
                {COLORES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={NOMBRE_COLOR[c]}
                    aria-pressed={colorNuevo === c}
                    title={NOMBRE_COLOR[c]}
                    onClick={() => setColorNuevo(c)}
                    className={
                      'h-4 w-4 rounded-full transition-transform ' +
                      CLASE_FONDO[c] +
                      (colorNuevo === c ? ' scale-110 ring-2 ring-navy ring-offset-1 ring-offset-card' : ' hover:scale-110')
                    }
                  />
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {(asignar.isError || quitar.isError) && (
        <span className="text-[11px] text-destructive">No se guardó — probá de nuevo.</span>
      )}
    </span>
  );
}

/** Agendar en dos toques, sin salir del chat. */
function AgendarRapido({ conversacion }: { conversacion: Conversacion }) {
  const { crear } = useAgenda();
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState('');
  /** La etiqueta del chip clickeado — el spinner va solo ahí. */
  const [pendiente, setPendiente] = useState<string | null>(null);
  /** Qué quedó agendado («Mañana 9:00») — el botón lo confirma hasta el próximo gesto. */
  const [listo, setListo] = useState<string | null>(null);

  // Mismo agujero que en las etiquetas: sin el foco en la nota, Escape no cerraba
  // este panel y se lo llevaba el shell (adiós conversación de atrás).
  const { propsOverlay } = usePopover(abierto, () => setAbierto(false), { z: 'z-20' });

  async function agendar(o: { etiqueta: string; cuando: Date }) {
    setPendiente(o.etiqueta);
    try {
      await crear.mutateAsync({
        clave: conversacion.clave,
        canal: conversacion.canal,
        personaId: conversacion.persona_id,
        personaNombre: conversacion.persona_nombre,
        numeroPropio: conversacion.numero_propio,
        nota: nota.trim() || `Seguimiento a ${conversacion.persona_nombre ?? conversacion.persona_id ?? 'lead'}`,
        cuando: o.cuando.toISOString(),
      });
      setNota('');
      setAbierto(false);
      setListo(o.etiqueta);
    } catch {
      // El error queda visible en el popover vía crear.isError.
    } finally {
      setPendiente(null);
    }
  }

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => {
          setListo(null);
          setAbierto((v) => !v);
        }}
        title="Agendar seguimiento"
        className={
          'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ' +
          (listo ? 'bg-success/10 text-success' : abierto ? 'bg-navy text-white' : 'border border-border text-muted-foreground hover:border-primary hover:text-foreground')
        }
      >
        {listo ? <Check size={11} /> : <AlarmClock size={11} />}
        {listo ? `Agendado · ${listo}` : 'Agendar'}
      </button>
      {abierto && (
        <>
          <span {...propsOverlay} />
          <div className="absolute right-0 top-7 z-30 w-60 rounded-xl bg-card p-2.5 shadow-panel">
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setAbierto(false);
                }
              }}
              autoFocus
              placeholder="Qué vas a hacer (opcional)…"
              className="mb-2 w-full rounded-lg border border-border bg-muted/40 px-2 py-1.5 text-[11px] outline-none focus:border-primary"
            />
            <div className="flex flex-wrap gap-1.5">
              {opcionesRapidas().map((o) => (
                <button
                  key={o.etiqueta}
                  type="button"
                  disabled={pendiente != null}
                  onClick={() => void agendar(o)}
                  className="rounded-full border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:bg-secondary/40 hover:text-foreground disabled:opacity-50"
                >
                  {pendiente === o.etiqueta ? <Loader2 size={10} className="inline animate-spin" /> : o.etiqueta}
                </button>
              ))}
            </div>
            {crear.isError && (
              <p className="mt-1.5 text-[11px] text-destructive">No se agendó — probá de nuevo.</p>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">Cae en tu Agenda. Nada se envía solo.</p>
          </div>
        </>
      )}
    </span>
  );
}

export function BarraGestion({ conversacion }: { conversacion: Conversacion }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmaPerdido, setConfirmaPerdido] = useState(false);
  /** La compuerta guía: ring temporal + foco en el buscador de Intereses. */
  const [guiaIntereses, setGuiaIntereses] = useState(false);
  const [senalIntereses, setSenalIntereses] = useState(0);

  const { data } = useQuery({
    queryKey: ['gestiones', conversacion.clave],
    queryFn: () =>
      api<{ etapa: string | null }>(`/api/gestiones/de/${encodeURIComponent(conversacion.clave)}`),
  });
  const etapaActual = data?.etapa ?? 'interesado';

  const mover = useMutation({
    mutationFn: (etapa: string) =>
      api('/api/gestiones', {
        method: 'POST',
        body: JSON.stringify({
          clave: conversacion.clave,
          canal: conversacion.canal,
          personaId: conversacion.persona_id,
          personaNombre: conversacion.persona_nombre,
          numeroPropio: conversacion.numero_propio,
          etapa,
        }),
      }),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['gestiones', conversacion.clave] });
      void qc.invalidateQueries({ queryKey: ['embudo'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err, etapaIntentada) => {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo cambiar la etapa.');
      // La compuerta de Cotizado pide un interés: en vez de solo avisar, la
      // barra señala el control que la destraba y le pone el foco.
      if (etapaIntentada === 'cotizado') {
        setSenalIntereses((n) => n + 1);
        setGuiaIntereses(true);
        window.setTimeout(() => setGuiaIntereses(false), 2000);
      }
    },
  });

  return (
    <div className="shrink-0 rounded-2xl bg-card px-3 py-2 shadow-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* La etapa: un clic y quedó — las compuertas del server frenan y explican. */}
        <div className="flex items-center rounded-full border border-border bg-muted/40 p-0.5">
          {ETAPAS_BARRA.map((e) => (
            <button
              key={e.id}
              type="button"
              disabled={mover.isPending}
              onClick={() => etapaActual !== e.id && mover.mutate(e.id)}
              className={
                'rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ' +
                (etapaActual === e.id
                  ? e.id === 'cierre'
                    ? 'bg-success text-white'
                    : 'bg-navy text-white'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {e.label}
            </button>
          ))}
          {/* Perdido, fuera del segmented: no es una etapa más — pide confirmación. */}
          <span className="ml-1 flex items-center border-l border-border pl-1">
            {etapaActual === 'perdido' ? (
              <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-white">Perdido</span>
            ) : confirmaPerdido ? (
              <span className="flex items-center gap-1 px-1 text-[11px] font-semibold">
                <span className="text-muted-foreground">¿Perdido?</span>
                <button
                  type="button"
                  disabled={mover.isPending}
                  onClick={() => {
                    setConfirmaPerdido(false);
                    mover.mutate('perdido');
                  }}
                  className="rounded px-1 text-destructive transition-colors hover:bg-destructive/10"
                >
                  Sí
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmaPerdido(false)}
                  className="rounded px-1 text-muted-foreground transition-colors hover:text-foreground"
                >
                  No
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={mover.isPending}
                onClick={() => setConfirmaPerdido(true)}
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-destructive"
              >
                Perdido
              </button>
            )}
          </span>
        </div>

        <span className="hidden h-4 w-px bg-border sm:block" />
        <EtiquetasInline clave={conversacion.clave} />

        <span className="hidden h-4 w-px bg-border sm:block" />
        <Intereses clave={conversacion.clave} compacto resaltado={guiaIntereses} senalAbrir={senalIntereses} />

        <span className="ml-auto flex items-center gap-1.5">
          {conversacion.canal === 'whatsapp' && conversacion.persona_id && (
            <BotonLlamar telefono={conversacion.persona_id} />
          )}
          <AgendarRapido conversacion={conversacion} />
          <MenuHerramientas conversacion={conversacion} />
        </span>
      </div>

      {error && (
        <div className="mt-1.5 flex items-start justify-between gap-2 rounded-lg bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning-foreground">
          <span>{error}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setError(null)}
            className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
          >
            <X size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
