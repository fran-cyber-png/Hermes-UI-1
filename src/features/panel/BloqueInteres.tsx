import { useState } from 'react';
import { AlertTriangle, Check, Loader2, Plus, Sparkles } from 'lucide-react';
import { sectionLabel } from '../../lib/styles';
import type { Conversacion } from '../canales/conversaciones';
import { Intereses } from '../gestion/Intereses';
import { useAgregarInteres, useIntereses } from '../gestion/interesesDatos';
import { CLASE_FONDO_TENUE, CLASE_TEXTO } from '../gestion/paletaCategorias';
import { decidirInteres } from './interes';

/**
 * «LE INTERESA» — donde se traba el CRM, arreglado con un clic.
 *
 * **611 conversaciones con precio enviado. UN interés registrado.** La compuerta
 * de «Cotizado» pide interés y nadie lo carga, así que el embudo miente todos
 * los días. La causa no es desidia: el dato **ya está en pantalla** —el chip de
 * la fila, el cintillo «Vino del anuncio», el bloque del formulario— y el panel
 * igual pedía abrir un buscador y tipearlo.
 *
 * Acá el bloque tiene tres caras, y ninguna es un hueco:
 *
 *   · **registrado** — los chips con su línea de tiempo, como siempre.
 *   · **propuesta** — el curso que el sistema ya sabe, en su color de familia,
 *     con BORDE PUNTEADO (todavía no es un hecho) y un botón «Es este». Un clic
 *     y queda asentado. Nunca se asienta solo: abre una compuerta del embudo,
 *     así que la firma una persona.
 *   · **vacío** — dice POR QUÉ importa («sin esto, Cotizado no abre») en vez de
 *     dejar un `+` mudo.
 *
 * La decisión de cuál mostrar es pura y está en `interes.ts`, con tests; la
 * precedencia de fuentes la manda `canales/curso.ts` (#72), la misma que pinta
 * el chip de la cola — así el panel y la fila nunca dicen cosas distintas.
 */

export function BloqueInteres({ conversacion }: { conversacion: Conversacion }) {
  const { data: registrados = [] } = useIntereses(conversacion.clave);
  const [abrirBuscador, setAbrirBuscador] = useState(0);
  const agregar = useAgregarInteres(conversacion.clave);

  const decision = decidirInteres(
    registrados.map((i) => i.curso),
    conversacion,
  );

  return (
    <section className="shrink-0 border-t border-border px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={sectionLabel}>Le interesa</h3>
        {decision.modo !== 'registrado' && (
          <button
            type="button"
            onClick={() => setAbrirBuscador((n) => n + 1)}
            className="text-[11px] font-semibold text-primary transition-colors hover:text-primary-hover"
          >
            Buscar otro
          </button>
        )}
      </div>

      {decision.modo === 'registrado' ? (
        <div className="mt-1.5">
          <Intereses clave={conversacion.clave} compacto senalAbrir={abrirBuscador} />
        </div>
      ) : decision.modo === 'propuesta' ? (
        <div className="mt-1.5">
          <div className="flex items-center gap-1.5">
            <span
              title={decision.curso.nombre}
              className={
                'min-w-0 flex-1 truncate rounded-lg border border-dashed px-2 py-1 text-[11px] font-semibold ' +
                CLASE_FONDO_TENUE[decision.curso.color] +
                ' ' +
                CLASE_TEXTO[decision.curso.color]
              }
            >
              {decision.curso.nombre}
            </span>
            <button
              type="button"
              disabled={agregar.isPending || agregar.isSuccess}
              onClick={() => agregar.mutate(decision.curso.nombre)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-navy px-2.5 py-1 text-[11px] font-bold text-white shadow-[0_3px_12px_-5px_rgba(14,42,82,0.7)] transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.97] disabled:opacity-50"
            >
              {agregar.isPending ? (
                <Loader2 size={11} className="animate-spin" />
              ) : agregar.isSuccess ? (
                <Check size={11} />
              ) : (
                <Sparkles size={11} />
              )}
              {agregar.isSuccess ? 'Listo' : 'Es este'}
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {decision.porque} — todavía no está asentado.
          </p>
          {agregar.isError && (
            <p className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
              <AlertTriangle size={11} className="mt-px shrink-0" />
              No se guardó. Probá de nuevo o buscalo a mano.
            </p>
          )}
          {/* El buscador de siempre, por si el curso propuesto no es el que pidió:
              aparece cuando se lo pide, no ocupa lugar mientras tanto. */}
          {abrirBuscador > 0 && (
            <div className="mt-1.5">
              <Intereses clave={conversacion.clave} compacto senalAbrir={abrirBuscador} />
            </div>
          )}
        </div>
      ) : (
        <div className="mt-1.5">
          <Intereses clave={conversacion.clave} compacto senalAbrir={abrirBuscador} />
          <p className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
            <Plus size={11} className="mt-0.5 shrink-0" />
            Nadie anotó qué curso quiere. Sin esto, la etapa «Cotizado» no abre.
          </p>
        </div>
      )}
    </section>
  );
}
