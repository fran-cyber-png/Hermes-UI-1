import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, Loader2, X } from 'lucide-react';
import { api } from '../../lib/datos/cliente';
import { sectionLabel } from '../../lib/styles';
import type { Conversacion } from '../canales/conversaciones';
import { opcionesRapidas } from '../agenda/agenda';
import { useNotas } from '../notas/notas';
import { rotuloEtapa } from '../../lib/etapas';

/**
 * PRÓXIMA ACCIÓN — la bitácora comercial en el panel derecho.
 *
 * Cuál es la PRÓXIMA ACCIÓN (wsp de seguimiento / llamada / correo / reunión —
 * con fecha, que cae sola en la Agenda). La etapa y los intereses se manejan
 * en la BarraGestion, arriba del chat; acá la etapa solo se LEE. Nada de esto
 * envía nada: es la memoria comercial del equipo.
 *
 * Las NOTAS de acuerdos vivían acá (un textarea append-only dentro de cada
 * gestión) — issue #47 las saca a `PanelNotas`, editable y sin mover el
 * embudo. El preview de «última nota» del cintillo de abajo ahora lee de ahí,
 * no de `gestiones.notas` (ver ADR 0012).
 */

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
}

export function RegistrarGestion({
  conversacion,
  compacta = false,
}: {
  conversacion: Conversacion;
  /**
   * En el panel derecho el pie compite con la acción primaria («Registrar
   * venta»), y en un laptop de 720 px cada fila de más se la come al detalle.
   * Compacta pone la etapa y el disparador de «Próxima acción» en UNA fila.
   * `false` = el bloque de siempre.
   */
  compacta?: boolean;
}) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [accion, setAccion] = useState<string | null>(null);
  const [cuando, setCuando] = useState<Date | null>(null);
  const [personalizada, setPersonalizada] = useState('');
  const [guardado, setGuardado] = useState(false);

  const historial = useQuery({
    queryKey: ['gestiones', conversacion.clave],
    queryFn: () =>
      api<{ gestiones: Gestion[]; etapa: string | null }>(`/api/gestiones/de/${encodeURIComponent(conversacion.clave)}`),
  });
  const etapaActual = historial.data?.etapa ?? null;
  // El preview de «última nota» del cintillo (#47): ya no viene de `gestiones`
  // (append-only, ver el header del módulo) — sale de la nota más reciente
  // (fijada primero) de ESTA conversación.
  const { data: notasConv } = useNotas(conversacion.clave);
  const ultimaNota = notasConv?.[0] ?? null;

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
    },
  });

  function guardar() {
    // La etapa no se elige acá (eso es de la BarraGestion): la próxima acción
    // se asienta sobre la etapa actual. El server exige una válida — para un
    // lead sin gestión, la base es 'interesado' (la misma lectura de la barra).
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
    });
  }

  const rapidas = opcionesRapidas();
  const chip = (activo: boolean) =>
    'rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ' +
    (activo ? 'bg-navy text-white' : 'border border-border bg-card text-muted-foreground hover:text-foreground');

  const etapaChip = (
    <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
      {/* Una conversación, no un montón: singular. `rotuloEtapa` ya degrada al id. */}
      {etapaActual ? rotuloEtapa(etapaActual) : 'Sin gestión'}
    </span>
  );
  const disparador = (
    <button
      type="button"
      onClick={() => {
        setAbierto(true);
        setGuardado(false);
      }}
      className={
        'flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card font-bold text-navy transition-[background-color,transform] duration-200 ease-house hover:bg-muted active:scale-[0.98] ' +
        (compacta ? 'ml-auto shrink-0 px-2.5 py-1 text-[11px]' : 'w-full py-2 text-xs')
      }
    >
      <ClipboardList size={compacta ? 12 : 14} /> Próxima acción
    </button>
  );

  return (
    <div className={compacta ? 'px-3 pb-2 pt-2.5' : 'border-t border-border p-3'}>
      {/* La etapa actual, SIEMPRE visible — solo lectura: se cambia en la barra del chat. */}
      <div className={'flex items-center gap-2 text-[11px] text-muted-foreground ' + (compacta ? '' : 'mb-2')}>
        {etapaChip}
        {ultimaNota && <span className="min-w-0 truncate italic">“{ultimaNota.texto.slice(0, 40)}”</span>}
        {compacta && !abierto && disparador}
      </div>

      {guardado && !abierto && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1.5 text-[11px] font-semibold text-success">
          <Check size={13} /> Gestión registrada{crear.variables?.proximaAccion ? ' — la próxima acción está en tu Agenda' : ''}.
        </div>
      )}

      {!abierto ? (
        compacta ? null : disparador
      ) : (
        <div className={'rounded-xl border border-border bg-muted/30 p-2.5 ' + (compacta ? 'mt-2' : '')}>
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
              disabled={crear.isPending || !accion}
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
