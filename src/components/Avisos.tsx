import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { escucharAvisos, type Aviso } from '../lib/avisos';

/**
 * EL ACUSE DE UNA ACCIÓN, EN PANTALLA.
 *
 * Existe para poder BORRAR confirmaciones, no para agregar ruido: registrar,
 * agendar o etiquetar no preguntan «¿estás segura?» —son reversibles y
 * cotidianas— pero sí tienen que ACUSAR, o la vendedora no sabe si se guardó y
 * vuelve a apretar.
 *
 * Se monta UNA vez, en el shell. El bus vive en `lib/avisos.ts`.
 */

/** Cuánto queda en pantalla. Alcanza para leerlo sin quedarse tapando nada. */
const DURACION_MS = 3200;

export function Avisos() {
  const [aviso, setAviso] = useState<Aviso | null>(null);

  useEffect(() => escucharAvisos(setAviso), []);

  // El timer se rearma con cada aviso nuevo: el último gana, y el anterior no
  // se lleva puesto el tiempo del que lo reemplazó.
  useEffect(() => {
    if (!aviso) return;
    const t = window.setTimeout(() => setAviso(null), DURACION_MS);
    return () => window.clearTimeout(t);
  }, [aviso]);

  if (!aviso) return null;

  return (
    <div
      // `polite` y no `assertive`: es un acuse de algo que la vendedora acaba de
      // hacer, no una alerta que deba interrumpir lo que esté leyendo.
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 animate-entrar"
    >
      <span className="flex items-center gap-2 rounded-full bg-navy px-4 py-2 text-xs font-semibold text-white shadow-panel">
        <Check size={13} className="shrink-0" />
        {aviso.texto}
      </span>
    </div>
  );
}
