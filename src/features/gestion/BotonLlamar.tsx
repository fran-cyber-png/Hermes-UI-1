import { useState } from 'react';
import { Check, Copy, Phone } from 'lucide-react';
import { abrirExterno } from '../../lib/enlacesExternos';

/**
 * LLAMAR — con red de seguridad.
 *
 * El `tel:` abre el marcador del sistema (FaceTime en Mac, Phone Link en
 * Windows)… si hay uno configurado. Si no hay, el clic moriría en silencio —
 * y un botón que a veces no hace nada es un botón roto. Por eso acá el clic
 * SIEMPRE responde: intenta abrir el marcador Y muestra el número con
 * "Copiar" — lo peor que puede pasar es que la vendedora marque a mano.
 */
export function BotonLlamar({ telefono, compacto = false }: { telefono: string; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const digitos = telefono.replace(/\D/g, '');
  if (digitos.length < 8) return null;

  function llamar(e: React.MouseEvent) {
    e.stopPropagation();
    abrirExterno(`tel:+${digitos}`);
    setAbierto(true);
    window.setTimeout(() => setAbierto(false), 6000);
  }

  async function copiar(e: React.MouseEvent) {
    e.stopPropagation();
    await navigator.clipboard.writeText(`+${digitos}`);
    setCopiado(true);
    window.setTimeout(() => {
      setCopiado(false);
      setAbierto(false);
    }, 1500);
  }

  return (
    <span className="relative inline-flex">
      {compacto ? (
        <Phone size={13} className="cursor-pointer text-success" aria-label="Llamar" onClick={llamar} />
      ) : (
        <button
          type="button"
          title={`Llamar al +${digitos}`}
          onClick={llamar}
          className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-success hover:text-success"
        >
          <Phone size={11} /> Llamar
        </button>
      )}

      {abierto && (
        <span
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-7 z-40 flex w-56 items-center gap-2 rounded-xl bg-card p-2.5 shadow-panel ring-1 ring-border"
        >
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-xs font-semibold text-foreground">+{digitos}</span>
            <span className="block text-[11px] leading-tight text-muted-foreground">
              Si el marcador no se abrió, copialo:
            </span>
          </span>
          <button
            type="button"
            onClick={copiar}
            className={
              'flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition-colors ' +
              (copiado ? 'bg-success/10 text-success' : 'bg-navy text-white hover:bg-navy/90')
            }
          >
            {copiado ? <Check size={11} /> : <Copy size={11} />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </span>
      )}
    </span>
  );
}
