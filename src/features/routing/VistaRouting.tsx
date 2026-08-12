import { useState } from 'react';
import { AlertTriangle, RefreshCw, Route, Search } from 'lucide-react';
import { nombreCorto } from '../notas/espacios';
import { TableroDeCables, type NodoConectable } from './TableroDeCables';
import { TableroDeProducto, type PiezaDelProducto } from './TableroDeProducto';
import {
  haceCuanto,
  rotuloEstado,
  useConectar,
  useConectarCurso,
  useConectarProducto,
  useRefrescarDesdeMeta,
  useRouting,
} from './routing';

/**
 * ROUTING — «los leads de esta campaña le caen a esta gente».
 *
 * ══ CÓMO SE LEE ══════════════════════════════════════════════════════════════
 *
 * A la izquierda las campañas que **esta línea puede recibir**; al elegir una,
 * el tablero de cables (`TableroDeCables.tsx`) la pone a la izquierda con las
 * vendedoras a la derecha y se conecta tocando.
 *
 * ══ 🔴 LA LISTA SALE DEL CATÁLOGO DE META, NO DE LOS LEADS RECIBIDOS ═════════
 *
 * El primer borrador la derivaba de `events`, o sea que **solo mostraba
 * campañas que ya habían traído gente** — y el momento en que querés dejar el
 * cable puesto es justo antes del primer lead. Ahora se pide el catálogo de la
 * cuenta y se recorta a las que apuntan a esta línea.
 *
 * ══ 🔴 Y POR ESO HAY UN NÚMERO INCÓMODO ARRIBA ══════════════════════════════
 *
 * Medido el 12-ago-2026: la cuenta tiene **17 adsets activos mandando gente a
 * WhatsApp y solo UNO apunta a la línea que Hermes atiende**. Los otros caen en
 * teléfonos que el CRM no ve. Esas campañas no se listan —no se pueden cablear—
 * pero **se cuentan**: esconderlas haría que la pantalla afirme «estas son todas
 * las campañas» sobre el 6 % de la pauta.
 *
 * **Sin oro**: el dorado significa tiempo que se acaba y acá no corre nada.
 */
/**
 * LOS CHIPS. Cuatro y no tres: «Todo» tiene que existir porque es el estado en
 * que se abre la pantalla, y un chip activo que no se puede apagar es un filtro
 * del que no se sale (la regla del cero, ADR 0044).
 */
type Filtro = 'todo' | 'producto' | 'campana' | 'formulario';

