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
 * acá mismo), las ETIQUETAS y los CURSOS DE INTERÉS se agregan inline, y
 * AGENDAR es un popover de dos toques. Cero fricción: la vendedora gestiona
 * sin soltar la conversación.
 */

const ETAPAS = [
  { id: 'interesado', label: 'Interesado' },
  { id: 'contactado', label: 'Contactado' },
  { id: 'cotizado', label: 'Cotizado' },
  { id: 'cierre', label: 'Cierre' },
  { id: 'perdido', label: 'Perdido' },
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
          <button type="button" onClick={() => quitar.mutate(t)} className="opacity-0 transition-opacity group-hover/tag:opacity-100">
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
            if (e.key === 'Escape') setAbierto(false);
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
    </span>
  );
}

/** Agendar en dos toques, sin salir del chat. */
function AgendarRapido({ conversacion }: { conversacion: Conversacion }) {
  const { crear } = useAgenda();
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState('');
  const [listo, setListo] = useState(false);

  async function agendar(cuando: Date) {
    await crear.mutateAsync({
      clave: conversacion.clave,
      canal: conversacion.canal,
      personaId: conversacion.persona_id,
      personaNombre: conversacion.persona_nombre,
      numeroPropio: conversacion.numero_propio,
      nota: nota.trim() || `Seguimiento a ${conversacion.persona_nombre ?? conversacion.persona_id ?? 'lead'}`,
      cuando: cuando.toISOString(),
    });
    setNota('');
    setAbierto(false);
    setListo(true);
    window.setTimeout(() => setListo(false), 3000);
  }

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        title="Agendar seguimiento"
        className={
          'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ' +
          (listo ? 'bg-success/10 text-success' : abierto ? 'bg-navy text-white' : 'border border-border text-muted-foreground hover:border-primary hover:text-foreground')
        }
      >
        {listo ? <Check size={11} /> : <AlarmClock size={11} />}
        {listo ? 'Agendado' : 'Agendar'}
      </button>
      {abierto && (
        <div className="absolute right-0 top-7 z-30 w-60 rounded-xl border border-border bg-card p-2.5 shadow-panel">
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            autoFocus
            placeholder="Qué vas a hacer (opcional)…"
            className="mb-2 w-full rounded-lg border border-border bg-muted/40 px-2 py-1.5 text-[11px] outline-none focus:border-primary"
          />
          <div className="flex flex-wrap gap-1.5">
            {opcionesRapidas().map((o) => (
              <button
                key={o.etiqueta}
                type="button"
                disabled={crear.isPending}
                onClick={() => void agendar(o.cuando)}
                className="rounded-full border border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary hover:bg-secondary/40 hover:text-foreground disabled:opacity-50"
              >
                {crear.isPending ? <Loader2 size={10} className="inline animate-spin" /> : o.etiqueta}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">Cae en tu Agenda. Nada se envía solo.</p>
        </div>
      )}
    </span>
  );
}

export function BarraGestion({ conversacion }: { conversacion: Conversacion }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

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
    onError: (err) => {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo cambiar la etapa.');
      window.setTimeout(() => setError(null), 8000);
    },
  });

  return (
    <div className="shrink-0 rounded-2xl bg-card px-3 py-2 shadow-panel">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* La etapa: un clic y quedó — las compuertas del server frenan y explican. */}
        <div className="flex items-center rounded-full border border-border bg-muted/40 p-0.5">
          {ETAPAS.map((e) => (
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
                    : e.id === 'perdido'
                      ? 'bg-destructive text-white'
                      : 'bg-navy text-white'
                  : 'text-muted-foreground hover:text-foreground')
              }
            >
              {e.label}
            </button>
          ))}
        </div>

        <span className="hidden h-4 w-px bg-border sm:block" />
        <EtiquetasInline clave={conversacion.clave} />

        <span className="hidden h-4 w-px bg-border sm:block" />
        <Intereses clave={conversacion.clave} compacto />

        <span className="ml-auto flex items-center gap-1.5">
          {conversacion.canal === 'whatsapp' && conversacion.persona_id && (
            <BotonLlamar telefono={conversacion.persona_id} />
          )}
          <AgendarRapido conversacion={conversacion} />
        </span>
      </div>

      {error && (
        <p className="mt-1.5 rounded-lg bg-gold/10 px-2 py-1 text-[11px] font-medium text-gold-ink">{error}</p>
      )}
    </div>
  );
}
