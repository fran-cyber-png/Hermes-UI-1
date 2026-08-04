import { useEffect, useState } from 'react';
import { ChevronLeft, Eye, EyeOff, Lightbulb, Plus, RotateCcw, ServerCrash, X } from 'lucide-react';
import { ErrorApi } from '../../lib/datos/cliente';
import { useEscape } from '../../lib/teclado/useEscape';
import { sectionLabel } from '../../lib/styles';
import { MOMENTOS, PORQUE_DEL_MOMENTO, type MomentoDeVenta } from './hechos';
import {
  claveSugerida,
  enCuantosMomentosSeVe,
  useCatalogoHechos,
  useMutacionesHechos,
  type HechoDelCatalogo,
} from './catalogo';

/**
 * EL CATÁLOGO DE DATOS RECOMENDADOS — la pantalla que nunca existió.
 *
 * ══ QUÉ PROBLEMA RESUELVE, MEDIDO ═══════════════════════════════════════════
 *
 * La tabla `hechos` es el ÚNICO activo de conocimiento compartido que el equipo
 * mantiene de verdad: 30 filas en producción al 4-ago-2026, editadas en cuatro
 * días distintos. La API para editarla existe desde #153 y hasta hoy tenía
 * **cero consumidores en el front** — se cargaba por SQL a mano.
 *
 * Y el recorte del panel la dejaba a medio usar: 21 de 27 datos sin momentos y
 * las 13 frases de plata con `orden = 100` (el default del schema), contra un
 * tope de 3 chips. Resultado: **el bot ve 27 piezas y la vendedora ve 3**, y
 * las de precio no aparecen nunca.
 *
 * ══ POR QUÉ LA COLUMNA DERECHA NO ES UN FORMULARIO MÁS ══════════════════════
 *
 * Sin dato seleccionado muestra **qué ve la vendedora en cada momento**. Ese es
 * el trabajo de la pantalla: la lista sola no contesta «¿esto se llega a ver?»
 * —depende del `orden` de los otros—, y esa es exactamente la pregunta que hace
 * que alguien cargue una frase y no sirva para nada.
 *
 * El recorte **no se calcula acá**: viaja en `vistaPrevia`, hecho por la misma
 * función que recorta en el panel (`hechos/elegir.ts`). Reimplementarlo daría
 * una pantalla que afirma «esto se ve» mientras la vendedora no lo ve (#37).
 *
 * ══ LO QUE NO HACE ══════════════════════════════════════════════════════════
 *
 * **No manda nada.** De acá no sale un mensaje: se editan frases que la
 * vendedora después toca en el panel, y tocarlas tampoco envía (#45). **Borrar
 * es APAGAR** (la regla del server): la frase que dejó de funcionar sirve de
 * historia y el catálogo tiene que poder auditarse contra las ventas.
 * Y **sin oro**: el dorado significa tiempo que se acaba, y acá no se acaba nada.
 */

/**
 * Lo que la columna derecha está mostrando.
 *
 * `'previa'` existe SOLO por el ancho de teléfono: en desktop la tabla «qué ve
 * la vendedora» es lo que se ve sin nada elegido (`null`), pero ahí el `main`
 * está oculto y el contenido más importante de la pantalla quedaba inalcanzable.
 */
type Seleccion = { tipo: 'nuevo' } | { tipo: 'previa' } | { tipo: 'hecho'; clave: string } | null;

/**
 * EL MOTIVO QUE MANDÓ EL SERVER, no «Error 400».
 *
 * `routes/hechos.ts` arma `errores` desde los `issues` de Zod, así que ahí
 * viene «el orden va entre 0 y 999» o «la clave va en minúsculas, sin
 * espacios». Descartarlo dejaba a la vendedora sin saber qué campo corregir.
 */
function motivoDelError(e: unknown): string {
  if (e instanceof ErrorApi && e.errores?.length) return e.errores.join(' · ');
  if (e instanceof ErrorApi && e.status === 404) return 'Ese dato ya no existe: refrescá la pantalla';
  return e instanceof Error && e.message ? e.message : 'No se pudo guardar';
}

const ORDEN_MIN = 0;
const ORDEN_MAX = 999;

