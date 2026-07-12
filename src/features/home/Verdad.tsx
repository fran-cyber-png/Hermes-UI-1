import { Link } from 'react-router-dom';
import { AlertTriangle, Archive, ArrowRight, Clock, MessageSquareQuote } from 'lucide-react';
import type { Accionable, Cerrado, Lazo, Preguntas } from '../../lib/datos/overview';

/**
 * Las cuatro tarjetas que dicen la verdad.
 *
 * La home vieja contaba VOLUMEN: "946 sin atender". Verdadero e inútil — de esos 946, a 928 Meta
 * les cerró la puerta y no se les puede escribir nunca más. Un contador gigante de pendientes no
 * es un sistema de trabajo: es una acusación. Y cuando la mayoría son inalcanzables, es una
 * acusación falsa.
 *
 * Estas cuatro cuentan lo que se puede mirar y hacer algo.
 */

function pct(n: number, de: number): string {
  return de > 0 ? `${((100 * n) / de).toFixed(1)}%` : '—';
}

/**
 * 1. EL LAZO. Va arriba de todo porque es la razón de ser del sistema.
 *
 * Quitarle a Meta la señal de conversión sube el costo mediano por cliente incremental de
 * US$38,16 a US$49,93 — un 31% más caro (RCT con 70.000+ anunciantes, NBER w32765 /
 * Marketing Science 2025). El evento de conversión ES la variable dependiente del modelo de
 * entrega de Meta: si no se lo mandamos, está adivinando.
 */
export function CardLazo({ lazo }: { lazo: Lazo }) {
  if (!lazo.conectado) {
    return (
      <div className="rounded-2xl border-2 border-destructive/30 bg-destructive/5 px-6 py-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-destructive" size={20} />
          <div className="flex-1">
            <h2 className="font-heading text-lg font-bold text-navy">
              Meta no sabe que vendiste.
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pagamos por traer gente, y nunca le contamos a Meta quién compró. Optimiza contra
              «alguien abrió un chat», no contra «alguien pagó».
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Falta conectar Cerberus, donde vive la venta.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card px-6 py-5">
      <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted-foreground">
        El lazo con Meta
      </h2>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="text-3xl font-bold text-success">
          {lazo.reportadas.toLocaleString('es')}
        </span>
        <span className="text-sm text-muted-foreground">
          de {lazo.ventasConocidas.toLocaleString('es')} ventas, reportadas a Meta
        </span>
      </div>
      {lazo.perdidasPorVentana > 0 && (
        // El 17%: Tesorería confirmó tarde y Meta rechaza el evento. Antes fallaba en SILENCIO.
        <p className="mt-2 text-sm text-destructive">
          {lazo.perdidasPorVentana.toLocaleString('es')} se perdieron porque el pago se confirmó
          después de los 7 días que Meta acepta.
        </p>
      )}
    </div>
  );
}

/**
 * 2. LO QUE SE PUEDE HACER HOY.
 *
 * Decenas, no 94.371. Es la única cola que una persona puede mirar y actuar.
 */
export function CardAccionable({ a }: { a: Accionable }) {
  const urge = a.horasRestantesMasUrgente != null && a.horasRestantesMasUrgente < 24;

  return (
    <Link
      to="/bandeja"
      className="group rounded-2xl border border-border bg-card px-6 py-5 transition-colors hover:border-primary/40"
    >
      <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Se puede responder ahora
      </h2>

      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-4xl font-bold text-navy">{a.total}</span>
        <span className="text-sm text-muted-foreground">
          {a.total === 1 ? 'persona' : 'personas'}
        </span>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        {a.porCanal.map((c) => `${c.n} en ${c.canal}`).join(' · ') || 'Nada dentro de ventana'}
      </p>

      {a.horasRestantesMasUrgente != null && (
        <p
          className={
            'mt-3 flex items-center gap-1.5 text-sm font-bold ' +
            (urge ? 'text-destructive' : 'text-muted-foreground')
          }
        >
          <Clock size={14} />
          {/* El reloj de Meta. Cuando llega a cero, esa persona es inalcanzable para siempre. */}
          A la más urgente le quedan {a.horasRestantesMasUrgente}{' '}
          {a.horasRestantesMasUrgente === 1 ? 'hora' : 'horas'}
        </p>
      )}

      <span className="mt-3 flex items-center gap-1 text-sm font-bold text-primary">
        Trabajar
        <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

/**
 * 3. LO QUE META CERRÓ.
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
 * 4. QUÉ PREGUNTA LA GENTE. El dato que le sirve al creativo, y que nadie miraba.
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
