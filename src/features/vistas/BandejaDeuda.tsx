import { ArrowRight, Inbox } from 'lucide-react';
import { resumirBandeja, type FilaDesglose } from './tablero';

/**
 * LA BANDEJA — la deuda de la mesa, dicha como es.
 *
 * Interesados dejó de ser columna por decisión del dueño (#87): una pila que
 * nunca se trabaja es ruido. Pero el contador que la reemplazó decía «Levantaron
 * la mano y nadie les respondió aún», y eso es falso para la mitad: medido en
 * producción el 2026-07-25, de las 476 de la bandeja hay 218 a las que **ya les
 * hablamos** y volvieron a escribir. Son dos trabajos distintos: uno se abre,
 * el otro se sigue.
 *
 * Y hay un tercer número que no estaba en ninguna parte y es el que ordena el
 * día: cuántas están escribiendo AHORA (menos de 24 h sin respuesta). La mediana
 * de primera respuesta de la mesa es de 39 minutos; ese número tiene que estar a
 * la vista.
 *
 * Sigue siendo una tira, no una columna: acá no se arrastra nada. El trabajo de
 * la bandeja se hace en Mensajes, y el botón lleva ahí.
 */
export function BandejaDeuda({
  desglose,
  conteos,
  cargando,
  onIrAMensajes,
}: {
  desglose: FilaDesglose[] | undefined;
  /** El conteo por etapa de siempre: el respaldo mientras el server no sirva el desglose. */
  conteos: Record<string, number> | undefined;
  cargando: boolean;
  onIrAMensajes?: () => void;
}) {
  const r = resumirBandeja(desglose, conteos);
  const listo = desglose != null || conteos != null;
  const vacia = !cargando && listo && r.total === 0;

  return (
    <section
      aria-label="Te esperan"
      className="mb-2.5 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl bg-card px-4 py-2.5 shadow-panel"
    >
      <Inbox size={16} className="shrink-0 text-navy" aria-hidden />

      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="flex items-baseline gap-2">
          <span className="font-heading text-xl font-bold tabular-nums text-foreground">
            {listo ? r.total.toLocaleString('es-PE') : '—'}
          </span>
          <h3 className="font-heading text-[13px] font-bold text-foreground">
            {vacia ? 'Nadie esperando' : 'Te esperan'}
          </h3>
          {!vacia && r.total > 0 && !r.hayDetalle && (
            <span className="text-[11px] text-muted-foreground">
              Nadie les respondió todavía, o volvieron a escribir.
            </span>
          )}
        </span>

        {!vacia && r.total > 0 && r.hayDetalle && (
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {r.vivas > 0 && (
              <span className="font-semibold text-temp-fresco" title="Escribieron hace menos de 24 h">
                {r.vivas.toLocaleString('es-PE')} escribiendo ahora
              </span>
            )}
            <span title="Nadie les contestó nunca">
              {r.nuevas.toLocaleString('es-PE')} sin abrir
            </span>
            <span aria-hidden className="text-muted-foreground/40">
              ·
            </span>
            <span title="Ya les hablaste y volvieron a escribir">
              {r.retomadas.toLocaleString('es-PE')} volvieron a escribir
            </span>
          </p>
        )}

        {vacia && (
          <p className="text-[11px] text-muted-foreground">
            Nadie quedó sin respuesta. Cuando alguien escriba, aparece acá.
          </p>
        )}
      </div>

      {onIrAMensajes && (
        <button
          type="button"
          onClick={onIrAMensajes}
          className="group inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground shadow-[0_4px_14px_-6px_rgba(37,99,235,0.7)] transition-[background-color,transform] duration-200 ease-house hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 active:scale-[0.98]"
        >
          Responder en Mensajes
          <ArrowRight size={12} className="transition-transform duration-200 ease-house group-hover:translate-x-0.5" />
        </button>
      )}
    </section>
  );
}
