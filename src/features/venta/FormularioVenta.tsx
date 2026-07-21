import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Megaphone, Plus, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { useCrearVenta, useFormularioVenta, useProductos, type ProductoCurso } from './useVenta';

/** Cerberus llama "Origen" al canal por donde llegó el lead. Se infiere, no se elige. */
const ORIGEN_POR_CANAL: Record<string, { id: string; nombre: string }> = {
  whatsapp: { id: 'whatsapp', nombre: 'WhatsApp' },
  facebook: { id: 'facebook', nombre: 'Facebook' },
  instagram: { id: 'instagram', nombre: 'Instagram' },
};

/**
 * EL FORMULARIO DE VENTA, DENTRO DE HERMES.
 *
 * La vendedora llena esto y Hermes lo manda a Cerberus con su sesión — ella nunca
 * abre Cerberus. **Medio y Origen se llenan solos** desde la atribución que ya
 * capturamos: vino por WhatsApp (origen), y si fue de un anuncio, el medio es
 * "pagado". Sigue editable por si hace falta.
 */

interface Props {
  clienteId: number;
  clienteNombre: string;
  /** El teléfono del contacto — para leer de dónde vino el lead (origen/medio). */
  telefono: string;
  /** El canal de la conversación — de ahí se infiere el Origen. */
  canal: string;
  onCerrar: () => void;
  /** La conversación de origen: con esto la venta mueve el embudo sola. */
  clave?: string | null;
  personaNombre?: string | null;
  numeroPropio?: string | null;
}

interface Linea {
  producto: ProductoCurso;
  cantidad: number;
}

