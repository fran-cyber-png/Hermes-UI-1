import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, RefreshCw, Route, Search } from 'lucide-react';
import { Lienzo } from './Lienzo';
import { conCambio, destinosDe, type CableLienzo } from './reglasDelLienzo';
import {
  ID,
  cablesDe,
  cablesHuerfanos,
  columnasDePieza,
  columnasDeCampanaAdentro,
  columnasDeProducto,
  leerId,
  piezasDe,
  productosDe,
  type Pieza,
  type Producto,
} from './piezas';
import {
  haceCuanto,
  useConectar,
  useConectarCurso,
  useConectarProducto,
  useAnunciosDeCampana,
  useRefrescarDesdeMeta,
  useRouting,
  type FotoDeRouting,
} from './routing';

/**
 * ROUTING — «los leads de esto le caen a esta gente».
 *
 * ══ CÓMO SE USA ══════════════════════════════════════════════════════════════
 *
 * A la izquierda, qué se puede rutear —productos, campañas, formularios— con
 * chips para filtrar. Al elegir algo, el lienzo lo pone a la izquierda y las
 * vendedoras a la derecha: **se tira un cable de un puerto al otro** y queda
 * guardado. Tocar el cable lo corta.
 *
 * ══ 🔴 EL CABLE APARECE CON EL GESTO, NO CON LA RESPUESTA DEL SERVER ═════════
 *
 * `cables` es estado LOCAL, sembrado de lo que vino y actualizado en el acto. La
 * versión anterior dibujaba solo lo guardado, así que tocabas una vendedora y no
 * pasaba nada visible hasta apretar «Aplicar» — el defecto que el dueño señaló
 * el 12-ago-2026 mirando la captura: *«no se entiende bien cómo se enlazan»*.
 *
 * ⚠️ Y por eso **hay que poder volver atrás**: el destino se verifica del otro
 * lado y un 409 tiene que deshacer el cable, no dejarlo dibujado sobre una regla
 * que no existe. Lo hace el `useEffect` de abajo: **la foto del server siempre
 * gana**.
 *
 * ══ UN SOLO MODELO ═══════════════════════════════════════════════════════════
 *
 * Antes convivían dos —el clic guardaba al instante en una campaña suelta y
 * armaba una selección en un producto—, o sea que la misma acción visual hacía
 * dos cosas según qué hubieras elegido en la lista. Ahora el gesto es uno solo
 * en todos lados y la acción masiva es un botón aparte, con nombre propio.
 *
 * **Sin oro**: el dorado significa tiempo que se acaba y acá no corre nada.
 */
type Filtro = 'todo' | 'producto' | 'campana' | 'formulario';

