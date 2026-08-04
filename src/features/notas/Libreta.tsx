import { useEffect, useRef, useState } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import { ChevronLeft, Notebook, Pin, PinOff, Plus, Search, Trash2 } from 'lucide-react';
import '@blocknote/mantine/style.css';
import {
  type Nota,
  docParaEditor,
  resumenDeNota,
  tituloDeNota,
  useBuscarNotas,
  useMutacionesNotas,
  useNotas,
} from './notas';

/**
 * LA LIBRETA — el espacio de trabajo privado de la vendedora. La OCTAVA VISTA
 * del riel (⌘8), y también la tecla `n` de siempre.
 *
 * ══ POR QUÉ AHORA SÍ ES UNA VISTA DEL RIEL (ADR 0034) ═══════════════════════
 *
 * Acá decía «el riel se queda en SEIS» y que esto era una superficie que se
 * abre con `n` — la categoría de la Cabina (`?`) e Ivi (`i`). El criterio de
 * ADR 0016 no cambió y **es el que la hace entrar**: el riel es para LUGARES.
 * La Cabina e Ivi no son lugares, son CONSULTAS que abrís, usás y cerrás; una
 * libreta es un lugar — entrás, estás un rato, volvés.
 *
 * Lo que sí cambió es la evidencia. Aquella decisión (#197) se tomó cuando la
 * libreta era chica y no entraba gente nueva. Al 4-ago-2026 entran seis
 * vendedores el mismo día y la tabla `notas` tiene **cero filas**: nadie
 * escribió nunca una. Se abría con una tecla que nadie enseñó y no tenía ícono
 * en ningún lado.
 *
 * ══ EL ESCAPE SIGUE SIN MANEJARSE ACÁ ═══════════════════════════════════════
 *
 * Antes porque el componente vivía montado con la app y un `useEscape` sin su
 * condición de abierta **se come el Escape de todos** (pasó con `ConsultaIvi`:
 * dejaron de andar cerrar la conversación, cerrar la Cabina y cerrar la libreta
 * — ADR 0024). Ahora por un motivo distinto y más simple: **de una vista no se
 * sale con Escape**, se va a otra. Como en Dashboard o Pipeline, acá Escape no
 * hace nada. No agregar un listener propio.
 *
 * ══ LO QUE NO HACE, POR REGLA ═══════════════════════════════════════════════
 *
 * **No tiene botón de mandar.** De una nota no se deriva nada: ni etapa, ni
 * recordatorio, ni envío (ADR 0012). Si se pareciera a una respuesta rápida
 * rompería «un envío = una acción humana». Se archiva, no se borra. Y **sin
 * oro**: el dorado significa tiempo que se acaba, y acá no se acaba nada.
 */

/** Lo que la lista tiene seleccionado: una nota guardada, o una página en blanco. */
type Seleccion = { tipo: 'nota'; id: number; origen: Nota['origen'] } | { tipo: 'nueva' } | null;

const CLAVE_LIBRETA = 'general';

/** Cuánto se espera después de la última tecla para guardar. */
const ESPERA_AUTOGUARDADO_MS = 800;

function mismaSeleccion(a: Seleccion, b: Seleccion): boolean {
  if (a === null || b === null) return a === b;
  if (a.tipo !== b.tipo) return false;
  return a.tipo === 'nota' && b.tipo === 'nota' ? a.id === b.id : true;
}

/**
 * EL EDITOR de una página. Va con `key` de afuera para que cambiar de nota lo
 * REMONTE: `useCreateBlockNote` fija su `initialContent` en el primer render y
 * no lo vuelve a mirar, así que sin remontar se quedaría con la nota anterior.
 */
function EditorDePagina({
  contenidoInicial,
  soloLectura,
  onCambio,
}: {
  contenidoInicial: unknown[] | undefined;
  soloLectura: boolean;
  onCambio: (doc: unknown) => void;
}) {
  const editor = useCreateBlockNote({
    // El cast es el borde con la librería: `docParaEditor` produce la forma de
    // BlockNote pero el tipo viaja como `unknown` desde la base — tiparlo fuerte
    // más arriba sería afirmar sobre un `jsonb` algo que nadie verificó.
    initialContent: contenidoInicial as never,
  });

  return (
    <BlockNoteView
      editor={editor}
      editable={!soloLectura}
      theme="light"
      onChange={() => onCambio(editor.document)}
      data-libreta-editor
    />
  );
}

