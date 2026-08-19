import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../index.css';
import { RotuloDeLaCola } from './RotuloDeLaCola';
import { explicacionDelRotulo } from './explicacionDeLaCola';
import { VacioDeLineaPropia } from './VacioDeLineaPropia';

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

const CASOS: { rotulo: string; total: number; recortada?: boolean; lineaPropia?: boolean }[] = [
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
  {
    rotulo:
      'WALTER, QUE TRAJO SU PROPIA LÍNEA POR QR (18-ago-2026) — mismo rótulo, otra explicación. Ve su línea entera más lo que le asignen, así que la frase de siempre («lo que todavía no tiene dueña») le explicaría su número con lo único que ya NO ve: se le cayó esa rama y con ella 2.879 conversaciones del archivo de las líneas apagadas. Medido: pasa de 2.930 a 51, y esos 51 son leads de formulario — en la otra línea todavía no le asignaron ninguna.',
    total: 51,
    recortada: true,
    lineaPropia: true,
  },
];

function Galeria() {
  return (
    <div className="min-h-screen bg-background p-8 font-sans">
      <h1 className="font-heading text-2xl font-bold text-navy-ink">El rótulo de la cola</h1>
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
              <RotuloDeLaCola total={c.total} recortada={c.recortada} lineaPropia={c.lineaPropia} />
            </div>
            {/* ⚠️ **El `title` no sale en una captura**, y es la mitad que explica
                el número — sin esto la galería mostraría cuatro renglones casi
                idénticos y no se podría juzgar lo único que cambió. Sale de
                `explicacionDelRotulo`, la MISMA función que el componente: una
                galería que imprime su propia versión del texto deja de ser
                evidencia el día que alguien mejore una de las dos (#37). */}
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              <span className="font-bold">al pasar el mouse:</span>{' '}
              {explicacionDelRotulo(c.recortada, c.lineaPropia) ??
                '— (sin recorte anunciado no hay nada que explicar)'}
            </p>
          </div>
        ))}
      </div>

      {/* ⚠️ **El vacío es la otra mitad del mismo frente**, y es la que más se va
          a ver el día del deploy: las dos personas con línea propia no tienen
          ninguna conversación asignada todavía (medido el 18-ago-2026). Va acá y
          no en una galería nueva porque responde la MISMA pregunta que el
          rótulo —«¿de quién es lo que estoy viendo?»— y se juzgan juntas. */}
      <h2 className="mt-10 font-heading text-lg font-bold text-navy-ink">Y cuando no hay nada</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        Sin este texto, la cola vacía de alguien que trajo su línea se lee «se perdieron las
        conversaciones». Se dicen las dos fuentes de su cola y no se afirma ningún conteo: el front
        no sabe cuántas le asignaron.
      </p>
      <div className="mt-4 rounded-lg border border-border bg-card px-4 py-12 text-center">
        <VacioDeLineaPropia />
      </div>
    </div>
  );
}

createRoot(document.getElementById('galeria')!).render(
  <StrictMode>
    <Galeria />
  </StrictMode>,
);
