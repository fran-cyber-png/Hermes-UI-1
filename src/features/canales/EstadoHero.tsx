import { Clock, Inbox } from 'lucide-react';
import type { CanalesResponse, Rango } from './types';
import RangoPicker from './RangoPicker';

/**
 * El estado del sistema nervioso, en el rango elegido.
 *
 * Antes esto vivía partido en dos pantallas que se contradecían: el Pulso decía
 * "680 personas esperando" (solo miraba formularios) y Canales decía "7.149
 * pidieron que las contactes" (miraba todo). Misma realidad, dos números.
 * Ahora hay uno solo, y sale de sumar todos los canales.
 */
export default function EstadoHero({
  estado,
  rango,
  onRango,
}: {
  estado: CanalesResponse | null;
  rango: Rango;
  onRango: (r: Rango) => void;
}) {
  const canales = estado?.interacciones ?? [];
  const formularios = estado?.formularios;

  const pidenInfo = canales.reduce((s, c) => s + c.pide_info, 0) + (formularios?.total ?? 0);
  const rescatables = canales.reduce((s, c) => s + c.ventana_abierta, 0);
  const total = canales.reduce((s, c) => s + c.total, 0) + (formularios?.total ?? 0);

  return (
    <div className="rounded-2xl border border-border bg-navy px-6 py-5 text-white">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3">
            <span className="font-heading text-4xl font-extrabold tabular-nums text-gold">
              {pidenInfo.toLocaleString('es')}
            </span>
            <span className="text-sm font-semibold">personas pidieron que las contactes</span>
          </div>
          <p className="mt-1 max-w-xl text-sm text-navy-muted">
            De {total.toLocaleString('es')} interacciones. Un comentario que dice “más información” es un lead
            igual que un formulario: cambia el formato, no la intención.
          </p>
        </div>

        <RangoPicker valor={rango} onChange={onRango} oscuro />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 border-t border-white/10 pt-4 sm:grid-cols-2">
        {/* Lo único accionable hoy: a estos todavía se les puede escribir. */}
        <div className="flex items-start gap-2.5">
          <Clock size={15} className="mt-0.5 shrink-0 text-gold" />
          <p className="text-sm text-navy-muted">
            <strong className="text-white">
              A {rescatables} les puedes escribir en privado hoy.
            </strong>{' '}
            Meta cierra esa puerta a los 7 días del comentario. A los demás solo se les puede responder en
            público.
          </p>
        </div>

        <div className="flex items-start gap-2.5">
          <Inbox size={15} className="mt-0.5 shrink-0 text-navy-muted" />
          <p className="text-sm text-navy-muted">
            <strong className="text-white">
              {(formularios?.total ?? 0).toLocaleString('es')} dejaron sus datos
            </strong>{' '}
            en un formulario: nombre, teléfono y correo. Son los más fáciles de contactar.
          </p>
        </div>
      </div>
    </div>
  );
}