export function FormularioVenta({ clienteId, clienteNombre, telefono, canal, clave, personaNombre, numeroPropio, onCerrar }: Props) {
  const { data: form, isPending: cargandoForm } = useFormularioVenta(true);
  const crear = useCrearVenta();

  // El origen del lead (anuncio/landing) — misma query cacheada que el hilo, sin
  // fetch extra. Sirve para inferir el MEDIO (pagado si vino de un anuncio).
  const { data: conv } = useQuery({
    queryKey: ['wa', 'conversacion', telefono],
    queryFn: () => api<{ origen: { fuente?: string } | null }>(`/api/whatsapp/conversacion/${telefono}`),
    enabled: Boolean(telefono),
    staleTime: 60_000,
  });

  // NO se muestran ni se eligen: se INFIEREN de dónde vino el lead.
  //  · Origen = el canal (WhatsApp / Facebook / Instagram).
  //  · Medio  = pagado si llegó por un anuncio; si no, orgánico.
  const origenInfo = ORIGEN_POR_CANAL[canal] ?? ORIGEN_POR_CANAL.whatsapp;
  const medio = conv?.origen?.fuente === 'anuncio' ? 'pagado' : 'organico';
  const medioNombre = medio === 'pagado' ? 'Pagado' : 'Orgánico';

  const [monedaId, setMonedaId] = useState('');
  const [paisId, setPaisId] = useState('');
  const [preventa, setPreventa] = useState(true);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  const { data: prods } = useProductos(busqueda, busqueda.length >= 2);

  const monto = useMemo(
    () => lineas.reduce((s, l) => s + l.producto.precioPromocion * l.cantidad, 0),
    [lineas],
  );

  function agregar(p: ProductoCurso) {
    setLineas((ls) => (ls.some((l) => l.producto.id === p.id) ? ls : [...ls, { producto: p, cantidad: 1 }]));
    setBusqueda('');
  }
  function cantidad(id: string, delta: number) {
    setLineas((ls) => ls.map((l) => (l.producto.id === id ? { ...l, cantidad: Math.max(1, l.cantidad + delta) } : l)));
  }
  function quitar(id: string) {
    setLineas((ls) => ls.filter((l) => l.producto.id !== id));
  }

  async function registrar(saveMode: 'cotizacion' | 'venta') {
    if (!monedaId || !paisId || lineas.length === 0) return;
    const r = await crear.mutateAsync({
      clienteId,
      monedaId,
      paisId,
      preventa,
      medio,
      origen: origenInfo.id,
      montoTotal: monto,
      productos: lineas.map((l) => ({
        productoId: l.producto.id,
        nombre: l.producto.nombre,
        cantidad: l.cantidad,
        precioRegular: l.producto.precioNormal,
        precioVenta: l.producto.precioPromocion,
      })),
      saveMode,
      // El contexto de la conversación: con esto el server asienta intereses,
      // conversión y etapa (cotizado/cierre) — el embudo se mueve solo.
      telefono,
      canal,
      clave: clave ?? null,
      personaNombre: personaNombre ?? null,
      numeroPropio: numeroPropio ?? null,
    });
    setSaved(saveMode === 'venta' ? 'Venta registrada en Cerberus.' : 'Cotización registrada en Cerberus.' + (r.folio ? ` (${r.folio})` : ''));
  }

  const puede = monedaId && paisId && lineas.length > 0 && !crear.isPending;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]" onClick={onCerrar} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-panel">
          <header className="flex shrink-0 items-center justify-between border-b border-border bg-navy px-5 py-3 text-white">
            <div className="flex items-center gap-2 text-sm font-bold">
              <ShoppingCart size={16} /> Registrar venta
            </div>
            <button type="button" onClick={onCerrar} className="rounded-lg p-1 hover:bg-white/10">
              <X size={16} />
            </button>
          </header>

          {saved ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                <Check size={24} />
              </div>
              <p className="text-sm font-bold text-foreground">{saved}</p>
              <button onClick={onCerrar} className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
                Cerrar
              </button>
            </div>
          ) : cargandoForm ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Cargando formulario…</div>
          ) : !form ? (
            <div className="p-10 text-center text-sm text-destructive">
              No se pudo cargar el formulario. La sesión de Cerberus pudo expirar — volvé a entrar.
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              {/* Cliente (ya identificado por teléfono) */}
              <Campo label="Cliente">
                <div className="rounded-lg border border-border bg-muted px-3 py-2 text-sm font-semibold text-foreground">
                  {clienteNombre}
                </div>
              </Campo>

              <div className="grid grid-cols-2 gap-3">
                <Campo label="Moneda">
                  <Select value={monedaId} onChange={setMonedaId} placeholder="Moneda" opciones={form.monedas} />
                </Campo>
                <Campo label="País">
                  <Select value={paisId} onChange={setPaisId} placeholder="País" opciones={form.paises} />
                </Campo>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={preventa} onChange={(e) => setPreventa(e.target.checked)} />
                Preventa (cursos sin stock: no exige local ni ubicación)
              </label>

              {/* Origen y Medio NO se eligen: se infieren de dónde vino el lead. */}
              <div className="flex items-center gap-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-secondary-foreground">
                <Megaphone size={13} className="shrink-0" />
                <span>
                  Origen <b>{origenInfo.nombre}</b> · Medio <b>{medioNombre}</b>
                  <span className="text-muted-foreground"> — inferidos de por dónde vino el lead</span>
                </span>
              </div>

              {/* Productos */}
              <Campo label="Cursos">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
                  <input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar curso…"
                    className="w-full rounded-lg border border-border bg-muted py-2 pl-8 pr-3 text-sm outline-none focus:border-primary"
                  />
                  {prods && busqueda.length >= 2 && prods.productos.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-panel">
                      {prods.productos.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => agregar(p)}
                          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-muted"
                        >
                          <span className="truncate">{p.nombre}</span>
                          <span className="flex items-center gap-1 font-semibold text-navy">
                            {p.precioPromocion} <Plus size={12} />
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </Campo>

              {lineas.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {lineas.map((l) => (
                    <li key={l.producto.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{l.producto.nombre}</span>
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => cantidad(l.producto.id, -1)} className="size-5 rounded bg-card">−</button>
                        <span className="w-5 text-center tabular-nums">{l.cantidad}</span>
                        <button type="button" onClick={() => cantidad(l.producto.id, 1)} className="size-5 rounded bg-card">+</button>
                      </div>
                      <span className="w-16 text-right font-semibold tabular-nums text-navy">
                        {(l.producto.precioPromocion * l.cantidad).toFixed(2)}
                      </span>
                      <button type="button" onClick={() => quitar(l.producto.id)} className="text-destructive">
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Monto total</span>
                <span className="text-lg font-extrabold tabular-nums text-navy">{monto.toFixed(2)}</span>
              </div>

              {crear.isError && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {crear.error instanceof ErrorApi ? crear.error.message : 'No se pudo registrar.'}
                </div>
              )}
            </div>
          )}

          {!saved && form && (
            <footer className="flex shrink-0 gap-2 border-t border-border p-4">
              <button
                type="button"
                onClick={() => void registrar('cotizacion')}
                disabled={!puede}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                Cotización
              </button>
              <button
                type="button"
                onClick={() => void registrar('venta')}
                disabled={!puede}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-navy py-2.5 text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40"
              >
                {crear.isPending ? <Loader2 size={15} className="animate-spin" /> : <ShoppingCart size={15} />}
                Registrar venta
              </button>
            </footer>
          )}
        </div>
      </div>
    </>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, placeholder, opciones }: { value: string; onChange: (v: string) => void; placeholder: string; opciones: { id: string; nombre: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-primary"
    >
      <option value="">Seleccione {placeholder}</option>
      {opciones.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nombre}
        </option>
      ))}
    </select>
  );
}
