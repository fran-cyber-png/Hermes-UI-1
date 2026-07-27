import { ShoppingBag, Sparkles } from 'lucide-react';
import { etiquetaDeFecha, etiquetaDeMonto, type Hito } from './hitos';

/**
 * LA HISTORIA DE LA PERSONA — una sola columna, del hito más nuevo al más viejo.
 *
 * Dos clases de hito y se distinguen por FORMA, no por color: la compra lleva el
 * punto relleno y el renglón en negrita (es un hecho consumado), el interés
 * lleva el punto hueco (es una intención). Un color se aprende; una forma se
 * reconoce sin leer — el mismo criterio que ya usa la superficie de Ivi.
 *
 * **Sin oro.** El dorado de la marca significa una sola cosa —tiempo que se
 * acaba— y esto es historia, no urgencia.
 */
export function TimelineContacto({
  hitos,
  cargando,
  error,
}: {
  hitos: readonly Hito[];
  cargando?: boolean;
  /** Cerberus no contestó. NO es lo mismo que «no compró»: son opuestos. */
  error?: boolean;
}) {
  if (cargando) {
    return (
      <ul className="space-y-2" aria-busy="true">
        {[0, 1].map((i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-muted" />
            <span className="h-3 w-32 animate-pulse rounded bg-muted" />
          </li>
        ))}
      </ul>
    );
  }

  if (error) {
    // La distinción que el panel entero cuida: «no se pudo preguntar» jamás se
    // pinta como «no hay nada».
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        No se pudo consultar Cerberus, así que <strong className="font-semibold">no sabemos</strong> si
        compró. No es lo mismo que no haber comprado.
      </p>
    );
  }

  if (hitos.length === 0) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Todavía no hay historia: ni compras en Cerberus ni intereses registrados. Lo que averigües en
        el chat, registralo — es lo único que queda.
      </p>
    );
  }

  return (
    <ol className="relative space-y-2.5 pl-1">
      {/* El riel: une los hitos para que se lean como una secuencia y no como
          una lista suelta. Arranca en el primer punto y muere en el último. */}
      <span
        className="absolute left-[0.3125rem] top-1.5 bottom-1.5 w-px bg-border"
        aria-hidden="true"
      />
      {hitos.map((h, i) => {
        const fecha = etiquetaDeFecha(h.at);
        const esCompra = h.tipo === 'compra';
        return (
          <li key={`${h.tipo}-${i}`} className="relative flex gap-2.5">
            <span
              className={
                'relative z-10 mt-[0.3125rem] size-1.5 shrink-0 rounded-full ring-2 ring-card ' +
                (esCompra ? 'bg-emerald-600' : 'border border-muted-foreground/60 bg-card')
              }
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={
                    'flex min-w-0 items-center gap-1 text-[11.5px] ' +
                    (esCompra ? 'font-semibold text-foreground' : 'text-foreground/90')
                  }
                >
                  {esCompra ? (
                    <ShoppingBag size={11} className="shrink-0 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <Sparkles size={11} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="truncate">
                    {h.tipo === 'compra' ? etiquetaDeMonto(h.monto, h.moneda) || 'Compra' : h.curso}
                  </span>
                </span>
                {fecha ? (
                  <time
                    dateTime={h.at ?? undefined}
                    className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
                  >
                    {fecha}
                  </time>
                ) : (
                  <span className="shrink-0 text-[10px] text-muted-foreground/70">sin fecha</span>
                )}
              </div>
              <p className="truncate text-[10px] text-muted-foreground">
                {h.tipo === 'compra' ? (
                  <>
                    Compró · {h.estado}
                    {h.folio ? ` · ${h.folio}` : ''}
                  </>
                ) : (
                  'Le interesó'
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