export function VistaRouting() {
  const { data, isLoading, error } = useRouting();
  const conectar = useConectar();
  const conectarCurso = useConectarCurso();
  const conectarProducto = useConectarProducto();
  const refrescar = useRefrescarDesdeMeta();
  const [busqueda, setBusqueda] = useState('');
  const [elegida, setElegida] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('todo');

  if (isLoading) {
    return (
      <div className="min-h-0 flex-1 space-y-2 p-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  // Los dos fallos que importan son de configuración y el server los NOMBRA
  // (sin línea de Cloud API, falta la migración). Se muestra su texto en vez de
  // un «algo falló» genérico: la salida de cada uno es distinta.
  if (error) return <Cartel titulo="No se puede mostrar el ruteo" detalle={error.message} />;
  if (!data) return null;
  if (data.sinMigracion) {
    return (
      <Cartel
        titulo="Falta la migración del ruteo"
        detalle="Las tablas del ruteo todavía no están en esta base. Hasta que se apliquen, los leads se reparten por la rueda como siempre."
      />
    );
  }

  /**
   * LAS DOS FUENTES EN UNA SOLA LISTA. Un lead de formulario y un lead de
   * campaña se atienden igual, y la pregunta «¿quién lo agarra?» es la misma:
   * partir la pantalla en dos pestañas obligaría a recordar en cuál estaba la
   * regla que quiero cambiar.
   *
   * ⚠️ **Y los formularios traen MÁS gente que las campañas**: 178 leads en 30
   * días contra 33 de la campaña activa. Van abajo por convención de lectura, no
   * por importancia.
   */
  const nodos: NodoConectable[] = [
    ...data.campanas.map((c) => ({
      id: `campana:${c.campanaId}`,
      titulo: c.nombre,
      pie: `${rotuloEstado(c.estado)} · ${c.personas} ${c.personas === 1 ? 'persona' : 'personas'}`,
      origen: 'campana' as const,
      familia: c.familia,
      volumen: c.personas,
      vendedoras: c.vendedoras,
    })),
    ...(data.cursos ?? []).map((c) => ({
      id: `curso:${c.curso}`,
      titulo: c.curso,
      pie: `${c.leads} ${c.leads === 1 ? 'formulario' : 'formularios'} en ${data.ventanaDias} días`,
      origen: 'formulario' as const,
      familia: c.familia,
      volumen: c.leads,
      vendedoras: c.vendedoras,
    })),
  ];

  /**
   * LOS PRODUCTOS son una AGRUPACIÓN, no una tercera entidad con regla propia:
   * cablear uno escribe en sus piezas. Por eso se arman acá, de lo que ya vino,
   * y no hay un `producto.vendedoras` que pudiera contradecir a sus piezas.
   */
  const piezasDe = (familia: string): PiezaDelProducto[] =>
    nodos
      .filter((n) => n.familia === familia)
      .map((n) => ({
        id: n.id,
        titulo: n.titulo,
        origen: n.origen,
        volumen: n.volumen,
        vendedoras: n.vendedoras,
      }));

  const productos = (data.productos ?? [])
    .map((p) => {
      const piezas = piezasDe(p.familia);
      return { ...p, piezas, volumen: piezas.reduce((n, x) => n + x.volumen, 0) };
    })
    .filter((p) => p.piezas.length > 0)
    // Primero lo que más gente trae; a igualdad, alfabético para que dos
    // aperturas no muestren dos órdenes distintos.
    .sort((a, b) => b.volumen - a.volumen || a.nombre.localeCompare(b.nombre, 'es'));

  const q = busqueda.trim().toLowerCase();
  const coincide = (t: string) => !q || t.toLowerCase().includes(q);

  const productosVisibles =
    filtro === 'todo' || filtro === 'producto' ? productos.filter((p) => coincide(p.nombre)) : [];
  const sueltosVisibles = nodos.filter(
    (n) =>
      coincide(n.titulo) &&
      (filtro === 'todo'
        ? // En «Todo» lo que ya está adentro de un producto no se repite suelto:
          // sería la misma regla ofrecida dos veces, y la pantalla diciendo dos
          // números distintos sobre el mismo tráfico.
          n.familia === null
        : filtro === n.origen),
  );

  const producto = productos.find((p) => `producto:${p.familia}` === elegida) ?? null;
  const nodo = producto
    ? null
    : (nodos.find((n) => n.id === elegida) ??
      (productosVisibles.length === 0 ? (sueltosVisibles[0] ?? null) : null));
  const productoElegido = producto ?? (nodo ? null : (productosVisibles[0] ?? null));

  function guardar(vendedoras: string[]) {
    if (!nodo) return;
    const [tipo, ...resto] = nodo.id.split(':');
    const clave = resto.join(':');
    if (tipo === 'campana') conectar.mutate({ campanaId: clave, vendedoras });
    else conectarCurso.mutate({ curso: clave, vendedoras });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-6 py-3">
        <Route size={16} strokeWidth={1.9} className="text-navy" aria-hidden />
        <p className="text-xs font-medium text-foreground">
          {data.etiqueta ?? 'Línea de Meta'}{' '}
          <span className="font-mono text-[11px] text-muted-foreground">{data.linea}</span>
        </p>
        <p className="text-[11px] text-muted-foreground">a quién le caen los leads de cada campaña y cada formulario</p>
        <div className="ml-auto flex items-center gap-2">
          {data.actualizadoAt && (
            <span className="text-[11px] text-muted-foreground">
              Meta: {haceCuanto(data.actualizadoAt) ?? '—'}
            </span>
          )}
          <button
            type="button"
            onClick={() => refrescar.mutate()}
            disabled={refrescar.isPending}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-[color,border-color,transform] duration-200 ease-house hover:border-primary/40 hover:text-navy active:scale-[0.97] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <RefreshCw size={12} strokeWidth={2} className={refrescar.isPending ? 'animate-spin' : ''} />
            {refrescar.isPending ? 'Preguntando…' : 'Actualizar desde Meta'}
          </button>
        </div>
      </header>

      {(data.campanasEnOtraLinea > 0 || data.anunciosSinResolver > 0 || refrescar.isError) && (
        <div className="shrink-0 space-y-1.5 border-b border-border px-6 py-2">
          {data.campanasEnOtraLinea > 0 && (
            <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <AlertTriangle size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
              <span>
                Otras <strong className="font-semibold">{data.campanasEnOtraLinea}</strong> campañas
                mandan gente a WhatsApp, pero a números que Hermes no atiende: sus leads no llegan al
                CRM y no se pueden rutear desde acá.
              </span>
            </p>
          )}
          {data.anunciosSinResolver > 0 && (
            <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
              <AlertTriangle size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
              <span>
                {data.anunciosSinResolver}{' '}
                {data.anunciosSinResolver === 1 ? 'anuncio trajo' : 'anuncios trajeron'} gente y
                todavía no sabemos de qué campaña {data.anunciosSinResolver === 1 ? 'es' : 'son'}. Sus
                leads van a la rueda hasta que se actualice desde Meta.
              </span>
            </p>
          )}
          {refrescar.isError && (
            <p className="text-[11px] text-destructive">{(refrescar.error as Error).message}</p>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── LAS CAMPAÑAS ── */}
        <aside className="flex w-[19rem] shrink-0 flex-col border-r border-border">
          <div className="shrink-0 space-y-2 p-3">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ['todo', 'Todo', nodos.length],
                  ['producto', 'Productos', productos.length],
                  ['campana', 'Campañas', nodos.filter((n) => n.origen === 'campana').length],
                  ['formulario', 'Formularios', nodos.filter((n) => n.origen === 'formulario').length],
                ] as const
              ).map(([id, rotulo, n]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFiltro(id)}
                  aria-pressed={filtro === id}
                  className={
                    'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors duration-200 ease-house focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
                    (filtro === id
                      ? 'border-navy bg-navy text-white'
                      : 'border-border text-muted-foreground hover:border-primary/40 hover:text-navy')
                  }
                >
                  {rotulo}
                  <span className={filtro === id ? 'text-white/70' : 'text-muted-foreground/70'}>{n}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
              <Search size={13} strokeWidth={2} className="shrink-0 text-muted-foreground" aria-hidden />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar campaña…"
                aria-label="Buscar campaña"
                className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {productosVisibles.length === 0 && sueltosVisibles.length === 0 ? (
              <p className="px-1 py-8 text-center text-[11px] text-muted-foreground">
                {nodos.length === 0
                  ? 'Ninguna campaña manda gente a esta línea y no llegaron formularios. Probá «Actualizar desde Meta».'
                  : 'Nada coincide con el filtro.'}
              </p>
            ) : (
              <>
                {productosVisibles.length > 0 && (
                  <section className="mb-3">
                    <p className="px-1 pb-1 font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Productos
                    </p>
                    <ul className="space-y-1">
                      {productosVisibles.map((p) => (
                        <li key={p.familia}>
                          <FilaProducto
                            nombre={p.nombre}
                            piezas={p.piezas}
                            activa={productoElegido?.familia === p.familia}
                            onElegir={() => setElegida(`producto:${p.familia}`)}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {sueltosVisibles.length > 0 && (
                  <section className="mb-3">
                    <p className="px-1 pb-1 font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      {filtro === 'todo' ? 'Sin producto' : filtro === 'campana' ? 'Campañas de Meta' : 'Formularios'}
                    </p>
                    <ul className="space-y-1">
                      {sueltosVisibles.map((n) => (
                        <li key={n.id}>
                          <FilaNodo nodo={n} activa={nodo?.id === n.id} onElegir={() => setElegida(n.id)} />
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        </aside>

        {/* ── EL TABLERO ── */}
        {productoElegido ? (
          <TableroDeProducto
            key={productoElegido.familia}
            nombre={productoElegido.nombre}
            piezas={productoElegido.piezas}
            destinos={data.destinos}
            guardando={conectarProducto.isPending}
            onCablearTodo={(vendedoras) =>
              conectarProducto.mutate({ familia: productoElegido.familia, vendedoras })
            }
          />
        ) : nodo ? (
          <TableroDeCables
            key={nodo.id}
            nodo={nodo}
            destinos={data.destinos}
            guardando={conectar.isPending || conectarCurso.isPending}
            onConectar={guardar}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <p className="text-xs text-muted-foreground">Elegí algo de la izquierda para conectarlo.</p>
          </div>
        )}
      </div>

      {(conectar.isError || conectarCurso.isError || conectarProducto.isError) && (
        <p className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-6 py-2 text-[11px] text-destructive">
          {((conectar.error ?? conectarCurso.error ?? conectarProducto.error) as Error).message}
        </p>
      )}
    </div>
  );
}

function FilaProducto({
  nombre,
  piezas,
  activa,
  onElegir,
}: {
  nombre: string;
  piezas: PiezaDelProducto[];
  activa: boolean;
  onElegir: () => void;
}) {
  const cables = new Set(piezas.flatMap((p) => p.vendedoras));
  const todasIguales = piezas.every(
    (p) => p.vendedoras.join('|') === piezas[0]!.vendedoras.join('|'),
  );
  return (
    <button
      type="button"
      onClick={onElegir}
      aria-current={activa}
      className={
        'w-full rounded-xl border px-2.5 py-2 text-left transition-[color,background-color,border-color] duration-200 ease-house focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
        (activa ? 'border-navy/30 bg-navy/5' : 'border-transparent hover:bg-secondary')
      }
    >
      <p className="truncate text-xs font-medium text-foreground">{nombre}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {piezas.reduce((n, x) => n + x.volumen, 0)} leads · {piezas.length}{' '}
        {piezas.length === 1 ? 'pieza' : 'piezas'}
        {' · '}
        {cables.size === 0
          ? 'sin cables'
          : todasIguales
            ? [...cables].map(nombreCorto).join(', ')
            : /* Sin etiqueta inventada: «mezclado» es el hecho, y al abrirlo se ve cuál difiere. */
              'mezclado'}
      </p>
    </button>
  );
}

function FilaNodo({
  nodo,
  activa,
  onElegir,
}: {
  nodo: NodoConectable;
  activa: boolean;
  onElegir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onElegir}
      aria-current={activa}
      className={
        'w-full rounded-xl border px-2.5 py-2 text-left transition-[color,background-color,border-color] duration-200 ease-house focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
        (activa ? 'border-navy/30 bg-navy/5' : 'border-transparent hover:bg-secondary')
      }
    >
      <p className="truncate text-xs font-medium text-foreground">{nodo.titulo}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {nodo.pie}
        {' · '}
        {nodo.vendedoras.length === 0
          ? nodo.origen === 'campana'
            ? 'la rueda'
            : 'todo el equipo'
          : nodo.vendedoras.map(nombreCorto).join(', ')}
      </p>
    </button>
  );
}

function Cartel({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-medium text-foreground">{titulo}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detalle}</p>
      </div>
    </div>
  );
}
