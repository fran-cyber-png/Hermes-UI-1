import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, Loader2, X } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import { sectionLabel } from '../../lib/styles';
import type { Conversacion } from '../canales/conversaciones';
import { opcionesRapidas } from '../agenda/agenda';

/**
 * NOTAS Y PRÓXIMA ACCIÓN — la bitácora comercial en el panel derecho.
 *
 * Dos cosas en un solo gesto: cuál es la PRÓXIMA ACCIÓN (wsp de seguimiento /
 * llamada / correo / reunión — con fecha, que cae sola en la Agenda) y las
 * NOTAS de acuerdos. La etapa y los intereses se manejan en la BarraGestion,
 * arriba del chat; acá la etapa solo se LEE. Nada de esto envía nada: es la
 * memoria comercial del equipo.
 */

const ETAPA_LABEL: Record<string, string> = {
  interesado: 'Interesado',
  contactado: 'Contactado',
  cotizado: 'Cotizado',
  cierre: 'Cierre',
  perdido: 'Perdido',
};

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

/** El cuerpo del POST — tipado para poder leer crear.variables en el éxito. */
interface NuevaGestion {
  clave: string;
  canal: string;
  personaId: string | null;
  personaNombre: string | null;
  numeroPropio: string | null;
  etapa: string;
  proximaAccion: string | null;
  proximaFecha: string | null;
  notas: string;
}

export function RegistrarGestion({ conversacion }: { conversacion: Conversacion }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
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

  const [errorCompuerta, setErrorCompuerta] = useState<string | null>(null);
  const crear = useMutation({
    mutationFn: (g: NuevaGestion) =>
      api('/api/gestiones', { method: 'POST', body: JSON.stringify(g) }),
    onError: (err) => setErrorCompuerta(err instanceof Error ? err.message : 'No se pudo registrar.'),
    onSuccess: () => {
      setErrorCompuerta(null);
      void qc.invalidateQueries({ queryKey: ['gestiones', conversacion.clave] });
      void qc.invalidateQueries({ queryKey: ['embudo'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['agenda'] });
      setGuardado(true);
      setAbierto(false);
      setAccion(null);
      setCuando(null);
      setPersonalizada('');
      setNotas('');
    },
  });

  function guardar() {
    // La etapa no se elige acá (eso es de la BarraGestion): la nota se asienta
    // sobre la etapa actual. El server exige una válida — para un lead sin
    // gestión, la base es 'interesado' (la misma lectura que hace la barra).
    const fecha = personalizada ? new Date(personalizada) : cuando;
    crear.mutate({
      clave: conversacion.clave,
      canal: conversacion.canal,
      personaId: conversacion.persona_id,
      personaNombre: conversacion.persona_nombre,
      numeroPropio: conversacion.numero_propio,
      etapa: etapaActual ?? 'interesado',
      proximaAccion: accion,
      proximaFecha: accion && fecha ? fecha.toISOString() : null,
      notas,
    });
  }

  const rapidas = opcionesRapidas();
  const chip = (activo: boolean) =>
    'rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ' +
    (activo ? 'bg-navy text-white' : 'border border-border bg-card text-muted-foreground hover:text-foreground');

  return (
    <div className="border-t border-border p-3">
      {/* La etapa actual, SIEMPRE visible — solo lectura: se cambia en la barra del chat. */}
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
          {etapaActual ? (ETAPA_LABEL[etapaActual] ?? etapaActual) : 'Sin gestión'}
        </span>
        {ultima?.notas && <span className="truncate italic">“{ultima.notas.slice(0, 40)}”</span>}
      </div>

      {guardado && !abierto && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success">
          <Check size={13} /> Gestión registrada{crear.variables?.proximaAccion ? ' — la próxima acción está en tu Agenda' : ''}.
        </div>
      )}

      {!abierto ? (
        <button
          type="button"
          onClick={() => {
            setAbierto(true);
            setGuardado(false);
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-2 text-xs font-bold text-navy transition-[background-color,transform] duration-200 ease-house hover:bg-muted active:scale-[0.98]"
        >
          <ClipboardList size={14} /> Notas y próxima acción
        </button>
      ) : (
        <div className="rounded-xl border border-border bg-muted/30 p-2.5">
          <div className={sectionLabel}>Próxima acción</div>
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

          <div className={'mt-3 ' + sectionLabel}>Notas de acuerdos</div>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            rows={2}
            placeholder="Qué se acordó: le interesa el diplomado, paga en cuotas, mandarle el temario…"
            className="mt-1.5 w-full resize-none rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary"
          />

          {errorCompuerta && (
            <div className="mt-2 flex items-start justify-between gap-2 rounded-lg bg-warning/10 px-2.5 py-1.5 text-[11px] font-medium text-warning-foreground">
              <span>{errorCompuerta}</span>
              <button
                type="button"
                aria-label="Cerrar aviso"
                onClick={() => setErrorCompuerta(null)}
                className="shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={guardar}
              disabled={crear.isPending || (!accion && !notas.trim())}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-bold text-primary-foreground transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover active:scale-[0.98] disabled:opacity-40"
            >
              {crear.isPending ? <Loader2 size={12} className="animate-spin" /> : <ClipboardList size={12} />}
              Guardar
            </button>
            <button
              type="button"
              onClick={() => setAbierto(false)}
              className="rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
