import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { RotuloDeLaCola } from './RotuloDeLaCola';

/**
 * LA GALERÍA DEL RÓTULO DE LA COLA — los tres estados, uno al lado del otro.
 *
 * Entry APARTE de Vite (`galeria-cola-recortada.html` en la raíz): **no entra al
 * bundle de la app** —`vite build` toma solo `index.html`— y no habla con ningún
 * server ni con ninguna base.
 *
 *     npx vite --port 5199  →  http://localhost:5199/galeria-cola-recortada.html
 *
 * Existe por la regla dura #2 (nada de UI se reporta listo sin captura) y porque
 * lo que hay que poder juzgar de un vistazo **no se ve en un test de DOM**: si
 * las dos versiones del rótulo se distinguen sin leerlas con lupa, y si el
 * número —que es lo que la vendedora mira— sigue siendo lo que más pesa.
 *
 * ⚠️ Los tres números son los MEDIDOS en el plan (15-ago-2026), no inventados:
 * `luz` pasa de 5.494 a 2.379 y `sindy` queda en 192. Una galería con datos
 * lindos ya escondió tres defectos una vez.
 */

const CASOS: { rotulo: string; total: number; recortada?: boolean }[] = [
  {
    rotulo:
      'SUPERVISORA / ADMIN — ve la mesa entera, así que no hay recorte que anunciar. Es también lo que ve un server viejo o una página rehidratada del caché: ausente ≠ «no hay recorte», ausente es «no se sabe», y de eso no se afirma nada.',
    total: 5494,
  },
  {
    rotulo:
      'LUZ, CON LA FRONTERA PUESTA — el mismo lugar, el mismo peso visual, y el número que cambió tiene al lado de quién es. Sin esto, el lunes lee 2.379 donde el viernes leyó 5.494 y no hay una palabra que lo explique.',
    total: 2379,
    recortada: true,
  },
  {
    rotulo:
      'SINDY — el caso donde el número por fin coincide con las filas: la cola le servía 3.095 y la cabecera le decía 5.494. Con dos dígitos, «para vos» es lo único que separa «me asignaron poco» de «se rompió algo».',
    total: 192,
    recortada: true,
  },
];

function Galeria() {
  return (
    <div className="min-h-screen bg-background p-8 font-sans">
      <h1 className="font-heading text-2xl font-bold text-navy">El rótulo de la cola</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Vive en la cabecera de la cola, a la derecha de los tabs. <strong>Sin oro</strong>: acá no
        corre ningún plazo.
      </p>
      <div className="mt-6 space-y-4">
        {CASOS.map((c) => (
          <div key={c.rotulo} className="rounded-lg border border-border bg-card p-4">
            <p className="mb-3 max-w-3xl text-xs text-muted-foreground">{c.rotulo}</p>
            {/* La misma caja que en la app: los tabs a la izquierda, el rótulo a la derecha. */}
            <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5">
              <div className="flex shrink-0 gap-0.5 rounded-lg bg-muted/60 p-0.5">
                {['Todo', 'Sin leer', 'Favoritos'].map((t, i) => (
                  <span
                    key={t}
                    className={
                      'rounded-md px-2.5 py-1 text-xs font-bold ' +
                      (i === 0 ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground')
                    }
                  >
                    {t}
                  </span>
                ))}
              </div>
              <RotuloDeLaCola total={c.total} recortada={c.recortada} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <Galeria />
  </StrictMode>,
);
