import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, Loader2 } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import type { Conversacion } from '../canales/conversaciones';
import { opcionesRapidas } from '../agenda/agenda';

/**
 * REGISTRAR GESTIÓN — la bitácora comercial en el panel derecho.
 *
 * Tres cosas en un solo gesto: en qué ETAPA del embudo quedó el lead, cuál es
 * la PRÓXIMA ACCIÓN (wsp de seguimiento / llamada / correo / reunión — con
 * fecha, que cae sola en la Agenda) y las NOTAS de acuerdos. La etapa actual
 * se ve siempre, incluso plegado. Nada de esto envía nada: es la memoria
 * comercial del equipo.
 */

const ETAPAS = [
  { id: 'nuevo', label: 'Nuevo' },
  { id: 'contactado', label: 'Contactado' },
  { id: 'interesado', label: 'Interesado' },
  { id: 'cotizado', label: 'Cotizado' },
  { id: 'venta', label: 'Venta' },
  { id: 'perdido', label: 'Perdido' },
] as const;

const ACCIONES = [
  { id: 'wsp', label: 'Wsp seguimiento' },
  { id: 'llamada', label: 'Llamada' },
  { id: 'correo', label: 'Correo' },
  { id: 'reunion', label: 'Reunión' },
] as const;

interface Gestion {
  id: number;
  etapa: string;
  proximaAccion: string | null;
  proximaFecha: string | null;
  notas: string | null;
  vendedoraId: string;
  creadoAt: string;
}

export function RegistrarGestion({ conversacion }: { conversacion: Conversacion }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [accion, setAccion] = useState<string | null>(null);
  const [cuando, setCuando] = useState<Date | null>(null);
  const [personalizada, setPersonalizada] = useState('');
  const [notas, setNotas] = useState('');
  const [guardado, setGuardado] = useState(false);

  const historial = useQuery({
    queryKey: ['gestiones', conversacion.clave],
    queryFn: () =>
      api<{ gestiones: Gestion[]; etapa: string | null }>(`/api/gestiones/de/${encodeURIComponent(conversacion.clave)}`),
  });
  const etapaActual = historial.data?.etapa ?? null;
  const ultima = historial.data?.gestiones[0] ?? null;

  const crear = useMutation({
    mutationFn: (g: Record<string, unknown>) =>
      api('/api/gestiones', { method: 'POST', body: JSON.stringify(g) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['gestiones', conversacion.clave] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['agenda'] });
      setGuardado(true);
      setAbierto(false);
      setEtapa(null);
      setAccion(null);
      setCuando(null);
      setPersonalizada('');
      setNotas('');
    },
  });

  function guardar() {
    const e = etapa ?? etapaActual ?? 'contactado';
    const fecha = personalizada ? new Date(personalizada) : cuando;
    crear.mutate({
      clave: conversacion.clave,
      canal: conversacion.canal,
      personaId: conversacion.persona_id,
      personaNombre: conversacion.persona_nombre,
      numeroPropio: conversacion.numero_propio,
      etapa: e,
      proximaAccion: accion,
      proximaFecha: accion && fecha ? fecha.toISOString() : null,
      notas,
    });
  }

  const rapidas = opcionesRapidas();
  const chip = (activo: boolean) =>
    'rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-colors ' +
    (activo ? 'bg-navy text-white' : 'border border-border bg-card text-muted-foreground hover:text-foreground');

  return (
    <div className="border-t border-border p-3">
      {/* La etapa actual, SIEMPRE visible: el lector de embudo del panel. */}
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-semibold uppercase tracking-[0.1em]">Etapa</span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold capitalize text-secondary-foreground">
          {etapaActual ?? 'sin gestión'}
        </span>
        {ultima?.notas && <span className="truncate italic">“{ultima.notas.slice(0, 40)}”</span>}
      </div>

      {guardado && !abierto && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
          <Check size={13} /> Gestión registrada{accion ? ' — la próxima acción está en tu Agenda' : ''}.
        </div>
      )}

      {!abierto ? (
        <button
          type="button"
          onClick={() => {
            setAbierto(true);
            setGuardado(false);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy py-2 text-xs font-bold text-white transition-all hover:bg-navy/90 active:scale-[0.98]"
        >
          <ClipboardList size={14} /> Registrar gestión
        </button>
      ) : (
        <div className="rounded-xl border border-border bg-muted/30 p-2.5">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Etapa del embudo</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ETAPAS.map((e) => (
              <button key={e.id} type="button" onClick={() => setEtapa(e.id)} className={chip((etapa ?? etapaActual) === e.id)}>
                {e.label}
              </button>
            ))}
          </div>

          <div className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Próxima acción</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ACCIONES.map((a) => (
              <button key={a.id} type="button" onClick={() => setAccion(accion === a.id ? null : a.id)} className={chip(accion === a.id)}>
                {a.label}
              </button>
            ))}
          </div>
          {accion && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rapidas.map((o) => (
                <button
                  key={o.etiqueta}
                  type="button"
                  onClick={() => {
                    setCuando(o.cuando);
                    setPersonalizada('');
                  }}
                  className={chip(cuando?.getTime() === o.cuando.getTime() && !personalizada)}
                >
                  {o.etiqueta}
                </button>
              ))}
              <input
                type="datetime-local"
                value={personalizada}
                onChange={(e) => {
                  setPersonalizada(e.target.value);
                  setCuando(null);
                }}
                className={chip(Boolean(personalizada)) + ' outline-none'}
              />
            </div>
          )}

          <div className="mt-3 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Notas de acuerdos</div>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            placeholder="Qué se acordó: le interesa el diplomado, paga en cuotas, mandarle el temario…"
            className="mt-1.5 w-full resize-none rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary"
          />

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={guardar}
              disabled={crear.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-bold text-primary-foreground transition-all hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
            >
              {crear.isPending ? <Loader2 size={12} className="animate-spin" /> : <ClipboardList size={12} />}
              Guardar gestión
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
