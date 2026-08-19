import { useState } from 'react';
import { Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useProductos, type ProductoCurso, type ProductoElegido } from '../venta/useVenta';

/**
 * EL CARRITO DE LA FICHA — qué quiere llevarse el cliente, ANTES de registrar
 * la venta. Vive en el panel de la conversación, no en el formulario de venta:
 * la vendedora lo arma mientras charla, sin precio (eso se negocia recién al
 * cerrar), y al tocar «Registrar venta» esos mismos productos ya están puestos
 * en el carrito de `FormularioVenta` — no hay que volver a buscarlos.
 *
 * Solo de la SESIÓN (decisión explícita, 19-ago-2026): vive en `useState` de
 * `PanelDerecho`, igual que el carrito de `FormularioVenta` hoy — se pierde si
 * se cierra la conversación o se recarga la app. Persistirlo de verdad es
 * otro frente si hace falta.
 */
export function CarritoDeseado({
  productos,
  onCambiar,
}: {
  productos: ProductoElegido[];
  onCambiar: (productos: ProductoElegido[]) => void;
}) {
  const [busqueda, setBusqueda] = useState('');
  const { data: prods } = useProductos(busqueda, busqueda.length >= 2);

  function agregar(p: ProductoCurso) {
    if (!productos.some((l) => l.producto.id === p.id)) {
      onCambiar([...productos, { producto: p, cantidad: 1 }]);
    }
    setBusqueda('');
  }
  function cantidad(id: string, delta: number) {
    onCambiar(productos.map((l) => (l.producto.id === id ? { ...l, cantidad: Math.max(1, l.cantidad + delta) } : l)));
  }
  function quitar(id: string) {
    onCambiar(productos.filter((l) => l.producto.id !== id));
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <ShoppingCart size={12} /> Carrito
      </h3>

      <div className="relative">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar producto…"
          className="w-full rounded-lg border border-border bg-muted px-3 py-1.5 text-xs outline-none focus:border-primary"
        />
        {prods && busqueda.length >= 2 && prods.productos.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-lg bg-card shadow-panel">
            {prods.productos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => agregar(p)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] hover:bg-muted"
              >
                <Plus size={11} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{p.nombre}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {productos.length === 0 ? (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Sin productos todavía — buscá arriba lo que el cliente quiere llevar. El precio se define
          recién al registrar la venta.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {productos.map((l) => (
            <li
              key={l.producto.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 py-1.5 text-[11px]"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{l.producto.nombre}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Una menos"
                  onClick={() => cantidad(l.producto.id, -1)}
                  className="size-5 rounded-md border border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  −
                </button>
                <span className="w-4 text-center tabular-nums">{l.cantidad}</span>
                <button
                  type="button"
                  aria-label="Una más"
                  onClick={() => cantidad(l.producto.id, 1)}
                  className="size-5 rounded-md border border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                aria-label={`Quitar ${l.producto.nombre}`}
                onClick={() => quitar(l.producto.id)}
                className="text-destructive"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