/** Un renglón de la lista. El número de la derecha es el punto de toda la pantalla. */
function Fila({
  h,
  seVeEn,
  activa,
  onAbrir,
}: {
  h: HechoDelCatalogo;
  /** `null` = este server no manda el recorte: no se sabe, y no se afirma. */
  seVeEn: number | null;
  activa: boolean;
  onAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={
        'block w-full rounded-lg border px-3 py-2 text-left transition-colors ' +
        (activa ? 'border-primary bg-secondary' : 'border-transparent hover:bg-muted')
      }
    >
      <div className="flex items-baseline gap-2">
        <span
          className={
            'min-w-0 flex-1 truncate text-sm font-medium ' +
            (h.activo !== false ? 'text-foreground' : 'text-muted-foreground line-through')
          }
        >
          {h.rotulo}
        </span>
        {h.activo !== false && seVeEn !== null ? (
          <span
            title={
              seVeEn === 0
                ? 'No llega a verse en ningún momento: otros le ganan por orden'
                : `Se ve en ${seVeEn} de ${MOMENTOS.length} momentos`
            }
            className={
              'shrink-0 rounded px-1.5 py-px font-mono text-[10px] font-semibold ' +
              (seVeEn === 0 ? 'bg-warning/20 text-warning-foreground' : 'bg-muted text-muted-foreground')
            }
          >
            {seVeEn === 0 ? 'no se ve' : `${seVeEn}/${MOMENTOS.length}`}
          </span>
        ) : h.activo === false ? (
          <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
            apagado
          </span>
        ) : null}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{h.texto}</p>
    </button>
  );
}

