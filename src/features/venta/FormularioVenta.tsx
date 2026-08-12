import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarPlus, Check, Copy, Loader2, Megaphone, Plus, Search, ShoppingCart, Trash2, X } from 'lucide-react';
import { api, ErrorApi } from '../../lib/datos/cliente';
import { sectionLabel } from '../../lib/styles';
import { useEscape } from '../../lib/teclado/useEscape';
import { ETAPAS, colorSegmento, rotuloEtapa } from '../../lib/etapas';
import { BarraSegmentada } from '../../components/graficos/BarraSegmentada';
import { useDashboard } from '../dashboard/dashboard';
import {
  useCrearVenta,
  useFormularioVenta,
  useLocalesDePais,
  useProductos,
  type Opcion,
  type ProductoCurso,
} from './useVenta';
import { repartirEnCuotas } from './cuotas';
import { VentaSinCerberus } from '../auth/AvisoCerberus';

/** Cerberus llama "Origen" al canal por donde llegó el lead. Se infiere, no se elige. */
const ORIGEN_POR_CANAL: Record<string, { id: string; nombre: string }> = {
  whatsapp: { id: 'whatsapp', nombre: 'WhatsApp' },
  facebook: { id: 'facebook', nombre: 'Facebook' },
  instagram: { id: 'instagram', nombre: 'Instagram' },
};

/** Referencia estable para el «todavía no hay locales»: si no, el efecto de precarga se redispara siempre. */
const SIN_LOCALES: Opcion[] = [];

/**
 * HOY, en la zona horaria de la vendedora, con la forma que pide un `<input
 * type="date">`.
 *
 * ⚠️ **No sale de `toISOString()`**, que es UTC: en Lima (UTC-5) a partir de las
 * 19:00 devuelve MAÑANA, y la primera cuota —la del pago al contado que se acaba
 * de cobrar— nacería venciendo al día siguiente.
 */
