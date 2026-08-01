import { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';

/**
 * El resumen IA, colapsable y neutro (V2-5). `texto === null` → no se
 * renderiza nada: no existe el endpoint, no existe el placeholder.
 * Sin verde a propósito: el resumen es provisional, no una venta.
 */
export function ResumenIa({ texto }: { texto: string | null }) {
  const [abierto, setAbierto] = useState(false);

  if (texto === null) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls="resumen-ia-contenido"
        aria-label="Mostrar u ocultar resumen"
        onClick={() => setAbierto((a) => !a)}
        className="flex h-7 w-full items-center gap-1.5 text-left"
      >
        <Sparkles size={14} aria-hidden className="shrink-0 text-primary" />
        <span className="text-xs font-semibold text-foreground">Resumen IA</span>
        <ChevronDown
          size={14}
          aria-hidden
          className={'ml-auto shrink-0 text-muted-foreground transition-transform ' + (abierto ? 'rotate-180' : '')}
        />
      </button>
      {abierto && (
        <div
          id="resumen-ia-contenido"
          className="mt-2 rounded-lg border border-border bg-muted/50 p-3 text-xs leading-relaxed text-foreground"
        >
          {texto}
        </div>
      )}
    </div>
  );
}
