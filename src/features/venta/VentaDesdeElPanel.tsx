import { AlertTriangle, ShoppingCart, UserPlus, X } from 'lucide-react';
import { useEscape } from '../../lib/teclado/useEscape';
import { useFicha } from '../cerberus/useFicha';
import { FormularioVenta } from './FormularioVenta';
import type { Conversacion } from '../../dominio/conversaciones';

/**
 * REGISTRAR LA VENTA DESDE EL PANEL DERECHO — el destino del botón que estaba
 * clavado al pie y **nunca aparecía**.
 *
 * ── El defecto que esto cierra ──
 * `PieAccionTimeline` exige un handler para dibujar el botón —«sin handler no
 * hay botón, nunca un no-op»—, y `PanelDerecho` lo montaba sin pasarle ninguno.
 * O sea que la guarda hacía exactamente lo que promete y el botón **no podía
 * existir en ningún estado**, ni siquiera para un cliente. Nadie llegó a
 * cablearlo cuando el rediseño del timeline reemplazó a `AccionesContacto`.
 *
 * ── Por qué existe este componente y no se reusa `ModalVentaCierre` ──
 * Aquél es del Pipeline, y su salida para un lead que todavía no es cliente en
 * Cerberus dice **«abrí la conversación»** — que desde el panel derecho es un
 * consejo circular: la conversación ya está abierta, es la de al lado. Un modal
 * que manda a donde ya estás es un callejón sin salida con forma de ayuda.
 *
 * ── La regla del botón: SIEMPRE está ──
 * Decisión del dueño (4-ago-2026): *«que siempre esté ahí el botón para
 * comprar»*. No se condiciona al estado de la ficha, porque el estado de la
 * ficha es justo lo que la vendedora no puede adivinar antes de necesitarlo —
 * y una venta puede caer en cualquier conversación. Lo que cambia según el
 * estado es a dónde lleva, no si está.
 */

function Modal({
  titulo,
  onCerrar,
  children,
}: {
  titulo: string;
  onCerrar: () => void;
  children: React.ReactNode;
}) {
  useEscape(onCerrar);
  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]" onClick={onCerrar} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={titulo}
          className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-card shadow-panel"
        >
          <header className="flex shrink-0 items-center justify-between border-b border-border bg-navy px-5 py-3 text-white">
            <div className="flex items-center gap-2 font-heading text-sm font-bold">
              <ShoppingCart size={16} /> {titulo}
            </div>
            <button type="button" aria-label="Cerrar" onClick={onCerrar} className="rounded-lg p-1 hover:bg-white/10">
              <X size={16} />
            </button>
          </header>
          {children}
        </div>
      </div>
    </>
  );
}

export function VentaDesdeElPanel({
  conversacion,
  onCerrar,
}: {
  conversacion: Conversacion;
  onCerrar: () => void;
}) {
  const telefono = conversacion.persona_id ?? '';
  // La MISMA query que ya tiene el panel (misma `queryKey`): react-query la
  // comparte, así que abrir esto no dispara una segunda llamada a Cerberus —
  // que es la que tiene el techo de 12 s.
  const { data, isPending, isError } = useFicha(telefono, Boolean(telefono));

  // Es cliente: el formulario de venta de siempre, con el precio de Cerberus y
  // la conversación precargada (la venta mueve el embudo sola, server-side).
  if (data?.estado === 'cliente') {
    return (
      <FormularioVenta
        clienteId={data.id}
        clienteNombre={data.nombre}
        telefono={telefono}
        canal={conversacion.canal}
        clave={conversacion.clave}
        personaNombre={conversacion.persona_nombre}
        numeroPropio={conversacion.numero_propio}
        paisNombre={data.pais}
        onCerrar={onCerrar}
      />
    );
  }

  return (
    <Modal titulo="Registrar venta" onCerrar={onCerrar}>
      <div className="space-y-3 p-5">
        {isPending ? (
          <>
            <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-9 animate-pulse rounded-lg bg-muted" />
            <p className="text-xs text-muted-foreground">Buscando la ficha en Cerberus…</p>
          </>
        ) : isError || data?.estado === 'error' ? (
          /* «No se pudo preguntar» NO es «no es cliente»: son cosas opuestas y
             la vendedora actúa distinto en cada una. Nunca se colapsan. */
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Cerberus no respondió, así que no se puede registrar la venta ahora. No es que no sea
              cliente: es que la ficha no cargó. Probá de nuevo en un rato.
            </span>
          </div>
        ) : !telefono ? (
          <p className="text-sm text-foreground">
            Esta conversación no trae teléfono, y la ficha de Cerberus se busca por teléfono. La venta
            hay que registrarla desde Cerberus.
          </p>
        ) : (
          <>
            <p className="flex items-start gap-2 text-sm text-foreground">
              <UserPlus size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span>
                <b>{conversacion.persona_nombre ?? telefono}</b> todavía no está como cliente en
                Cerberus, y la venta necesita el cliente creado.
              </span>
            </p>
            {/* La salida CONCRETA, no «abrí la conversación» (ya estás en ella).
                Hermes no da de alta clientes: eso vive en Cerberus, y decirlo es
                más útil que un botón que no existe. */}
            <p className="text-xs text-muted-foreground">
              Creálo en Cerberus con este número —{' '}
              <span className="font-mono text-foreground">{telefono}</span> — y volvé acá: en cuanto la
              ficha lo encuentre, este botón abre el formulario de venta con el precio ya cargado.
            </p>
          </>
        )}
      </div>
      <footer className="flex shrink-0 justify-end border-t border-border p-4">
        <button
          type="button"
          onClick={onCerrar}
          className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-foreground transition-colors hover:bg-muted"
        >
          Cerrar
        </button>
      </footer>
    </Modal>
  );
}