function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Lo tipeado en el precio de una línea, como número usable. Nunca negativo: un descuento no es una devolución. */
function precioDe(texto: string): number {
  const n = Number(texto.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * EL FORMULARIO DE VENTA, DENTRO DE HERMES.
 *
 * La vendedora llena esto y Hermes lo manda a Cerberus con su sesión — ella nunca
 * abre Cerberus. **Medio y Origen se llenan solos** desde la atribución que ya
 * capturamos: vino por WhatsApp (origen), y si fue de un anuncio, el medio es
 * "pagado". Sigue editable por si hace falta. Al cerrar, el RECIBO: folio
 * copiable, el embudo con Cierre creciendo, y la siguiente jugada (agendar la
 * bienvenida) servida.
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
  /** El país de la ficha de Cerberus — precarga el select (editable). */
  paisNombre?: string | null;
  /** La siguiente jugada del recibo: agendar la bienvenida (cae en la Agenda vía puente). Sin esto, el botón no se muestra. */
  onAgendarBienvenida?: (telefono: string | null) => void;
}

interface Linea {
  producto: ProductoCurso;
  cantidad: number;
  /**
   * EL PRECIO PACTADO, como texto porque se está tipeando.
   *
   * Nace en el precio de promoción del catálogo y la vendedora lo puede bajar: es
   * el descuento real, y Cerberus lo acepta (`precio_venta` dentro del
   * `productos_json`). El `precio_regular` sigue siendo el del catálogo — sin los
   * dos, el descuento no se puede ni ver ni medir después.
   */
  precio: string;
}

interface Recibo {
  modo: 'cotizacion' | 'venta';
  folio: string | null;
  /** Foto del embudo ANTES de registrar — el +1 de Cierre se suma local, sin doble conteo. */
  embudo: Record<string, number> | null;
}

export function FormularioVenta({ clienteId, clienteNombre, telefono, canal, clave, personaNombre, numeroPropio, paisNombre, onAgendarBienvenida, onCerrar }: Props) {
  const { data: form, isPending: cargandoForm } = useFormularioVenta(true);
  const crear = useCrearVenta();
  const { data: dash } = useDashboard();

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
  const [localId, setLocalId] = useState('');
  const [preventa, setPreventa] = useState(true);
  const [lineas, setLineas] = useState<Linea[]>([]);
  /**
   * EL CRONOGRAMA — arranca en UNA cuota que vence hoy.
   *
   * El caso normal es pago al contado, y una venta sin cuotas es un 400 seguro de
   * Cerberus: hacer que la vendedora agregue la primera a mano sería cobrarle un
   * clic a lo que pasa siempre, para que lo que pasa a veces cueste uno menos.
   */
  const [cuotas, setCuotas] = useState<string[]>(() => [hoyLocal()]);
  const [busqueda, setBusqueda] = useState('');
  const [saved, setSaved] = useState<Recibo | null>(null);
  const [folioCopiado, setFolioCopiado] = useState(false);

  // Precargas: la moneda de la última venta y el país de la ficha. Nada pisa lo
  // que la vendedora ya eligió.
  useEffect(() => {
    if (!form) return;
    const ultima = localStorage.getItem('hermes.ultimaMoneda');
    if (ultima && form.monedas.some((m) => m.id === ultima)) setMonedaId((v) => v || ultima);
    if (paisNombre) {
      const p = form.paises.find((x) => x.nombre.trim().toLowerCase() === paisNombre.trim().toLowerCase());
      if (p) setPaisId((v) => v || p.id);
    }
  }, [form, paisNombre]);

  // Los locales del país elegido. Con Cerberus mudo (`locales: null`) o con un
  // server viejo que todavía no tiene la ruta, cae a la lista completa del
  // formulario: peor que ofrecer la lista fina, mucho mejor que un select vacío.
  const { data: localesDelPais } = useLocalesDePais(paisId);
  const locales = localesDelPais?.locales ?? form?.locales ?? SIN_LOCALES;

  /**
   * Precarga del local, y limpieza si dejó de valer.
   *
   * ⚠️ Cambiar el país puede invalidar el local ya elegido, y **dejarlo puesto es
   * regalar un rechazo**: `VentaForm.clean` responde «El local debe pertenecer al
   * país seleccionado» y tumba la venta entera. Se cae al último que usó, y si
   * tampoco es de este país, a nada.
   */
  useEffect(() => {
    if (locales.length === 0) return;
    setLocalId((v) => {
      if (v && locales.some((l) => l.id === v)) return v;
      const ultimo = localStorage.getItem('hermes.ultimoLocal');
      return ultimo && locales.some((l) => l.id === ultimo) ? ultimo : '';
    });
  }, [locales]);

  // Escape cierra el modal — contrato compartido de los modales (src/lib/teclado/).
  useEscape(onCerrar);

  const { data: prods } = useProductos(busqueda, busqueda.length >= 2);

  const monto = useMemo(
    () => lineas.reduce((s, l) => s + precioDe(l.precio) * l.cantidad, 0),
    [lineas],
  );
  // El espejo del reparto que va a hacer Cerberus. Ver `cuotas.ts`: la autoridad
  // es su backend, esto es para que la vendedora sepa qué está prometiendo.
  const montosCuota = repartirEnCuotas(monto, cuotas.length);
  const cuotasCompletas = cuotas.length > 0 && cuotas.every(Boolean);
  const monedaNombre = form?.monedas.find((m) => m.id === monedaId)?.nombre ?? '';
  const paisDeFicha = form && paisNombre
    ? form.paises.find((x) => x.nombre.trim().toLowerCase() === paisNombre.trim().toLowerCase())
    : null;

  function agregar(p: ProductoCurso) {
    setLineas((ls) =>
      ls.some((l) => l.producto.id === p.id)
        ? ls
        : [...ls, { producto: p, cantidad: 1, precio: String(p.precioPromocion) }],
    );
    setBusqueda('');
  }
  function cantidad(id: string, delta: number) {
    setLineas((ls) => ls.map((l) => (l.producto.id === id ? { ...l, cantidad: Math.max(1, l.cantidad + delta) } : l)));
  }
  function ponerPrecio(id: string, precio: string) {
    setLineas((ls) => ls.map((l) => (l.producto.id === id ? { ...l, precio } : l)));
  }
  function quitar(id: string) {
    setLineas((ls) => ls.filter((l) => l.producto.id !== id));
  }
  function agregarCuota() {
    // La nueva vence un mes después de la última: es lo que la vendedora quiere
    // el 90 % de las veces y sigue siendo editable.
    setCuotas((cs) => {
      const ultima = new Date(`${cs[cs.length - 1] || hoyLocal()}T12:00:00`);
      ultima.setMonth(ultima.getMonth() + 1);
      return [...cs, `${ultima.getFullYear()}-${String(ultima.getMonth() + 1).padStart(2, '0')}-${String(ultima.getDate()).padStart(2, '0')}`];
    });
  }
  function ponerCuota(i: number, fecha: string) {
    setCuotas((cs) => cs.map((c, j) => (j === i ? fecha : c)));
  }
  function quitarCuota(i: number) {
    setCuotas((cs) => (cs.length <= 1 ? cs : cs.filter((_, j) => j !== i)));
  }

  async function registrar(saveMode: 'cotizacion' | 'venta') {
    if (!monedaId || !paisId || !localId || lineas.length === 0) return;
    if (saveMode === 'venta' && !cuotasCompletas) return;
    // Foto del embudo antes del registro: el recibo dibuja Cierre +1 sobre esta
    // base aunque el refetch llegue después.
    const embudoAntes = dash?.embudo ?? null;
    let r: { folio?: string };
    try {
      r = await crear.mutateAsync({
        clienteId,
        monedaId,
        paisId,
        localId,
        preventa,
        medio,
        origen: origenInfo.id,
        montoTotal: monto,
        productos: lineas.map((l) => ({
          productoId: l.producto.id,
          nombre: l.producto.nombre,
          cantidad: l.cantidad,
          // El regular es el del catálogo aunque se haya pactado otro precio: es
          // lo único que deja ver después que hubo un descuento, y cuánto.
          precioRegular: l.producto.precioNormal,
          precioVenta: precioDe(l.precio),
        })),
        // Una cotización no necesita cronograma, pero si la vendedora lo armó va
        // igual: es lo que le está prometiendo al cliente en el presupuesto.
        cuotas: cuotas.filter(Boolean).map((fechaVencimiento) => ({ fechaVencimiento })),
        saveMode,
        // El contexto de la conversación: con esto el server asienta intereses,
        // conversión y etapa (cotizado/cierre) — el embudo se mueve solo.
        telefono,
        canal,
        clave: clave ?? null,
        personaNombre: personaNombre ?? null,
        numeroPropio: numeroPropio ?? null,
      });
    } catch {
      // El error queda a la vista vía crear.isError — nada muta en silencio.
      return;
    }
    localStorage.setItem('hermes.ultimaMoneda', monedaId);
    localStorage.setItem('hermes.ultimoLocal', localId);
    setSaved({ modo: saveMode, folio: r.folio ?? null, embudo: embudoAntes });
  }

  async function copiarFolio() {
    if (!saved?.folio) return;
    await navigator.clipboard.writeText(saved.folio);
    setFolioCopiado(true);
  }

  /**
   * LAS DOS SALIDAS NO PIDEN LO MISMO, y por eso son dos booleanos.
   *
   * El local lo exigen las dos (`sales/forms.py:132`). El cronograma lo exige
   * solo la venta real: una cotización es un presupuesto y no entra a tesorería
   * (`sales/views.py:947`). Con un solo `puede` compartido, o la cotización pedía
   * de más o la venta salía a comerse un 400.
   */
  const puedeCotizar = Boolean(monedaId && paisId && localId && lineas.length > 0) && !crear.isPending;
  const puedeVender = puedeCotizar && cuotasCompletas;

  // El mini-embudo del recibo: la foto previa + Cierre creciendo 1, en verde.
  const segmentosRecibo =
    saved?.modo === 'venta' && saved.embudo
      ? ETAPAS.map((e, i) => ({
          id: e,
          n: (saved.embudo?.[e] ?? 0) + (e === 'cierre' ? 1 : 0),
          color: colorSegmento(e, i),
          // El mini-embudo cuenta montones, no personas: «Compraron», no «Compró».
          label: rotuloEtapa(e, 'varios'),
        }))
      : null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/30 backdrop-blur-[2px]" onClick={onCerrar} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div role="dialog" aria-modal="true" aria-label="Registrar venta" className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-card shadow-panel">
          <header className="flex shrink-0 items-center justify-between border-b border-border bg-navy px-5 py-3 text-white">
            <div className="flex items-center gap-2 text-sm font-bold">
              <ShoppingCart size={16} /> Registrar venta
            </div>
            <button type="button" aria-label="Cerrar" onClick={onCerrar} className="rounded-lg p-1 hover:bg-white/10">
              <X size={16} />
            </button>
          </header>

          {saved ? (
            /* EL RECIBO DE IMPRENTA — la edición cerrada, verificable y encadenada. */
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                <Check size={24} />
              </div>
              <p className="text-sm font-bold text-foreground">
                {saved.modo === 'venta' ? 'Venta registrada en Cerberus.' : 'Cotización registrada en Cerberus.'}
              </p>
              {saved.folio && (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg tabular-nums text-foreground">{saved.folio}</span>
                  <button
                    type="button"
                    onClick={() => void copiarFolio()}
                    className={
                      'flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ' +
                      (folioCopiado ? 'border-success/40 text-success' : 'border-border text-muted-foreground hover:border-primary hover:text-foreground')
                    }
                  >
                    {folioCopiado ? <Check size={11} /> : <Copy size={11} />}
                    {folioCopiado ? 'Copiado' : 'Copiar folio'}
                  </button>
                </div>
              )}
              {segmentosRecibo && (
                <div className="w-full max-w-[260px]">
                  <BarraSegmentada segmentos={segmentosRecibo} />
                  <p className="mt-1 font-mono text-[11px] tabular-nums text-success">Cierre +1</p>
                </div>
              )}
              {saved.modo === 'venta' && onAgendarBienvenida ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onAgendarBienvenida(telefono || null);
                      onCerrar();
                    }}
                    className="mt-2 flex items-center gap-2 rounded-xl bg-navy px-4 py-2 text-sm font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98]"
                  >
                    <CalendarPlus size={15} /> Agendar bienvenida al curso
                  </button>
                  <button type="button" onClick={onCerrar} className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
                    Cerrar
                  </button>
                </>
              ) : (
                <button type="button" onClick={onCerrar} className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
                  Cerrar
                </button>
              )}
            </div>
          ) : cargandoForm ? (
            <div className="space-y-4 p-5">
              <div className="h-9 animate-pulse rounded-lg bg-muted" />
              <div className="grid grid-cols-2 gap-3">
                <div className="h-9 animate-pulse rounded-lg bg-muted" />
                <div className="h-9 animate-pulse rounded-lg bg-muted" />
              </div>
              <div className="h-9 w-2/3 animate-pulse rounded-lg bg-muted" />
              <div className="h-9 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : !form ? (
            /* Antes acá había un texto que decía «volvé a entrar» y no daba por
               dónde: la vendedora tenía que adivinar que la salida era «Salir» en
               el riel, con el cliente esperando. Ahora el botón está donde falla. */
            <VentaSinCerberus onReconectar={onCerrar} />
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
                  <Select value={monedaId} onChange={setMonedaId} placeholder="Elegí moneda" opciones={form.monedas} autoFocus />
                </Campo>
                <Campo label="País">
                  <Select value={paisId} onChange={setPaisId} placeholder="Elegí país" opciones={form.paises} />
                  {paisDeFicha && paisId === paisDeFicha.id && (
                    <span className="text-[11px] text-muted-foreground">
                      precargado de la ficha — cambialo si hace falta
                    </span>
                  )}
                </Campo>
                {/* El local ocupa la fila entera: los nombres de almacén no entran en media. */}
                <div className="col-span-2">
                  <Campo label="Local">
                    <Select
                      value={localId}
                      onChange={setLocalId}
                      placeholder={paisId ? 'Elegí local' : 'Elegí el país primero'}
                      opciones={locales}
                    />
                  </Campo>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={preventa} onChange={(e) => setPreventa(e.target.checked)} />
                Preventa (cursos sin stock: no reserva stock)
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
                    <div className="absolute z-10 mt-1 max-h-44 w-full overflow-y-auto rounded-lg bg-card shadow-panel">
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
                        <button
                          type="button"
                          aria-label="Una menos"
                          onClick={() => cantidad(l.producto.id, -1)}
                          className="size-6 rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-foreground active:scale-95"
                        >
                          −
                        </button>
                        <span className="w-5 text-center tabular-nums">{l.cantidad}</span>
                        <button
                          type="button"
                          aria-label="Una más"
                          onClick={() => cantidad(l.producto.id, 1)}
                          className="size-6 rounded-md border border-border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-foreground active:scale-95"
                        >
                          +
                        </button>
                      </div>
                      {/* LA MONEDA VA ACÁ, NO SOLO EN EL TOTAL. El precio sale del
                          catálogo de Cerberus, que hoy NO dice en qué moneda está
                          (`useVenta.ts`, `ProductoCurso.moneda` viene vacío): cambiar el
                          select de arriba NO reconvierte este número. Con la moneda
                          pegada al precio el desajuste se VE, que es mejor que un
                          renglón de prosa explicándolo. */}
                      {monedaNombre && (
                        <span className="shrink-0 text-[10px] font-semibold uppercase text-muted-foreground">{monedaNombre}</span>
                      )}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={l.precio}
                        onChange={(e) => ponerPrecio(l.producto.id, e.target.value)}
                        aria-label={`Precio de ${l.producto.nombre}`}
                        className="w-16 shrink-0 rounded-md border border-border bg-card px-1.5 py-1 text-right font-semibold tabular-nums text-navy outline-none focus:border-primary"
                      />
                      {/* El subtotal solo cuando hay más de uno: con cantidad 1 repetiría
                          el número de al lado. */}
                      {l.cantidad > 1 && (
                        <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                          {(precioDe(l.precio) * l.cantidad).toFixed(2)}
                        </span>
                      )}
                      <button type="button" aria-label={`Quitar ${l.producto.nombre}`} onClick={() => quitar(l.producto.id)} className="text-destructive">
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className={sectionLabel}>Monto total</span>
                <span className="font-heading text-2xl font-bold tabular-nums text-navy">
                  {monedaNombre && <span className="mr-1.5 text-sm font-semibold text-muted-foreground">{monedaNombre}</span>}
                  {monto.toFixed(2)}
                </span>
              </div>

              {/* EL CRONOGRAMA — lo que faltaba, y por lo que este modal nunca
                  registró una venta. Cerberus corta ANTES de validar el formulario
                  si una venta real llega sin cuotas (`sales/views.py:947`), así que
                  el botón devolvía «Debe agregar al menos una cuota» y la pantalla
                  no ofrecía dónde agregarla: una validación imposible de satisfacer.
                  Los montos son el ESPEJO del reparto de allá (ver `cuotas.ts`). */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className={sectionLabel}>Cuotas</span>
                  <button
                    type="button"
                    onClick={agregarCuota}
                    className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                  >
                    <Plus size={11} /> Agregar cuota
                  </button>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {cuotas.map((fecha, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
                      <span className="w-14 shrink-0 font-medium text-muted-foreground">Cuota {i + 1}</span>
                      <input
                        type="date"
                        value={fecha}
                        onChange={(e) => ponerCuota(i, e.target.value)}
                        aria-label={`Vencimiento de la cuota ${i + 1}`}
                        className="min-w-0 flex-1 rounded-md border border-border bg-card px-1.5 py-1 text-xs tabular-nums outline-none focus:border-primary"
                      />
                      <span className="w-16 shrink-0 text-right font-semibold tabular-nums text-navy">
                        {(montosCuota[i] ?? 0).toFixed(2)}
                      </span>
                      {cuotas.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Quitar la cuota ${i + 1}`}
                          onClick={() => quitarCuota(i)}
                          className="text-destructive"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {!cuotasCompletas && (
                  <p className="text-[11px] text-destructive">
                    Cada cuota necesita su fecha de vencimiento — sin eso Cerberus rechaza la venta.
                  </p>
                )}
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
                disabled={!puedeCotizar}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                Cotización
              </button>
              <button
                type="button"
                onClick={() => void registrar('venta')}
                disabled={!puedeVender}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-navy py-2.5 text-sm font-bold text-white transition-[background-color,transform] duration-200 ease-house hover:bg-navy/90 active:scale-[0.98] disabled:opacity-40"
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
      <span className={sectionLabel}>{label}</span>
      {children}
    </label>
  );
}

function Select({ value, onChange, placeholder, opciones, autoFocus = false }: { value: string; onChange: (v: string) => void; placeholder: string; opciones: { id: string; nombre: string }[]; autoFocus?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      className="rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-primary"
    >
      <option value="">{placeholder}</option>
      {opciones.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nombre}
        </option>
      ))}
    </select>
  );
}
