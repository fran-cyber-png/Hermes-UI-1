import type { AvisoDeFila } from './filaQueSeFue';

/**
 * LA BARRA QUE DICE «no desapareció, bajó».
 *
 * Sale como componente y no como JSX suelto adentro de `ColaUnificada` por una
 * razón concreta: **la galería tiene que poder dibujar LO MISMO que la app**. Una
 * barra recreada a mano en la galería es la misma pieza escrita dos veces, y la
 * captura dejaría de ser evidencia de nada (#37).
 *
 * Comparte la forma exacta del pin de orientación que vive al lado —sticky, filete
 * navy de 3 px, texto en `muted` y una sola acción en `primary`— porque las dos
 * contestan la misma pregunta de la vendedora: «¿dónde está la que estaba
 * mirando?». Si se vieran distintas, habría que aprender dos cosas en vez de una.
 */
export function AvisoFilaQueBajo({
  aviso,
  onFijar,
}: {
  aviso: AvisoDeFila;
  /**
   * Fijar la conversación arriba de todo. `undefined` = no se puede ofrecer
   * (sin la conversación abierta a mano), y entonces la barra **explica igual**:
   * el aviso sirve solo, la acción es la yapa.
   */
  onFijar?: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-l-[3px] border-border border-l-navy bg-card py-2.5 pl-3 pr-2">
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{aviso.texto}</p>
      {/* «Fijarla arriba» NO es un mecanismo nuevo: es el pin que la cola ya tiene
          (banda de arriba, tope 3), ofrecido en el momento exacto en que sirve.
          Medido el 11-ago-2026: `estado_conversacion.fijada` tiene CERO filas en
          toda la base — la función existía y nadie la encontró nunca. */}
      {onFijar && (
        <button
          type="button"
          onClick={onFijar}
          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-primary/10"
        >
          Fijarla arriba
        </button>
      )}
    </div>
  );
}
