import { useState } from 'react';
import { Check, Copy, Lightbulb, ServerCrash } from 'lucide-react';
import { ErrorApi } from '../../lib/datos/cliente';
import { sectionLabel } from '../../lib/styles';
import type { Conversacion } from '../canales/conversaciones';
import { ponerEnComposer } from '../whatsapp/puenteComposer';
import { PORQUE_DEL_MOMENTO, useHechos, type HechoRecomendado } from './hechos';

/**
 * LOS DATOS RECOMENDADOS — la munición que la vendedora tiene y no usa.
 *
 * ══ EL NÚMERO QUE LO JUSTIFICA (#153) ════════════════════════════════════════
 *
 * Sobre 1.876 conversaciones reales:
 *
 *   · «El acceso lo tiene por **todo un año**» → dicho **1 vez**
 *   · «Se puede **pagar en cuotas**»           → **2**
 *   · «Es para **público general**»            → **3**
 *   · «Este es nuestro **canal oficial**»      → **1**
 *
 * Y en los transcripts **cada uno desbloqueó la venta en el acto**: alguien
 * pagó menos de un minuto después de que le concedieran las dos cuotas; otra
 * persona contestó «Ah super» al enterarse del acceso por un año. No es que la
 * vendedora no los sepa: es que mientras escribe no los tiene a mano.
 *
 * ══ QUÉ NO ES ═══════════════════════════════════════════════════════════════
 *
 * **No son las dos respuestas.** Aquéllas son secuencias completas que salen
 * espaciadas por `EnvioControlado`, con progreso y cancelables. Esto es UNA
 * línea, y **tocarla NO envía**: cae en la caja para que la vendedora la lea,
 * la ajuste y la mande ella (la misma distinción de #45). Por eso el gesto es
 * distinto y el botón no dice «Mandar».
 *
 * Cuál corresponde lo decide el server con `momentoDeVenta()`, el mismo
 * clasificador de las dos respuestas y de la auto-respuesta nocturna: una sola
 * cabeza, tres consumidores.
 */

function Chip({ h, telefono }: { h: HechoRecomendado; telefono: string | null }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <li className="group/h flex items-start gap-1 rounded-lg border border-border bg-card px-2 py-1.5 transition-colors hover:border-primary/40">
      <button
        type="button"
        onClick={() =>
          telefono &&
          ponerEnComposer({
            telefono,
            texto: h.texto,
            // De qué pieza salió (#169): la clave del catálogo, que es estable
            // aunque el rótulo se renombre. Sin esto, un dato que destrabó una
            // venta llega al server indistinguible de un texto escrito de cero.
            pieza: { clase: 'hecho', ref: h.clave, via: 'panel-datos' },
          })
        }
        title={h.texto}
        aria-label={`Poner en la caja: ${h.rotulo}`}
        disabled={!telefono}
        className="min-w-0 flex-1 text-left disabled:opacity-50"
      >
        <span className="block text-[11px] font-semibold leading-tight text-navy">{h.rotulo}</span>
        <span className="mt-0.5 block truncate text-[10px] leading-tight text-muted-foreground">
          {h.texto}
        </span>
      </button>
      <button
        type="button"
        title="Copiar la frase"
        aria-label={`Copiar: ${h.rotulo}`}
        onClick={() => {
          void navigator.clipboard?.writeText(h.texto);
          setCopiado(true);
          window.setTimeout(() => setCopiado(false), 1500);
        }}
        className="mt-0.5 shrink-0 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/h:opacity-100"
      >
        {copiado ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      </button>
    </li>
  );
}

export function BloqueHechos({ conversacion }: { conversacion: Conversacion }) {
  const esWa = conversacion.canal === 'whatsapp';
  const { data, isPending, error } = useHechos(conversacion.clave, esWa);
  const telefono = conversacion.persona_id;

  if (!esWa) return null;

  if (isPending) {
    return (
      <section className="shrink-0 border-t border-border px-3 py-2.5">
        <div className={sectionLabel}>Datos que ayudan acá</div>
        <div className="mt-1.5 space-y-1">
          <div className="h-9 animate-pulse rounded-lg bg-muted" />
          <div className="h-9 animate-pulse rounded-lg bg-muted" />
        </div>
      </section>
    );
  }

  // Igual que las sugerencias: un fallo NO se muestra como «no hay nada que
  // decir». Un 404 acá significa que el servidor todavía no tiene la ruta.
  if (error) {
    const status = error instanceof ErrorApi ? error.status : 0;
    return (
      <section className="shrink-0 border-t border-border px-3 py-2.5">
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-[11px] leading-snug text-warning-foreground">
          <ServerCrash size={12} className="mt-0.5 shrink-0" />
          {status === 404
            ? 'Este servidor todavía no sirve los datos recomendados: falta desplegar.'
            : 'No se pudieron traer los datos recomendados.'}
        </p>
      </section>
    );
  }

  const hechos = data?.hechos ?? [];
  if (hechos.length === 0) return null;

  return (
    <section className="shrink-0 border-t border-border px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={'flex items-center gap-1.5 ' + sectionLabel}>
          <Lightbulb size={12} /> Datos que ayudan acá
        </h3>
        <span className="shrink-0 text-[10px] text-muted-foreground">tocá para ponerlo en la caja</span>
      </div>

      <ul className="mt-1.5 flex flex-col gap-1">
        {hechos.map((h) => (
          <Chip key={h.clave} h={h} telefono={telefono} />
        ))}
      </ul>

      <div className="mt-1 flex items-baseline justify-between gap-2">
        <p className="min-w-0 text-[10px] leading-snug text-muted-foreground">
          {data ? PORQUE_DEL_MOMENTO[data.momento] : ''}
          {data?.origen === 'sin-tabla' && ' · catálogo de fábrica: falta la migración para poder editarlo'}
        </p>
      </div>
    </section>
  );
}
