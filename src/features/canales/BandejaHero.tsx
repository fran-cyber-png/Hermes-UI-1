import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import type { CanalesResponse } from './types';
import { VENTANA_DIAS } from './types';

/**
 * Lo que puedes hacer HOY. Nada más.
 *
 * Antes el titular era "7.108 personas pidieron que las contactes". Es cierto,
 * y es inútil: a casi todas ya no se les puede escribir. La pantalla gritaba una
 * deuda impagable y eso no es urgencia, es parálisis.
 *
 * El titular ahora es la cola que SÍ se termina: la gente con la ventana de Meta
 * todavía abierta. El pasivo histórico sigue estando — abajo, en letra chica,
 * donde se puede mirar sin que te aplaste.
 */
export default function BandejaHero({
  estado,
  abiertas,
}: {
  estado: CanalesResponse | null;
  abiertas: number;
}) {
  const formularios = estado?.formularios;
  const vacia = abiertas === 0;

  return (
    <div className="rounded-2xl border border-border bg-navy px-6 py-6 text-white">
      {vacia ? (
        <div className="flex items-start gap-3">
          <Check size={20} className="mt-0.5 shrink-0 text-success" />
          <div>
            <p className="font-heading text-xl font-extrabold">
              No hay nadie con la ventana abierta.
            </p>
            <p className="mt-1 text-sm text-navy-muted">
              Cuando alguien comente, tienes {VENTANA_DIAS} días para escribirle en privado. Va a
              aparecer aquí arriba con el reloj corriendo.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-3">
            <span className="font-heading text-5xl font-extrabold tabular-nums text-gold">
              {abiertas}
            </span>
            <span className="text-base font-semibold">
              {abiertas === 1 ? 'persona espera' : 'personas esperan'} que les escribas
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-navy-muted">
            A estas les puedes mandar un mensaje privado hoy. Meta cierra esa puerta a los{' '}
            {VENTANA_DIAS} días del comentario — después solo queda responder en público.
          </p>
        </>
      )}

      {/* Acá SOLO va lo accionable. El histórico —cuánta gente entró, cuántos
          pidieron información— vive abajo, en el panorama, con su propio filtro
          de fechas. Si el hero también contara, habría dos cifras distintas
          diciendo lo mismo, y eso fue lo que hizo que esta pantalla mintiera. */}
      {formularios && formularios.sin_atender > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <Link
            to="/leads"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-white hover:text-gold"
          >
            {formularios.sin_atender.toLocaleString('es')} formularios sin contactar
            <ArrowRight size={13} />
          </Link>
          <p className="mt-1 text-sm text-navy-muted">
            Traen nombre, teléfono y correo. A estos se les puede escribir cuando quieras: no tienen
            ventana que se cierre.
          </p>
        </div>
      )}
    </div>
  );
}
