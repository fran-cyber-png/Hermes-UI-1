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
      className="flex items-center rounded-lg border border-border px-1.5 py-1 text-muted-foreground transition-[color,border-color,transform] duration-200 ease-house hover:border-primary/40 hover:text-navy-ink-ink active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {aOscuro ? <Moon size={13} strokeWidth={2} /> : <Sun size={13} strokeWidth={2} />}
    </button>
  );
}
