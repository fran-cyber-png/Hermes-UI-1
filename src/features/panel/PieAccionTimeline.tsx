import { Loader2, ShoppingCart, Sparkles, type LucideIcon } from 'lucide-react';
import type { EstadoContacto, TonoContacto } from './estadoContacto';

interface PropsPieAccion {
  estado: EstadoContacto;
  onAccion?: () => void;
}

const TONO_BOTON: Partial<Record<TonoContacto, { label: string; icono: LucideIcon }>> = {
  cliente: { label: 'Registrar venta', icono: ShoppingCart },
  nuevo: { label: 'Marcar como interesado', icono: Sparkles },
};

const MENSAJE_TONO: Record<string, string> = {
  cargando: 'Esperando la ficha de Cerberus…',
  'sin-saber': 'Sin la ficha no se puede registrar una venta',
};

function BotonPrimario({
  label,
  icono,
  cargando,
  onClick,
}: {
  label: string;
  icono: LucideIcon;
  cargando?: boolean;
  onClick: () => void;
}) {
  const Icono = icono;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={cargando}
      className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-[background-color,transform] hover:bg-primary-hover active:scale-[0.99] disabled:opacity-50"
    >
      {cargando ? (
        <Loader2 size={15} aria-hidden className="animate-spin" />
      ) : (
        <Icono size={15} aria-hidden />
      )}
      {label}
    </button>
  );
}

/**
 * Un solo botón con estados, no markup duplicado (V2-6). Sin handler no hay
 * botón — nunca un no-op (MVP-7): el mensaje ocupa la misma h-10 centrada
 * que el botón, así el pie no cambia de altura.
 */
export function PieAccionTimeline({ estado, onAccion }: PropsPieAccion) {
  const boton = TONO_BOTON[estado.tono];

  if (boton && onAccion) {
    return (
      <div className="shrink-0 border-t border-border px-4 py-3">
        <BotonPrimario label={boton.label} icono={boton.icono} onClick={onAccion} />
      </div>
    );
  }

  const mensaje = MENSAJE_TONO[estado.tono] ?? null;
  if (!mensaje) return null;

  return (
    <div className="shrink-0 border-t border-border px-4 py-3">
      <p className="flex h-10 items-center justify-center text-center text-[11px] text-muted-foreground">
        {mensaje}
      </p>
    </div>
  );
}
