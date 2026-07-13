import { Archive, MessageSquareQuote } from 'lucide-react';
import type { Cerrado, Preguntas } from '../../lib/datos/overview';

/**
 * Dos tarjetas que dicen la verdad de lo que ya no se puede tocar, y de lo que la gente pide.
 *
 * El lazo con Meta y la cola accionable se mudaron al embudo del home (FlujoEmbudo y
 * BandejaCanales). Acá quedan las dos que no tienen otro lugar natural: lo que Meta cerró
 * —que no es deuda, es audiencia— y qué escribe la gente, el dato que le sirve al creativo.
 */

function pct(n: number, de: number): string {
  return de > 0 ? `${((100 * n) / de).toFixed(1)}%` : '—';
}

/**
 * LO QUE META CERRÓ.
 *
 * Sin adornos y sin culpa: no es trabajo pendiente, es archivo. Sin el permiso `human_agent`
 * (verificado ausente con `debug_token`), a las conversaciones de Messenger de más de 24 h NO SE
 * LES PUEDE ESCRIBIR. Nunca. Mostrarlas como "pendientes" es mentir.
 *
 * Su destino real es audiencia publicitaria, no conversación.
 */
export function CardCerrado({ c }: { c: Cerrado }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-5">
      <div className="flex items-start gap-3">
        <Archive className="mt-0.5 shrink-0 text-muted-foreground" size={18} />
        <div>
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Meta cerró la puerta
          </h2>
          <p className="mt-1 text-2xl font-bold text-muted-foreground">
            {c.total.toLocaleString('es')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {c.mensajes.toLocaleString('es')} mensajes (ventana de 24 h) ·{' '}
            {c.comentarios.toLocaleString('es')} comentarios (más de 7 días)
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            <strong className="text-foreground">No es deuda: es audiencia.</strong> No se les puede
            escribir, pero sí llegarles con publicidad.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * QUÉ PREGUNTA LA GENTE. El dato que le sirve al creativo, y que nadie miraba.
 *
 * El hallazgo más grande no es una pregunta: 1 de cada 5 personas escribe SOLO su número de
 * teléfono y se va. No es una consulta — es una entrega. Alguien te está dando la llave.
 *
 * Ningún paper de marketing menciona esto. Solo se sabe leyendo lo que escribieron.
 */
export function CardPreguntas({ p }: { p: Preguntas }) {
  const precioOInfo = p.precio + p.info;

  return (
    <div className="rounded-2xl border border-border bg-card px-6 py-5">
      <div className="flex items-start gap-3">
        <MessageSquareQuote className="mt-0.5 shrink-0 text-primary" size={18} />
        <div className="flex-1">
          <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Qué escribe la gente
          </h2>

          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">
                Solo dejan su teléfono, sin preguntar nada
              </dt>
              <dd className="font-bold text-navy">{pct(p.soloTelefono, p.conTexto)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Preguntan el precio o piden «info»</dt>
              <dd className="font-bold text-navy">{pct(precioOInfo, p.conTexto)}</dd>
            </div>
          </dl>

          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            <strong className="text-foreground">El anuncio no muestra el precio.</strong> Por eso
            preguntan. Es trabajo humano que se evita con una decisión de copy.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sobre {p.conTexto.toLocaleString('es')} mensajes con texto.
          </p>
        </div>
      </div>
    </div>
  );
}
