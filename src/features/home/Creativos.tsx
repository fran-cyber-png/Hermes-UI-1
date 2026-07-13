import { Flame, ImageOff } from 'lucide-react';
import type { Creativo } from '../../lib/datos/overview';

/**
 * LOS CREATIVOS — qué anuncio funciona, no solo cuánto gastó.
 *
 * Cada tarjeta muestra lo que la persona VE (la miniatura) y LEE (el copy), más lo que cuesta cada
 * resultado y un veredicto. Rankeados por plata: los que tienen más inversión detrás, primero.
 *
 * Honestidad: es costo por CONVERSACIÓN, no por venta. Saber qué creativo produjo cada venta
 * necesita el clic-a-WhatsApp (ctwa), que llega con la Cloud API. Hasta entonces se dice así.
 */

const TEMP = { fresco: '#16A34A', tibio: '#CAA106', frio: '#C2410C', helado: '#64748B' } as const;

const VEREDICTO: Record<Creativo['veredicto'], { texto: string; color: string }> = {
  eficiente: { texto: 'eficiente', color: TEMP.fresco },
  caro: { texto: 'caro', color: TEMP.frio },
  medio: { texto: 'medio', color: TEMP.helado },
  sin_resultados: { texto: 'sin conversaciones', color: TEMP.frio },
  poco_gasto: { texto: 'poco gasto', color: TEMP.helado },
};

export default function Creativos({ creativos }: { creativos: Creativo[] }) {
  if (creativos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay creativos con gasto en este rango.
      </p>
    );
  }

  const visibles = creativos.slice(0, 9);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibles.map((c) => {
          const v = VEREDICTO[c.veredicto];
          return (
            <div key={c.clave} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
              {/* La miniatura: lo que la persona ve. Si Meta no la dio, un marcador honesto. */}
              <div className="relative flex aspect-[1.91/1] items-center justify-center overflow-hidden bg-muted">
                {/* Quemado: la frecuencia subió Y el CTR bajó. Sigue gastando y ya no funciona. */}
                {c.fatiga && (
                  <span
                    className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-white"
                    style={{ background: TEMP.frio }}
                    title="Al mismo público se le muestra cada vez más y responde cada vez menos."
                  >
                    <Flame size={10} />
                    quemado
                  </span>
                )}
                {c.thumbnailUrl ? (
                  <img src={c.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <ImageOff size={20} className="text-muted-foreground/50" />
                )}
              </div>

              <div className="flex flex-1 flex-col p-3">
                {/* El copy: lo que la persona lee. Dos líneas, lo demás se corta. */}
                <p className="line-clamp-2 text-xs leading-snug text-foreground">
                  {c.copy || <span className="text-muted-foreground">sin texto</span>}
                </p>

                <div className="mt-auto pt-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-heading text-base font-extrabold tabular-nums text-navy">
                      ${c.gastoUsd.toLocaleString('es')}
                    </span>
                    <span
                      className="font-mono text-[10px] font-semibold uppercase tracking-wide"
                      style={{ color: v.color }}
                    >
                      {v.texto}
                    </span>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-navy/45">
                    {c.ctr != null ? `CTR ${c.ctr}% · ` : ''}
                    {c.costoPorResultadoUsd != null
                      ? `${c.costoPorResultadoUsd < 0.01 ? '<$0,01' : `$${c.costoPorResultadoUsd.toLocaleString('es')}`} / conversación`
                      : 'sin conversaciones'}
                    {c.anuncios > 1 ? ` · ${c.anuncios} anuncios` : ''}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        <strong className="text-foreground">Quemado</strong> = la frecuencia sube <em>y</em> el CTR
        baja: al mismo público se le muestra cada vez más y responde cada vez menos. Es presupuesto
        que se va en un creativo agotado.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Es costo por <strong className="text-foreground">conversación</strong>, no por venta. Atribuir
        la venta al creativo necesita el clic-a-WhatsApp, que llega con la migración a la Cloud API.
      </p>
    </>
  );
}
