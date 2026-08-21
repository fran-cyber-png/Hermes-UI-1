import { Moon, Sun } from 'lucide-react';
import { useTema } from '../lib/tema';

/**
 * LA PERILLA DEL TEMA — una, en la barra de arriba, para toda la app.
 *
 * Vive pegada a «Ivi» y no adentro de una vista por la misma razón que Ivi: no
 * es de la Agenda ni de la Libreta, es de la mesa. El botón anterior estaba en
 * la barra de la Agenda y solo pintaba la Agenda, así que la vendedora que lo
 * apretaba desde ahí y después entraba a la Libreta veía otra cosa.
 *
 * Ícono solo, sin rótulo: es la única pieza de esta barra que no informa nada —
 * las otras (Ivi, la salud del canal, la auto-respuesta) dicen algo aunque no
 * las toques. Y el ícono muestra A DÓNDE VA, no dónde está: con el tema oscuro
 * puesto se ve un sol, que es lo que vas a obtener si lo apretás.
 */
export function BotonDeTema() {
  const { tema, alternar } = useTema();
  const aOscuro = tema === 'claro';

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={aOscuro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      title={aOscuro ? 'Modo oscuro' : 'Modo claro'}
      className="group flex size-12 shrink-0 items-center justify-center rounded-full transition-transform duration-200 ease-house active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {/* El relleno blanco mide 32px — lo mismo que el círculo VISIBLE del
          anillo del bot (medido: su `<circle>` da 32px de diámetro dentro de
          un botón de 48px). El botón entero sigue midiendo 48px, para que el
          área de clic no encoja; lo que se achica es solo el disco pintado. */}
      <span className="flex size-8 items-center justify-center rounded-full bg-white text-muted-foreground transition-colors duration-200 ease-house group-hover:text-navy-ink">
        {aOscuro ? <Moon size={18} strokeWidth={2} /> : <Sun size={18} strokeWidth={2} className="text-gold-ink" />}
      </span>
    </button>
  );
}
