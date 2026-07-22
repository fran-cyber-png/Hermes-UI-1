import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Check, Loader2, Tag, X } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import type { Conversacion } from '../canales/conversaciones';
import { opcionesRapidas, useAgenda } from '../agenda/agenda';
import { BotonLlamar } from './BotonLlamar';
import { Intereses } from './Intereses';

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

/** Etiquetas inline: chips + agregar, contra el endpoint compartido del equipo. */
function EtiquetasInline({ clave }: { clave: string }) {
  const qc = useQueryClient();
  const { data: lista = [] } = useQuery({
    queryKey: ['etiquetas', clave],
    queryFn: () => api<{ etiquetas: Record<string, string[]> }>(`/api/gestiones/etiquetas?claves=${encodeURIComponent(clave)}`),
    select: (d) => d.etiquetas[clave] ?? [],
  });
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState('');

  const invalidar = () => {
    void qc.invalidateQueries({ queryKey: ['etiquetas', clave] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const agregar = useMutation({
    mutationFn: (etiqueta: string) =>
      api('/api/gestiones/etiquetas', { method: 'POST', body: JSON.stringify({ clave, etiqueta }) }),
    onSuccess: () => {
      invalidar();
      setValor('');
      setAbierto(false);
    },
  });
  const quitar = useMutation({
    mutationFn: (etiqueta: string) =>
      api('/api/gestiones/etiquetas', { method: 'DELETE', body: JSON.stringify({ clave, etiqueta }) }),
    onSuccess: invalidar,
  });

  return (
    <span className="flex items-center gap-1">
      <Tag size={11} className="shrink-0 text-muted-foreground" />
      {lista.map((t) => (
        <span key={t} className="group/tag inline-flex items-center gap-0.5 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {t}
          <button
            type="button"
            aria-label={`Quitar ${t}`}
            onClick={() => quitar.mutate(t)}
            className="opacity-40 transition-opacity focus-visible:opacity-100 group-hover/tag:opacity-100"
          >
            <X size={9} />
          </button>
        </span>
      ))}
      {abierto ? (
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valor.trim()) agregar.mutate(valor.trim());
            if (e.key === 'Escape') {
              e.stopPropagation();
              setAbierto(false);
            }
          }}
          onBlur={() => setAbierto(false)}
          autoFocus
          placeholder="etiqueta…"
          className="w-20 rounded-md border border-primary bg-card px-1.5 py-0.5 text-[11px] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          title="Etiquetar"
          className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
        >
          +
        </button>
      )}
      {(agregar.isError || quitar.isError) && (
        <span className="text-[11px] text-destructive">No se guardó la etiqueta — probá de nuevo.</span>
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
          <span className="fixed inset-0 z-20" onClick={() => setAbierto(false)} aria-hidden="true" />
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
