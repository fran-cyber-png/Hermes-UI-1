import { useRef, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { hace, useFrescura } from '../../lib/datos/frescura';
import { usePopover } from '../../lib/teclado/usePopover';

/**
 * La línea de salud de los datos: de cuándo es lo que la vendedora está mirando.
 *
 * ── Por qué existe ──
 * Es la única defensa contra el peor modo de falla de esta pantalla: que la
 * ingesta se detenga y la bandeja se vea igual de tranquila que cuando está al
 * día. Un cero puede significar "no hay trabajo" o "no estoy mirando".
 *
 * ── Cómo habla ──
 * En verde se contrae a su mínima expresión (voz de imprenta, muted). Solo
 * crece y toma color al fallar: un chip ámbar de UNA línea; el detalle vive en
 * un popover. La vendedora nunca recibe órdenes de terminal — lo técnico va al
 * final, marcado "para sistemas:" (ella avisa; sistemas ejecuta).
 */
export default function BarraFrescura() {
  const { data, isPending, isError } = useFrescura();
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Su listener propio iba en BURBUJA y sin cortar el evento: el mismo Escape
  // llegaba después al shell y cerraba TAMBIÉN la conversación de atrás (#12).
  const { propsOverlay } = usePopover(abierto, () => setAbierto(false), { z: 'z-40' });

  if (isPending) return <div className="h-6 w-28 animate-pulse rounded-lg bg-muted" />;
  if (isError || !data) {
    return <span className="font-mono text-[11px] text-muted-foreground">datos: sin señal del server</span>;
  }

  if (data.fresca) {
    return (
      <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
        <Check size={12} className="text-temp-fresco" />
        datos {hace(data.horasDesdeIngesta)}
      </span>
    );
  }

  const dias = data.horasDesdeIngesta == null ? null : Math.floor(data.horasDesdeIngesta / 24);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] font-medium text-warning-foreground transition-colors hover:bg-warning/20"
      >
        <AlertTriangle size={12} />
        {data.ultimaIngesta == null ? 'Nunca se capturaron datos' : `Captura detenida ${hace(data.horasDesdeIngesta)}`}
      </button>

      {abierto && (
        <>
          <span {...propsOverlay} />
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl bg-card p-4 shadow-panel animate-entrar">
            <p className="text-xs font-bold text-foreground">
              {data.ultimaIngesta == null ? 'Nunca se capturaron datos.' : `La captura está detenida ${hace(data.horasDesdeIngesta)}.`}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Los mensajes nuevos de Facebook e Instagram no están entrando. Avisá a sistemas.
              {dias != null && dias >= 7 && (
                <>
                  {' '}
                  Con más de 7 días de atraso, «les puedo escribir» siempre da cero — no porque estés al día, sino porque no hay
                  nada reciente que mirar.
                </>
              )}
            </p>
            <p className="mt-2.5 border-t border-border pt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              para sistemas: npm run ingest:interactions (en server/)
            </p>
          </div>
        </>
      )}
    </div>
  );
}