/** «Qué ve la vendedora» — la tabla que la lista no puede contestar. */
function QueVeLaVendedora({
  hechos,
  vistaPrevia,
  tope,
  onElegir,
}: {
  hechos: HechoDelCatalogo[];
  vistaPrevia: Record<MomentoDeVenta, string[]>;
  tope: number | undefined;
  onElegir: (clave: string) => void;
}) {
  const rotuloDe = (clave: string) => hechos.find((h) => h.clave === clave)?.rotulo ?? clave;
  const activos = hechos.filter((h) => h.activo !== false).length;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h3 className={'flex items-center gap-1.5 ' + sectionLabel}>
        <Eye size={13} /> Qué ve la vendedora
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Tenés <strong className="text-foreground">{activos}</strong> datos prendidos. En cada momento de
        la venta el panel muestra <strong className="text-foreground">{tope ?? '…'}</strong> — estos:
      </p>

      <ul className="mt-4 space-y-2.5">
        {MOMENTOS.map((m) => (
          <li key={m} className="rounded-lg border border-border bg-card px-3 py-2.5">
            <p className="text-xs font-semibold text-navy">{PORQUE_DEL_MOMENTO[m]}</p>
            {vistaPrevia[m]?.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {vistaPrevia[m].map((clave) => (
                  <button
                    key={clave}
                    type="button"
                    onClick={() => onElegir(clave)}
                    className="rounded border border-border px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:border-primary/40 hover:bg-muted"
                  >
                    {rotuloDe(clave)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Nada: en este momento no se le ofrece ningún dato.
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-[11px] leading-snug text-muted-foreground">
        ¿Falta uno que cargaste? Miralo en la lista: si dice <strong>«no se ve»</strong>, hay otros
        con <strong>orden</strong> más bajo que le ganan el lugar. Bajale el número.
      </p>
    </div>
  );
}

/** El formulario de un dato. `clave` se propone al crear y después se congela. */
function Editor({
  hecho,
  editable,
  deFabrica,
  onListo,
}: {
  hecho: HechoDelCatalogo | null;
  editable: boolean;
  /**
   * `true` = la tabla está migrada pero VACÍA, así que lo que se ve son las
   * filas de fábrica y **no existen en la base**. Guardar una tiene que ser un
   * POST: con `PUT` el server contesta 404 sobre algo que la pantalla acaba de
   * mostrar como editable.
   */
  deFabrica: boolean;
  onListo: (clave: string) => void;
}) {
  const { crear, editar, apagar, prender } = useMutacionesHechos();
  const esNuevo = hecho === null;

  const [rotulo, setRotulo] = useState(hecho?.rotulo ?? '');
  const [texto, setTexto] = useState(hecho?.texto ?? '');
  const [orden, setOrden] = useState(String(hecho?.orden ?? 100));
  const [momentos, setMomentos] = useState<MomentoDeVenta[]>(hecho?.momentos ?? []);
  const [error, setError] = useState<string | null>(null);

  const clave = esNuevo ? claveSugerida(rotulo) : hecho.clave;
  const trabajando = crear.isPending || editar.isPending || apagar.isPending || prender.isPending;

  // El server valida lo mismo (`routes/hechos.ts`); acá se dice ANTES de que
  // vuelva un 400, que es la diferencia entre corregir y adivinar.
  const motivoParaNoGuardar =
    rotulo.trim().length < 2
      ? 'El rótulo necesita al menos 2 caracteres'
      : rotulo.trim().length > 30
        ? 'El rótulo no puede pasar de 30 caracteres: es lo que entra en un chip de 360 px'
        : texto.trim().length < 5
          ? 'La frase necesita al menos 5 caracteres'
          : texto.trim().length > 600
            ? 'La frase no puede pasar de 600 caracteres'
            : clave.length < 2
              ? 'Del rótulo no sale una clave usable: poné al menos dos letras o números'
              : !Number.isInteger(Number(orden)) || orden.trim() === ''
                ? 'El orden tiene que ser un número entero'
                : // `|| 0` guardaba CERO —la máxima prioridad— cuando el campo
                  // quedaba vacío: el dato le ganaba el lugar a todos los demás
                  // en los seis momentos, y la vendedora había visto un campo en
                  // blanco, no un cero.
                  Number(orden) < ORDEN_MIN || Number(orden) > ORDEN_MAX
                  ? `El orden va entre ${ORDEN_MIN} y ${ORDEN_MAX}`
                  : null;

  async function guardar() {
    setError(null);
    const campos = { rotulo: rotulo.trim(), texto: texto.trim(), momentos, orden: Number(orden) };
    try {
      if (esNuevo || deFabrica) await crear.mutateAsync({ clave, ...campos });
      else await editar.mutateAsync({ clave, ...campos });
      onListo(clave);
    } catch (e) {
      // El server ya calculó el motivo y lo manda en `errores` (`routes/hechos.ts`
      // arma la lista desde Zod). Descartarlo dejaba «Error 400» sin decir qué
      // campo ni por qué — que es lo mismo que no decir nada.
      setError(motivoDelError(e));
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={sectionLabel}>{esNuevo ? 'Un dato nuevo' : 'Editar el dato'}</h3>
        <code className="shrink-0 font-mono text-[11px] text-muted-foreground" title="La identidad: no cambia aunque renombres el rótulo">
          {clave || '…'}
        </code>
      </div>

      <label className="mt-4 block">
        <span className="text-xs font-medium text-foreground">El rótulo</span>
        <span className="ml-1.5 text-[11px] text-muted-foreground">lo que se lee en el chip</span>
        <input
          value={rotulo}
          onChange={(e) => setRotulo(e.target.value)}
          disabled={!editable}
          maxLength={30}
          placeholder="Cuotas"
          className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-ring disabled:opacity-60"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-xs font-medium text-foreground">La frase</span>
        <span className="ml-1.5 text-[11px] text-muted-foreground">
          sale tal cual a la caja, en tu voz
        </span>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          disabled={!editable}
          rows={3}
          maxLength={600}
          placeholder="Se puede pagar en 2 cuotas, sin interés."
          className="mt-1 w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-ring disabled:opacity-60"
        />
      </label>

      <fieldset className="mt-3">
        <legend className="text-xs font-medium text-foreground">¿Cuándo corresponde?</legend>
        <p className="text-[11px] text-muted-foreground">
          Sin ninguno marcado vale para todos los momentos.
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {MOMENTOS.map((m) => {
            const puesto = momentos.includes(m);
            return (
              <button
                key={m}
                type="button"
                disabled={!editable}
                aria-pressed={puesto}
                onClick={() =>
                  setMomentos((v) => (puesto ? v.filter((x) => x !== m) : [...v, m]))
                }
                className={
                  'rounded-lg border px-2 py-1 text-[11px] transition-colors disabled:opacity-60 ' +
                  (puesto
                    ? 'border-primary bg-secondary text-navy'
                    : 'border-border text-muted-foreground hover:bg-muted')
                }
              >
                {PORQUE_DEL_MOMENTO[m]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="mt-3 block max-w-[14rem]">
        <span className="text-xs font-medium text-foreground">Orden</span>
        <span className="ml-1.5 text-[11px] text-muted-foreground">más bajo gana el lugar</span>
        <input
          type="number"
          value={orden}
          min={ORDEN_MIN}
          max={ORDEN_MAX}
          onChange={(e) => setOrden(e.target.value)}
          disabled={!editable}
          className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-ring disabled:opacity-60"
        />
      </label>

      {motivoParaNoGuardar && rotulo + texto !== '' && (
        <p className="mt-3 text-xs text-warning-foreground">{motivoParaNoGuardar}</p>
      )}
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      <div className="mt-5 flex items-center gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={!editable || Boolean(motivoParaNoGuardar) || trabajando}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
        >
          {trabajando ? 'Guardando…' : esNuevo ? 'Agregar el dato' : 'Guardar'}
        </button>

        {!esNuevo && editable && !deFabrica && (
          <button
            type="button"
            onClick={() => {
              setError(null);
              const m = hecho.activo ? apagar : prender;
              m.mutateAsync(hecho.clave).catch((e: unknown) =>
                setError(e instanceof Error ? e.message : 'No se pudo cambiar'),
              );
            }}
            disabled={trabajando}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            {hecho.activo ? <EyeOff size={14} /> : <RotateCcw size={14} />}
            {hecho.activo ? 'Apagar' : 'Volver a prender'}
          </button>
        )}
      </div>

      {!esNuevo && !deFabrica && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Apagar no borra: la frase queda para poder mirar contra qué ventas se usó.
        </p>
      )}
      {deFabrica && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          Este viene de fábrica y todavía no está en la base: al guardarlo se crea.
        </p>
      )}
    </div>
  );
}

export function PantallaHechos({ onCerrar }: { onCerrar: () => void }) {
  const [seleccion, setSeleccion] = useState<Seleccion>(null);
  const { data, isPending, isError, error } = useCatalogoHechos();

  // El contrato de cierre de la casa: captura + cortar, para no arrastrar el
  // Escape a la conversación de atrás (`src/lib/teclado/`, ADR 0024).
  //
  // Se puede registrar sin condición porque esta pantalla se MONTA solo cuando
  // está abierta (`{abierta && <PantallaHechos/>}`). Si algún día se montara
  // siempre, hay que pasarle su `abierta` como segundo argumento — es la trampa
  // exacta de ADR 0024: un listener en captura desde un componente cerrado se
  // come el Escape de toda la app.
  useEscape(onCerrar);

  const hechos = data?.hechos ?? [];
  const editable = data?.editable ?? false;
  const elegido = seleccion?.tipo === 'hecho' ? hechos.find((h) => h.clave === seleccion.clave) : undefined;

  /**
   * Si el dato abierto deja de existir, la columna derecha no puede quedar
   * mostrando un fantasma.
   *
   * Pasa de verdad en un caso: mientras la tabla está vacía el server sirve el
   * catálogo DE FÁBRICA (`origen: 'defecto'`), así que agregar el primer dato
   * cambia la lista entera y las siete claves de fábrica desaparecen.
   *
   * Depende de `data` y no de `hechos`: `data?.hechos ?? []` es un array nuevo
   * en cada render y haría correr el efecto siempre. `data` lo mantiene estable
   * react-query entre refetches.
   */
  const claveElegida = seleccion?.tipo === 'hecho' ? seleccion.clave : null;
  useEffect(() => {
    if (!claveElegida || !data) return;
    if (!data.hechos.some((h) => h.clave === claveElegida)) setSeleccion(null);
  }, [claveElegida, data]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="Datos recomendados"
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <Lightbulb className="size-4 shrink-0 text-primary" />
        <h2 className="shrink-0 text-sm font-semibold text-foreground">Datos recomendados</h2>
        <p className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground sm:block">
          Las frases que la vendedora toca en el panel. Son del equipo, no tuyas.
        </p>
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="ml-auto rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>

      {data?.origen === 'sin-tabla' && (
        <p className="flex shrink-0 items-start gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-[11px] text-warning-foreground">
          <ServerCrash size={12} className="mt-0.5 shrink-0" />
          La tabla no está migrada en este servidor: se ve el catálogo de fábrica y no se puede
          guardar.
        </p>
      )}

      {/*
        En ancho de teléfono es MAESTRO-DETALLE, como la Libreta: o la lista o
        el detalle, nunca los dos. Sin esto el `main` quedaba `hidden` en mobile
        y la lista era un callejón sin salida — se veía qué datos hay y no había
        forma de abrir ninguno.
      */}
      <div className="flex min-h-0 flex-1">
        <aside
          className={
            'w-full shrink-0 flex-col border-r border-border md:flex md:w-[21rem] ' +
            (seleccion === null ? 'flex' : 'hidden')
          }
        >
          <div className="space-y-2 p-3">
            {/* En desktop la tabla ya está a la derecha; acá sería una puerta
                a la habitación en la que estás parada. */}
            <button
              type="button"
              onClick={() => setSeleccion({ tipo: 'previa' })}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
            >
              <Eye className="size-4" />
              Qué ve la vendedora
            </button>
            <button
              type="button"
              disabled={!editable}
              onClick={() => setSeleccion({ tipo: 'nuevo' })}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
            >
              <Plus className="size-4" />
              Agregar un dato
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {isPending && <p className="px-2 py-3 text-sm text-muted-foreground">Cargando…</p>}
            {isError && (
              <p className="px-2 py-3 text-sm text-destructive">
                No se pudo traer el catálogo{error instanceof Error ? `: ${error.message}` : '.'}
              </p>
            )}
            {!isPending && !isError && hechos.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Todavía no hay datos cargados.
              </p>
            )}
            {hechos.map((h) => (
              <Fila
                key={h.clave}
                h={h}
                seVeEn={enCuantosMomentosSeVe(h.clave, data?.vistaPrevia)}
                activa={seleccion?.tipo === 'hecho' && seleccion.clave === h.clave}
                onAbrir={() => setSeleccion({ tipo: 'hecho', clave: h.clave })}
              />
            ))}
          </div>
        </aside>

        <main
          className={
            'min-h-0 flex-1 overflow-y-auto md:block ' + (seleccion === null ? 'hidden' : 'block')
          }
        >
          {/* La vuelta a la lista, solo en teléfono: en desktop nunca se fue. */}
          {seleccion !== null && (
            <button
              type="button"
              onClick={() => setSeleccion(null)}
              className="flex items-center gap-1 px-4 pt-3 text-sm text-muted-foreground hover:text-foreground md:hidden"
            >
              <ChevronLeft className="size-4" />
              Todos los datos
            </button>
          )}

          {(seleccion === null || seleccion.tipo === 'previa') &&
            data &&
            (data.vistaPrevia ? (
              <QueVeLaVendedora
                hechos={hechos}
                vistaPrevia={data.vistaPrevia}
                tope={data.tope}
                onElegir={(clave) => setSeleccion({ tipo: 'hecho', clave })}
              />
            ) : (
              /* Server viejo (N4 despliega el front solo; el server va por N5).
                 Editar sigue andando: lo único que falta es poder decir qué se ve. */
              <div className="mx-auto max-w-md px-6 py-8">
                <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs leading-snug text-warning-foreground">
                  <ServerCrash size={13} className="mt-0.5 shrink-0" />
                  Este servidor todavía no manda el recorte, así que no puedo decirte cuáles llegan a
                  verse. Editar los datos sí funciona.
                </p>
              </div>
            ))}
          {seleccion?.tipo === 'nuevo' && (
            <Editor
              key="nuevo"
              hecho={null}
              editable={editable}
              deFabrica={false}
              onListo={(clave) => setSeleccion({ tipo: 'hecho', clave })}
            />
          )}
          {elegido && (
            <Editor
              key={elegido.clave}
              hecho={elegido}
              editable={editable}
              deFabrica={data?.origen === 'defecto'}
              onListo={(clave) => setSeleccion({ tipo: 'hecho', clave })}
            />
          )}
        </main>
      </div>
    </div>
  );
}
