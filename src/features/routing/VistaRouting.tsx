import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, RefreshCw, Route, Search } from 'lucide-react';
import { Lienzo } from './Lienzo';
import { conCambio, destinosDe, type CableLienzo } from './reglasDelLienzo';
import {
  ID,
  cablesDe,
  cablesHuerfanos,
  columnasDePieza,
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
   * QUÉ CAMPAÑA ESTÁ ABIERTA. `null` = ninguna. **No baja un nivel**: se abre
   * dentro del mismo lienzo, así que el producto y las hermanas no se van.
   */
  const [abierta, setAbierta] = useState<string | null>(null);
  const [cables, setCables] = useState<CableLienzo[]>([]);
  const anuncios = useAnunciosDeCampana(abierta ? leerId(abierta).clave : null);

  /**
   * EL ESPEJO DE `cables`, para poder leer el estado ACTUAL desde un manejador.
   *
   * 🔴 **Es la condición para haber sacado el congelamiento** (ver `aplicar`).
   * Mientras el lienzo se apagaba al guardar, dos gestos no podían solaparse y
   * `cables` del closure alcanzaba. Ahora sí se solapan: dos cables seguidos
   * desde el MISMO origen leerían los dos el mismo estado viejo, y el segundo
   * `PUT` —que declara el conjunto COMPLETO— borraría el cable del primero.
   *
   * ⚠️ **La carrera no se pudo gatillar desde Playwright** (12-ago-2026): entre
   * gesto y gesto React alcanza a re-renderizar. O sea que esto NO tapa un
   * defecto observado: cierra una ventana que un dedo rápido sí puede abrir y
   * que, cuando se abriera, sería muda.
   */
  const espejo = useRef<CableLienzo[]>([]);

  /** `Escape` cierra la campaña abierta. En captura: el foco suele estar en un puerto. */
  useEffect(() => {
    if (!abierta) return;
    function alTeclear(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setAbierta(null);
    }
    window.addEventListener('keydown', alTeclear, true);
    return () => window.removeEventListener('keydown', alTeclear, true);
  }, [abierta]);

  const piezas = data ? piezasDe(data) : [];
  const productos = data ? productosDe(data, piezas) : [];

  const guardando = conectar.isPending || conectarCurso.isPending || conectarProducto.isPending;

  /**
   * LA FOTO DEL SERVER SIEMPRE GANA — **pero recién cuando no queda nada en
   * vuelo.** Al llegar datos nuevos los cables se rearman de lo guardado, y eso
   * es lo que revierte un cable que el server no aceptó, sin que la pantalla
   * tenga que saber por qué.
   *
   * 🔴 **El `!guardando` es la mitad que faltaba.** Con dos gestos seguidos, el
   * refetch del primero aterriza mientras el segundo todavía viaja, y esa foto
   * —correcta, pero vieja— borra el cable recién tirado. Se veía como «a veces
   * se rompe»: el cable desaparecía y la regla quedaba guardada igual.
   */
  const huella = piezas.map((p) => `${p.id}=${p.vendedoras.join(',')}`).join('|');
  useEffect(() => {
    if (guardando) return;
    const desdeElServer = cablesDe(piezas, data?.destinos ?? []);
    espejo.current = desdeElServer;
    setCables(desdeElServer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huella, (data?.destinos ?? []).join('|'), guardando]);

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
  /**
   * En «Todo» lo que ya está adentro de un producto no se repite suelto: sería la
   * misma regla ofrecida dos veces, y dos números sobre el mismo tráfico.
   *
   * ⚠️ **Salvo cuando hay búsqueda.** Sin esta excepción, escribir el nombre de
   * una campaña que pertenece a un producto contestaba «Nada coincide con el
   * filtro» — la pantalla negando algo que tiene a la vista. Buscar es pedir por
   * nombre, y quien pide por nombre quiere ESA cosa, no su grupo.
   */
  const sueltasVisibles = piezas.filter(
    (p) =>
      coincide(p.titulo) &&
      (filtro === 'todo' ? p.familia === null || Boolean(q) : filtro === p.icono),
  );

  const productoElegido = productos.find((p) => ID.producto(p.familia) === elegido) ?? null;
  const piezaElegida = productoElegido ? null : (piezas.find((p) => p.id === elegido) ?? null);
  const producto = productoElegido ?? (piezaElegida ? null : (productosVisibles[0] ?? null));
  const pieza = piezaElegida ?? (producto ? null : (sueltasVisibles[0] ?? null));

  /**
   * ⚠️ Lo abierto se limpia solo si dejó de estar en pantalla (cambió el filtro,
   * la búsqueda o el producto): si no, la campaña quedaría «abierta» invisible y
   * al volver aparecería desplegada sin que nadie la tocara.
   */
  const apertura = {
    id: armadoVisible(abierta, producto, pieza),
    anuncios: anuncios.data?.anuncios ?? [],
    cargando: anuncios.isLoading,
  };
  const armado = producto
    ? columnasDeProducto(producto, data.destinos, apertura)
    : { columnas: pieza ? columnasDePieza(pieza, data.destinos, apertura) : [], pertenencia: [] };

  /**
   * 🔴 GUARDA EL CONJUNTO COMPLETO DEL ORIGEN, no el cable suelto. El server es
   * declarativo (`PUT` con el arreglo entero) porque con `conectar`/`desconectar`
   * dos personas editando lo mismo se pisan: la última cree que sumó un cable y
   * en realidad borró el de la otra.
   *
   * 🔴 **GUARDAR AVISA, NO CONGELA — y esto ES «a veces se rompe».** El lienzo
   * pasaba `deshabilitado={guardando}` y eso apagaba TODOS los puertos mientras
   * el `PUT` viajaba: tirabas el segundo cable, `alBajarEnPuerto` volvía en la
   * primera línea y **no pasaba nada, sin un solo síntoma**. Verificado en el
   * navegador el 12-ago-2026 (`isDisabled()` del puerto de origen daba `true`
   * justo después del primer gesto). Cablear a cinco vendedoras son cinco
   * esperas, y la que se pierde no avisa. Ahora el gesto entra siempre y el
   * header dice «Guardando…».
   *
   * 🔴 **Y por eso el cambio se calcula sobre `espejo.current`, nunca sobre
   * `cables`**: sacar el congelamiento permite que dos guardados se solapen, y
   * el espejo es lo que impide que el segundo pise al primero.
   */
  function aplicar(de: string, a: string, accion: 'conectar' | 'cortar') {
    const siguientes = conCambio(espejo.current, de, a, accion);
    espejo.current = siguientes;
    setCables(siguientes);
    const destinos = destinosDe(siguientes, de).map((v) => leerId(v).clave);
    const { tipo, clave } = leerId(de);
    if (tipo === 'campana') conectar.mutate({ campanaId: clave, vendedoras: destinos });
    else if (tipo === 'curso') conectarCurso.mutate({ curso: clave, vendedoras: destinos });
  }

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
          {/* 🔴 Guardar AVISA, no congela — ver el comentario de `aplicar`. */}
          {guardando && <span className="text-[11px] text-muted-foreground">Guardando…</span>}
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
                onConectar={(de, a) => aplicar(de, a, 'conectar')}
                onCortar={(de, a) => aplicar(de, a, 'cortar')}
                onEntrar={(id) => setAbierta((y) => (y === id ? null : id))}
              />
              {producto && (
                <PieDeProducto
                  producto={producto}
                  guardando={guardando}
                  acuse={conectarProducto.data ?? null}
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

/**
 * ¿LO ABIERTO SIGUE EN PANTALLA? Si cambiaste de producto o de filtro, la campaña
 * que habías abierto ya no se está dibujando: dejarla marcada haría que al volver
 * apareciera desplegada sin que nadie la tocara.
 */
function armadoVisible(
  abierta: string | null,
  producto: Producto | null,
  pieza: Pieza | null,
): string | null {
  if (!abierta) return null;
  const enPantalla = producto ? producto.piezas : pieza ? [pieza] : [];
  return enPantalla.some((p) => p.id === abierta) ? abierta : null;
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
  acuse,
  onAplicar,
}: {
  producto: Producto;
  guardando: boolean;
  /**
   * 🔴 CUÁNTAS PIEZAS TOCÓ EL SERVER, y se muestra. «Listo» sobre cinco piezas y
   * «listo» sobre cero se ven igual — y el cero pasa de verdad: un producto cuyas
   * campañas dejaron de mandar a esta línea no tiene nada que cablear.
   */
  acuse: { campanas: number; cursos: number } | null;
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
        {acuse
          ? `Listo: ${acuse.campanas} campaña${acuse.campanas === 1 ? '' : 's'} y ${acuse.cursos} formulario${acuse.cursos === 1 ? '' : 's'}.`
          : union.length === 0
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