/** Un renglón de la lista de páginas. */
function FilaPagina({
  nota,
  activa,
  onAbrir,
  onFijar,
  onArchivar,
}: {
  nota: Nota;
  activa: boolean;
  onAbrir: () => void;
  onFijar: () => void;
  onArchivar: () => void;
}) {
  const titulo = tituloDeNota(nota);
  const resumen = resumenDeNota(nota);
  const historica = nota.origen === 'gestion';

  return (
    <div
      className={`group relative rounded-lg border px-3 py-2 transition ${
        activa ? 'border-primary bg-secondary' : 'border-transparent hover:bg-muted'
      }`}
    >
      <button type="button" onClick={onAbrir} className="block w-full text-left">
        <div className="flex items-center gap-1.5">
          {nota.fijada && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="fijada" />}
          <span className="truncate text-sm font-medium text-foreground">{titulo || 'Sin título'}</span>
        </div>
        {resumen && <p className="mt-0.5 truncate text-xs text-muted-foreground">{resumen}</p>}
        <p className="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          <span>{new Date(nota.creadoAt).toLocaleDateString('es-PE', { day: 'numeric', month: 'short' })}</span>
          {nota.editadoAt && <span>· editada</span>}
          {historica && (
            <span className="rounded border border-dashed border-border px-1 py-px" title="Quedó de una gestión: se lee, no se edita">
              de gestión
            </span>
          )}
        </p>
      </button>

      {!historica && (
        <div className="absolute right-1.5 top-1.5 hidden gap-0.5 group-hover:flex">
          <button
            type="button"
            onClick={onFijar}
            aria-label={nota.fijada ? 'Desfijar' : 'Fijar'}
            className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
          >
            {nota.fijada ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={onArchivar}
            aria-label="Archivar"
            className="rounded p-1 text-muted-foreground hover:bg-card hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export function Libreta() {
  const [busqueda, setBusqueda] = useState('');
  const [seleccion, setSeleccion] = useState<Seleccion>(null);
  const [guardando, setGuardando] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Lo que el temporizador va a hacer cuando venza. Existe para poder ADELANTARLO. */
  const pendiente = useRef<(() => Promise<void>) | null>(null);

  const termino = busqueda.trim();
  const lista = useNotas(CLAVE_LIBRETA);
  const encontradas = useBuscarNotas(termino);
  const { crear, editar, archivar, autoguardar } = useMutacionesNotas(CLAVE_LIBRETA);

  const notas = termino ? (encontradas.data ?? []) : (lista.data ?? []);
  const paginaAbierta =
    seleccion?.tipo === 'nota' ? notas.find((n) => n.id === seleccion.id && n.origen === seleccion.origen) : undefined;

  /**
   * AL IRSE, LO QUE ESTABA POR GUARDARSE SE GUARDA.
   *
   * Antes esto solo limpiaba el temporizador, y como cerrar la libreta la
   * DESMONTABA, escribir y salir dentro de los 800 ms de la espera perdía lo
   * escrito, sin aviso. Como hoja encima de la app era una ventana chica —había
   * que apretar Escape justo—; como vista del riel se sale con ⌘1..⌘8 y con un
   * clic en cualquier ícono, así que la ventana se abre de par en par.
   *
   * Se dispara y no se espera: el desmontaje no puede esperar a la red. La
   * mutación sale igual porque el `QueryClient` es el de la app, no el del
   * componente — sobrevive a que este se vaya.
   */
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
      void pendiente.current?.();
    },
    [],
  );

  /**
   * El autoguardado con espera. La página EN BLANCO no existe en la base hasta
   * que se escribe algo: recién ahí se crea. Así «Nueva página» no ensucia la
   * lista con filas vacías si la vendedora se arrepiente.
   */
  function alCambiar(doc: unknown) {
    if (temporizador.current) clearTimeout(temporizador.current);
    setGuardando(true);

    const guardar = async () => {
      pendiente.current = null;
      try {
        if (seleccion?.tipo === 'nota') {
          await autoguardar.mutateAsync({ id: seleccion.id, doc });
        } else if (seleccion?.tipo === 'nueva') {
          const r = await crear.mutateAsync({ doc });
          setSeleccion({ tipo: 'nota', id: r.nota.id, origen: 'nota' });
        }
      } catch {
        // El error se ve en el renglón de estado; no se pierde lo escrito
        // porque el editor conserva su documento.
      } finally {
        setGuardando(false);
      }
    };

    pendiente.current = guardar;
    temporizador.current = setTimeout(guardar, ESPERA_AUTOGUARDADO_MS);
  }

  const cargando = termino ? encontradas.isPending : lista.isPending;
  const fallo = termino ? encontradas.isError : lista.isError;
  /**
   * ¿Es la PRIMERA vez? Solo cuando la consulta terminó bien y no trajo nada, y
   * sin término de búsqueda — «nada con ese término» no es una libreta vacía.
   * De eso depende que la pantalla enseñe qué poner en vez de quedarse muda.
   */
  const recienEmpieza = !termino && !cargando && !fallo && notas.length === 0;
  /**
   * LA BIENVENIDA SE LLEVA LA PANTALLA ENTERA — lista y buscador incluidos.
   *
   * Con la lista al lado quedaban dos avisos de vacío mirándose («Tu libreta
   * está en blanco» y «Todavía no escribiste nada acá») y dos botones que hacen
   * lo mismo; y un buscador sobre cero páginas es una calle sin salida.
   *
   * Pide `seleccion === null` y no solo la libreta vacía, y esa parte es la que
   * importa: al tocar «Escribir la primera» los muebles vuelven **en ese clic**.
   * Si dependiera solo de `notas.length`, volverían solos a los 800 ms, cuando
   * el autoguardado crea la fila — o sea, un salto de layout mientras escribe.
   */
  const enBienvenida = recienEmpieza && seleccion === null;

  return (
    // Una VISTA, no una hoja: sin `fixed`, sin `z-50` y sin `role="dialog"` —
    // ocupa la columna de contenido igual que Dashboard o Pipeline, y la
    // cabecera de `App.tsx` ya dice de dónde salió («Libreta»).
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Tu libreta">
      {/* LA BARRA: buscar y el estado del guardado. El título NO se repite —
          lo pone la cabecera de la app, y dos veces sería una franja de más. */}
      <div
        className={`h-11 shrink-0 items-center gap-3 border-b border-border px-4 ${
          enBienvenida ? 'hidden' : 'flex'
        }`}
      >
        <div className="relative w-full min-w-0 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en tus páginas…"
            aria-label="Buscar en tus páginas"
            className="h-8 w-full rounded-lg border border-input bg-card pl-8 pr-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
          />
        </div>

        <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
          {guardando ? 'Guardando…' : paginaAbierta?.editadoAt ? 'Guardado' : ''}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/*
          LA LISTA DE PÁGINAS. En ancho de teléfono es MAESTRO-DETALLE: o la
          lista o la página, nunca las dos. Con las dos, el aside de 19rem le
          deja ~85 px al editor y el título sale una letra por renglón.
        */}
        <aside
          className={
            'w-full shrink-0 flex-col border-r border-border md:w-[19rem] ' +
            (enBienvenida ? 'hidden' : seleccion === null ? 'flex md:flex' : 'hidden md:flex')
          }
        >
          <div className="p-3">
            <button
              type="button"
              onClick={() => setSeleccion({ tipo: 'nueva' })}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
            >
              <Plus className="size-4" />
              Nueva página
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            {seleccion?.tipo === 'nueva' && (
              <div className="rounded-lg border border-primary bg-secondary px-3 py-2">
                <span className="text-sm font-medium text-foreground">Página nueva</span>
                <p className="mt-0.5 text-xs text-muted-foreground">Se guarda sola al escribir</p>
              </div>
            )}

            {cargando && <p className="px-2 py-3 text-sm text-muted-foreground">Cargando…</p>}
            {fallo && <p className="px-2 py-3 text-sm text-destructive">No se pudieron traer tus páginas.</p>}
            {!cargando && !fallo && notas.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {termino ? 'Nada con ese término.' : 'Todavía no escribiste nada acá.'}
              </p>
            )}

            {notas.map((n) => (
              <FilaPagina
                key={`${n.origen}-${n.id}`}
                nota={n}
                activa={mismaSeleccion(seleccion, { tipo: 'nota', id: n.id, origen: n.origen })}
                onAbrir={() => setSeleccion({ tipo: 'nota', id: n.id, origen: n.origen })}
                onFijar={() => editar.mutate({ id: n.id, fijada: !n.fijada })}
                onArchivar={() => {
                  archivar.mutate(n.id);
                  if (seleccion?.tipo === 'nota' && seleccion.id === n.id) setSeleccion(null);
                }}
              />
            ))}
          </div>
        </aside>

        {/* EL EDITOR */}
        <main
          className={`min-h-0 flex-1 overflow-y-auto md:block ${
            seleccion === null && !enBienvenida ? 'hidden' : 'block'
          }`}
        >
          {/* La vuelta a la lista, solo en teléfono: en desktop la lista nunca se fue. */}
          {seleccion !== null && (
            <button
              type="button"
              onClick={() => setSeleccion(null)}
              className="flex items-center gap-1 px-4 pt-3 text-sm text-muted-foreground hover:text-foreground md:hidden"
            >
              <ChevronLeft className="size-4" />
              Tus páginas
            </button>
          )}

          {/*
            LA PRIMERA VEZ ENSEÑA QUÉ PONER.

            La tabla `notas` tenía CERO filas el 4-ago-2026: la herramienta
            existía entera y nadie la usó. Una pantalla que dice «elegí una
            página» cuando no hay ninguna no ayuda a empezar — y «cualquier
            cosa, tipo Notion» es justo lo que cuesta arrancar sin un ejemplo.

            Es un estado de la PANTALLA, no una fila sembrada en la base: leer
            no escribe (la regla de toda la casa), no puede resucitar después de
            archivarla, y desaparece sola en cuanto hay una página de verdad.
          */}
          {enBienvenida && (
            <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-3 px-6">
              <Notebook className="size-8 text-muted-foreground/40" />
              <p className="text-center text-sm font-medium text-foreground">Tu libreta está en blanco</p>
              <p className="text-center text-xs text-muted-foreground">
                Anotá lo que quieras. Es tuya: nadie más del equipo la ve, y de acá no sale ningún mensaje.
              </p>
              {/*
                Los ejemplos van ALINEADOS A LA IZQUIERDA: tres renglones
                centrados se leen como un párrafo partido, no como una lista, y
                lo único que tienen que hacer es dar una idea de qué poner.

                Y sobre `bg-card`, no en la bandeja hundida de ADR 0017: el
                fondo de una vista ya es `bg-muted`, así que ahí la bandeja no
                se ve — sería una caja que existe en el código y no en la
                pantalla. Acá el plano hundido es el de afuera.
              */}
              <ul className="w-full space-y-1 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
                <li>· Los precios y las cuotas que más te preguntan</li>
                <li>· Cómo contestás las objeciones que se repiten</li>
                <li>· Lo que quedó pendiente con alguien, para mañana</li>
              </ul>
              <button
                type="button"
                onClick={() => setSeleccion({ tipo: 'nueva' })}
                className="mt-1 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary-hover"
              >
                <Plus className="size-4" />
                Escribir la primera
              </button>
            </div>
          )}

          {seleccion === null && !enBienvenida && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Notebook className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Elegí una página, o creá una nueva.</p>
              <p className="max-w-xs text-xs text-muted-foreground/80">
                Es tuya: nadie más del equipo la ve. De acá no sale ningún mensaje.
              </p>
            </div>
          )}

          {seleccion?.tipo === 'nueva' && (
            <div className="mx-auto max-w-3xl px-6 py-8">
              <EditorDePagina key="nueva" contenidoInicial={undefined} soloLectura={false} onCambio={alCambiar} />
            </div>
          )}

          {paginaAbierta && (
            <div className="mx-auto max-w-3xl px-6 py-8">
              {paginaAbierta.origen === 'gestion' && (
                <p className="mb-4 rounded-lg border border-dashed border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  Esta quedó de una gestión vieja. Se lee, no se edita — la etapa de esa conversación se apoya en ella.
                </p>
              )}
              <EditorDePagina
                key={`${paginaAbierta.origen}-${paginaAbierta.id}`}
                contenidoInicial={docParaEditor(paginaAbierta)}
                soloLectura={paginaAbierta.origen === 'gestion'}
                onCambio={alCambiar}
              />
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
