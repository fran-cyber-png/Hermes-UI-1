import { useState } from 'react';
import { CalendarClock, Check, Loader2, Pencil, X } from 'lucide-react';
import { avisar } from '../../lib/avisos';
import { useAgenda } from './agenda';
import { cuandoEnCriollo, estaVencido, proximoDe } from './proximas';
import { CHIP_TIPO, tipoDeActividad, TIPOS_ELEGIBLES } from './tipoDeNota';

/**
 * QUÉ TENÉS PENDIENTE CON ESTA PERSONA — arriba de la conversación.
 *
 * La promesa vivía sólo en la Agenda, o sea en otra pantalla: para saber si a
 * este chat le debía una llamada, la vendedora tenía que salirse del chat. Acá
 * está donde se necesita, con las tres salidas que puede tener una promesa —
 * **reprogramarla, cumplirla o cancelarla**— sin moverse de lugar.
 *
 * ⚠️ **No aparece si no hay nada pendiente**, y eso es a propósito: un banner
 * que dice «no hay seguimientos» ocupa el mismo espacio que uno que avisa algo,
 * y enseña a no mirarlo.
 *
 * Lee la MISMA query que la vista Agenda y el badge del riel (`useAgenda`), así
 * que no agrega un pedido por conversación abierta y marcar hecho acá actualiza
 * las tres cosas a la vez.
 */
export function ProximoSeguimiento({ clave }: { clave: string }) {
  const { agenda, cambiarEstado, actualizarHora } = useAgenda();
  const [editando, setEditando] = useState(false);
  const [cuando, setCuando] = useState('');

  const proximo = proximoDe(agenda.data?.recordatorios, clave);
  if (!proximo) return null;

  const vencido = estaVencido(proximo);
  const tipo = tipoDeActividad(proximo);
  const rotulo = TIPOS_ELEGIBLES.find((t) => t.id === tipo)?.rotulo ?? 'Seguimiento';

  function abrirEdicion() {
    // `datetime-local` quiere hora LOCAL sin zona: el ISO con `Z` lo rechaza en
    // silencio y el campo abre vacío.
    const d = new Date(proximo!.cuando);
    const dosDigitos = (n: number) => String(n).padStart(2, '0');
    setCuando(
      `${d.getFullYear()}-${dosDigitos(d.getMonth() + 1)}-${dosDigitos(d.getDate())}T${dosDigitos(d.getHours())}:${dosDigitos(d.getMinutes())}`,
    );
    setEditando(true);
  }

  return (
    <div
      className={
        'flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-2xl px-3 py-2 text-[11px] ' +
        (vencido ? 'bg-destructive/10 text-destructive-foreground' : 'bg-card shadow-panel')
      }
    >
      <CalendarClock size={13} className={vencido ? 'text-destructive' : 'text-primary'} />
      <span className={'rounded-full px-1.5 py-0.5 font-semibold ' + CHIP_TIPO[tipo]}>{rotulo}</span>
      <span className="min-w-0 flex-1 truncate font-semibold text-foreground">{proximo.nota}</span>
      <span className={'font-semibold tabular-nums ' + (vencido ? 'text-destructive' : 'text-muted-foreground')}>
        {vencido ? 'Vencido · ' : ''}
        {cuandoEnCriollo(proximo)}
      </span>

      {editando ? (
        <span className="flex items-center gap-1">
          <input
            type="datetime-local"
            value={cuando}
            onChange={(e) => setCuando(e.target.value)}
            aria-label="Nueva fecha"
            autoFocus
            className="rounded-lg border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-primary"
          />
          <button
            type="button"
            disabled={actualizarHora.isPending || !cuando}
            onClick={() => {
              const d = new Date(cuando);
              if (Number.isNaN(d.getTime())) return;
              actualizarHora.mutate(
                { id: proximo.id, cuando: d.toISOString() },
                {
                  onSuccess: () => {
                    setEditando(false);
                    avisar('Seguimiento reprogramado');
                  },
                },
              );
            }}
            className="rounded-full bg-primary px-2 py-0.5 font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40"
          >
            {actualizarHora.isPending ? <Loader2 size={11} className="animate-spin" /> : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={() => setEditando(false)}
            className="rounded-full px-1.5 py-0.5 font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
        </span>
      ) : (
        <span className="flex items-center gap-0.5">
          <Accion icono={<Pencil size={11} />} rotulo="Reprogramar" onClick={abrirEdicion} />
          <Accion
            icono={<Check size={11} />}
            rotulo="Completar"
            onClick={() =>
              cambiarEstado.mutate(
                { id: proximo.id, estado: 'hecho' },
                { onSuccess: () => avisar('Seguimiento completado') },
              )
            }
          />
          {/* Cancelar NO es borrar: la promesa queda, con su final. Por eso no
              pregunta «¿estás segura?» —no se pierde nada— y por eso no es la
              misma acción que «Completar»: «ya no hace falta» no es «lo hice». */}
          <Accion
            icono={<X size={11} />}
            rotulo="Cancelar"
            onClick={() =>
              cambiarEstado.mutate(
                { id: proximo.id, estado: 'cancelado' },
                { onSuccess: () => avisar('Seguimiento cancelado') },
              )
            }
          />
        </span>
      )}
    </div>
  );
}

function Accion({
  icono,
  rotulo,
  onClick,
}: {
  icono: React.ReactNode;
  rotulo: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={rotulo}
      className="flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {icono}
      {rotulo}
    </button>
  );
}
