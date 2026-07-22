/**
 * BARRA SEGMENTADA — el embudo en una línea, extraída del Dashboard para reuso
 * (riel del Dashboard, recibo de venta). Separadores de 2px del color de la
 * superficie; identidad de etapa fija (lib/etapas). Clickeable solo si el
 * consumidor pasa onSegmento.
 */

export interface Segmento {
  id: string;
  n: number;
  /** className de fondo, p.ej. 'bg-navy' (ver colorSegmento en lib/etapas). */
  color: string;
  label?: string;
}

export function BarraSegmentada({
  segmentos,
  activo,
  onSegmento,
  className = '',
}: {
  segmentos: Segmento[];
  activo?: string | null;
  onSegmento?: (id: string) => void;
  className?: string;
}) {
  const visibles = segmentos.filter((s) => s.n > 0);
  return (
    <div role="img" aria-label={visibles.map((s) => `${s.label ?? s.id}: ${s.n}`).join(' · ')} className={'flex h-2 gap-[2px] overflow-hidden rounded-full ' + className}>
      {visibles.map((s) =>
        onSegmento ? (
          <button
            key={s.id}
            type="button"
            title={`${s.label ?? s.id}: ${s.n}`}
            onClick={() => onSegmento(s.id)}
            style={{ flexGrow: s.n }}
            className={s.color + ' transition-opacity hover:opacity-80 ' + (activo === s.id ? 'ring-2 ring-navy ring-offset-1' : '')}
          />
        ) : (
          <span key={s.id} title={`${s.label ?? s.id}: ${s.n}`} style={{ flexGrow: s.n }} className={s.color} />
        ),
      )}
    </div>
  );
}
