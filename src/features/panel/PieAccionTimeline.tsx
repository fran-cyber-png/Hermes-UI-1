import { ShoppingCart } from 'lucide-react';
import type { EstadoContacto } from './estadoContacto';

interface PropsPieAccion {
  estado: EstadoContacto;
  /** Abre el registro de la venta. Sin esto no hay botón — nunca un no-op (MVP-7). */
  onVender?: () => void;
}

/**
 * EL PIE DEL PANEL — «Registrar venta», y **siempre está**.
 *
 * ══ QUÉ ESTABA MAL ═══════════════════════════════════════════════════════
 *
 * Este pie exigía un handler para dibujar el botón (bien: nunca un no-op) y
 * `PanelDerecho` lo montaba **sin pasarle ninguno**. La guarda hacía justo lo
 * que promete, así que el botón **no podía aparecer en ningún estado** — ni
 * siquiera para un cliente. Nadie llegó a cablearlo cuando el rediseño del
 * timeline reemplazó a `AccionesContacto`, y el `CLAUDE.md` siguió diciendo que
 * estaba «al pie y siempre visible».
 *
 * ══ Y POR QUÉ AHORA NO DEPENDE DEL ESTADO ════════════════════════════════
 *
 * Antes el botón salía solo con la ficha en `cliente`, y para un lead nuevo
 * decía «Marcar como interesado». Eso invierte el orden real de los hechos: una
 * venta puede caer en CUALQUIER conversación, y el estado de la ficha es
 * justamente lo que la vendedora no puede adivinar antes de necesitarlo. Si el
 * botón aparece y desaparece según un dato que llega de Cerberus con hasta 12
 * segundos de retraso, deja de ser un lugar donde la mano va sola.
 *
 * Decisión del dueño (4-ago-2026): *«que siempre esté ahí el botón para
 * comprar»*. Lo que cambia según el estado es **a dónde lleva**
 * (`VentaDesdeElPanel`), no si existe.
 *
 * Clavado y no al final del scroll por la lección de ADR 0017: a 1280×720 con
 * dos respuestas cargadas, el reparto flex lo empujaba fuera del panel.
 */
export function PieAccionTimeline({ estado, onVender }: PropsPieAccion) {
  if (!onVender) return null;

  return (
    <div className="shrink-0 border-t border-border px-4 py-3">
      <button
        type="button"
        onClick={onVender}
        title={
          estado.tono === 'cliente'
            ? 'Ya es cliente en Cerberus: abre el formulario con el precio cargado'
            : 'Registrar una venta de esta persona'
        }
        className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-[background-color,transform] hover:bg-primary-hover active:scale-[0.99]"
      >
        <ShoppingCart size={15} aria-hidden />
        Registrar venta
      </button>
    </div>
  );
}