export function VistaRouting() {
  const { data, isLoading, error } = useRouting();
  const conectar = useConectar();
  const conectarCurso = useConectarCurso();
  const conectarProducto = useConectarProducto();
  const refrescar = useRefrescarDesdeMeta();

  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todo');
  const [elegido, setElegido] = useState<string | null>(null);
  /**
   * EL NIVEL DE ADENTRO. `null` = el lienzo de siempre. No es un router
   * (ADR 0002): es estado de la vista, y `Esc` sube.
   */
  const [adentro, setAdentro] = useState<string | null>(null);
  const [cables, setCables] = useState<CableLienzo[]>([]);
  const anuncios = useAnunciosDeCampana(adentro ? leerId(adentro).clave : null);

  const piezas = data ? piezasDe(data) : [];
  const productos = data ? productosDe(data, piezas) : [];

  /**
   * LA FOTO DEL SERVER SIEMPRE GANA. Al llegar datos nuevos —después de guardar,
   * o de un rechazo— los cables se rearman de lo guardado. Es lo que revierte un
   * cable que el server no aceptó, sin que la pantalla tenga que saber por qué.
   */
  const huella = piezas.map((p) => `${p.id}=${p.vendedoras.join(',')}`).join('|');
  useEffect(() => {
    setCables(cablesDe(piezas, data?.destinos ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huella, (data?.destinos ?? []).join('|')]);

  if (isLoading) {
    return (
      <div className="min-h-0 flex-1 space-y-2 p-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }
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

  const q = busqueda.trim().toLowerCase();
  const coincide = (t: string) => !q || t.toLowerCase().includes(q);

  const productosVisibles =
    filtro === 'todo' || filtro === 'producto' ? productos.filter((p) => coincide(p.nombre)) : [];
  const sueltasVisibles = piezas.filter(
    (p) =>
      coincide(p.titulo) &&
      // En «Todo» lo que ya está adentro de un producto no se repite suelto:
      // sería la misma regla ofrecida dos veces, y dos números sobre el mismo
      // tráfico.
      (filtro === 'todo' ? p.familia === null : filtro === p.icono),
  );

  const productoElegido = productos.find((p) => ID.producto(p.familia) === elegido) ?? null;
  const piezaElegida = productoElegido ? null : (piezas.find((p) => p.id === elegido) ?? null);
  const producto = productoElegido ?? (piezaElegida ? null : (productosVisibles[0] ?? null));
  const pieza = piezaElegida ?? (producto ? null : (sueltasVisibles[0] ?? null));

  const campanaAdentro = adentro ? (piezas.find((p) => p.id === adentro) ?? null) : null;
  const armado = campanaAdentro
    ? columnasDeCampanaAdentro(campanaAdentro, anuncios.data?.anuncios ?? [], data.destinos)
    : producto
      ? columnasDeProducto(producto, data.destinos)
      : { columnas: pieza ? columnasDePieza(pieza, data.destinos) : [], pertenencia: [] };

  /**
   * 🔴 GUARDA EL CONJUNTO COMPLETO DEL ORIGEN, no el cable suelto. El server es
   * declarativo (`PUT` con el arreglo entero) porque con `conectar`/`desconectar`
   * dos personas editando lo mismo se pisan: la última cree que sumó un cable y
   * en realidad borró el de la otra.
   */
  function guardar(siguientes: CableLienzo[], origen: string) {
    setCables(siguientes);
    const destinos = destinosDe(siguientes, origen).map((v) => leerId(v).clave);
    const { tipo, clave } = leerId(origen);
    if (tipo === 'campana') conectar.mutate({ campanaId: clave, vendedoras: destinos });
    else if (tipo === 'curso') conectarCurso.mutate({ curso: clave, vendedoras: destinos });
  }

  const guardando = conectar.isPending || conectarCurso.isPending || conectarProducto.isPending;
  const fallo = conectar.error ?? conectarCurso.error ?? conectarProducto.error;
  const enPantalla = new Set(armado.columnas.flatMap((c) => c.nodos.map((n) => n.id)));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-6 py-3">
        <Route size={16} strokeWidth={1.9} className="text-navy" aria-hidden />
        <p className="text-xs font-medium text-foreground">
          {data.etiqueta ?? 'Línea de Meta'}{' '}
          <span className="font-mono text-[11px] text-muted-foreground">{data.linea}</span>
        </p>
        <p className="text-[11px] text-muted-foreground">
          a quién le caen los leads de cada campaña y cada formulario
        </p>
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

      <Avisos data={data} refrescar={refrescar} huerfanos={cablesHuerfanos(piezas, data.destinos)} />
      {campanaAdentro && (
        <Migas
          titulo={campanaAdentro.titulo}
          cargando={anuncios.isLoading}
          onSalir={() => setAdentro(null)}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[19rem] shrink-0 flex-col border-r border-border">
          <div className="shrink-0 space-y-2 p-3">
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ['todo', 'Todo', piezas.length],
                  ['producto', 'Productos', productos.length],
                  ['campana', 'Campañas', piezas.filter((p) => p.icono === 'campana').length],
                  ['formulario', 'Formularios', piezas.filter((p) => p.icono === 'formulario').length],
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
                placeholder="Buscar…"
                aria-label="Buscar"
                className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {productosVisibles.length === 0 && sueltasVisibles.length === 0 ? (
              <p className="px-1 py-8 text-center text-[11px] text-muted-foreground">
                {piezas.length === 0
                  ? 'Ninguna campaña manda gente a esta línea y no llegaron formularios. Probá «Actualizar desde Meta».'
                  : 'Nada coincide con el filtro.'}
              </p>
            ) : (
              <>
                <Grupo titulo="Productos" mostrar={productosVisibles.length > 0}>
                  {productosVisibles.map((p) => (
                    <Fila
                      key={p.familia}
                      titulo={p.nombre}
                      pie={`${p.volumen} leads · ${p.piezas.length} ${p.piezas.length === 1 ? 'pieza' : 'piezas'} · ${resumen(p.piezas)}`}
                      activa={producto?.familia === p.familia}
                      onElegir={() => setElegido(ID.producto(p.familia))}
                    />
                  ))}
                </Grupo>
                <Grupo
                  titulo={
                    filtro === 'todo'
                      ? 'Sin producto'
                      : filtro === 'campana'
                        ? 'Campañas de Meta'
                        : 'Formularios'
                  }
                  mostrar={sueltasVisibles.length > 0}
                >
                  {sueltasVisibles.map((p) => (
                    <Fila
                      key={p.id}
                      titulo={p.titulo}
                      pie={`${p.pie} · ${p.vendedoras.length ? p.vendedoras.join(', ') : 'sin cables'}`}
                      activa={pieza?.id === p.id}
                      onElegir={() => setElegido(p.id)}
                    />
                  ))}
                </Grupo>
              </>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 flex-1 flex-col">
          {producto || pieza ? (
            <>
              <Lienzo
                columnas={armado.columnas}
                cables={[
                  ...armado.pertenencia,
                  ...cables.filter((c) => enPantalla.has(c.de) && enPantalla.has(c.a)),
                ]}
                deshabilitado={guardando}
                onConectar={(de, a) => guardar(conCambio(cables, de, a, 'conectar'), de)}
                onCortar={(de, a) => guardar(conCambio(cables, de, a, 'cortar'), de)}
                onEntrar={(id) => setAdentro(id)}
              />
              {producto && !campanaAdentro && (
                <PieDeProducto
                  producto={producto}
                  guardando={guardando}
                  onAplicar={(vendedoras) =>
                    conectarProducto.mutate({ familia: producto.familia, vendedoras })
                  }
                />
              )}
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center p-6">
              <p className="text-xs text-muted-foreground">Elegí algo de la izquierda para conectarlo.</p>
            </div>
          )}
        </div>
      </div>

      {fallo && (
        <p className="shrink-0 border-t border-destructive/30 bg-destructive/5 px-6 py-2 text-[11px] text-destructive">
          {(fallo as Error).message}
        </p>
      )}
    </div>
  );
}

function resumen(piezas: Pieza[]): string {
  const cables = new Set(piezas.flatMap((p) => p.vendedoras));
  if (cables.size === 0) return 'sin cables';
  const todasIguales = piezas.every((p) => p.vendedoras.join('|') === piezas[0]!.vendedoras.join('|'));
  // Sin etiqueta inventada: «mezclado» es el hecho, y al abrirlo se ve cuál difiere.
  return todasIguales ? [...cables].join(', ') : 'mezclado';
}

/**
 * 🔴 LA ACCIÓN MASIVA, SEPARADA DEL GESTO. Antes competía con el arrastre por el
 * mismo espacio mental: tocabas una vendedora y no sabías si eso ya había hecho
 * algo. Ahora los cables se tiran de a uno y esto es un botón con nombre propio
 * que dice cuántas piezas alcanza y **qué va a pisar**.
 */
function PieDeProducto({
  producto,
  guardando,
  onAplicar,
}: {
  producto: Producto;
  guardando: boolean;
  onAplicar: (vendedoras: string[]) => void;
}) {
  const union = [...new Set(producto.piezas.flatMap((p) => p.vendedoras))].sort((a, b) =>
    a.localeCompare(b, 'es'),
  );
  const distintas = producto.piezas.filter(
    (p) => p.vendedoras.length > 0 && p.vendedoras.join('|') !== union.join('|'),
  );

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-6 py-3">
      <button
        type="button"
        onClick={() => onAplicar(union)}
        disabled={guardando || union.length === 0}
        className="shrink-0 rounded-lg bg-navy px-3 py-1.5 text-[11px] font-semibold text-white transition-transform duration-200 ease-house active:scale-[0.97] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Poner este cable en las {producto.piezas.length}
      </button>
      <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
        {union.length === 0
          ? 'Tirá un cable en alguna pieza y después podés repetirlo en todas.'
          : `Deja ${union.join(', ')} en las ${producto.piezas.length} piezas.`}
        {distintas.length > 0 && (
          <span className="text-foreground">
            {' '}
            {distintas.length === 1
              ? `«${distintas[0]!.titulo}» tiene otro cable y va a quedar como las demás.`
              : `${distintas.length} piezas tienen otro cable y van a quedar como las demás.`}
          </span>
        )}{' '}
        La campaña que Meta estrene el mes que viene nace sin regla: hay que volver acá.
      </p>
    </div>
  );
}

function Avisos({
  data,
  refrescar,
  huerfanos,
}: {
  data: FotoDeRouting;
  refrescar: { isError: boolean; error: unknown };
  /** Cables guardados hacia alguien que ya no está entre los destinos posibles. */
  huerfanos: string[];
}) {
  if (
    data.campanasEnOtraLinea === 0 &&
    data.anunciosSinResolver === 0 &&
    huerfanos.length === 0 &&
    !refrescar.isError
  ) {
    return null;
  }
  return (
    <div className="shrink-0 space-y-1.5 border-b border-border px-6 py-2">
      {data.campanasEnOtraLinea > 0 && (
        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <AlertTriangle size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
          <span>
            Otras <strong className="font-semibold">{data.campanasEnOtraLinea}</strong> campañas mandan
            gente a WhatsApp, pero a números que Hermes no atiende: sus leads no llegan al CRM y no se
            pueden rutear desde acá.
          </span>
        </p>
      )}
      {data.anunciosSinResolver > 0 && (
        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <AlertTriangle size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
          <span>
            {data.anunciosSinResolver}{' '}
            {data.anunciosSinResolver === 1 ? 'anuncio trajo' : 'anuncios trajeron'} gente y todavía no
            sabemos de qué campaña {data.anunciosSinResolver === 1 ? 'es' : 'son'}. Sus leads van a la
            rueda hasta que se actualice desde Meta.
          </span>
        </p>
      )}
      {huerfanos.length > 0 && (
        <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
          <AlertTriangle size={13} strokeWidth={2} className="mt-px shrink-0" aria-hidden />
          <span>
            Hay cables hacia {huerfanos.join(', ')}, que ya no participa
            {huerfanos.length === 1 ? '' : 'n'} del reparto de esta línea: no se dibujan y sus leads
            igual le caen. Para sacarlos, volvé a conectar la pieza desde cero.
          </span>
        </p>
      )}
      {refrescar.isError && (
        <p className="text-[11px] text-destructive">{(refrescar.error as Error).message}</p>
      )}
    </div>
  );
}

function Grupo({
  titulo,
  mostrar,
  children,
}: {
  titulo: string;
  mostrar: boolean;
  children: React.ReactNode;
}) {
  if (!mostrar) return null;
  return (
    <section className="mb-3">
      <p className="px-1 pb-1 font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {titulo}
      </p>
      <ul className="space-y-1">{children}</ul>
    </section>
  );
}

function Fila({
  titulo,
  pie,
  activa,
  onElegir,
}: {
  titulo: string;
  pie: string;
  activa: boolean;
  onElegir: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onElegir}
        aria-current={activa}
        className={
          'flex w-full items-center gap-1 rounded-xl border px-2.5 py-2 text-left transition-[color,background-color,border-color] duration-200 ease-house focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ' +
          (activa ? 'border-navy/30 bg-navy/5' : 'border-transparent hover:bg-secondary')
        }
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">{titulo}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{pie}</span>
        </span>
        {activa && <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-navy" aria-hidden />}
      </button>
    </li>
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

/**
 * LA MIGA DE PAN DEL NIVEL DE ADENTRO.
 *
 * ⚠️ **`Escape` sube un nivel, y el listener va en captura sobre `window`**: en
 * este lienzo el foco suele estar en un puerto, y sin captura el botón se come
 * la tecla antes de que llegue acá. Es el mismo contrato que el resto de la casa
 * (`escapeDePopover`), y por eso se limpia al desmontar.
 */
function Migas({
  titulo,
  cargando,
  onSalir,
}: {
  titulo: string;
  cargando: boolean;
  onSalir: () => void;
}) {
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSalir();
      }
    }
    window.addEventListener('keydown', alTeclear, true);
    return () => window.removeEventListener('keydown', alTeclear, true);
  }, [onSalir]);

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-6 py-2">
      <button
        type="button"
        onClick={onSalir}
        className="rounded text-[11px] font-medium text-muted-foreground transition-colors duration-200 ease-house hover:text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Routing
      </button>
      <ChevronRight size={12} strokeWidth={2} className="text-muted-foreground" aria-hidden />
      <span className="truncate text-[11px] font-medium text-foreground">{titulo}</span>
      <span className="text-[11px] text-muted-foreground">
        {cargando ? '· buscando sus anuncios…' : '· sus anuncios son de solo lectura'}
      </span>
      <kbd className="ml-auto rounded border border-border px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
        Esc
      </kbd>
    </div>
  );
}
