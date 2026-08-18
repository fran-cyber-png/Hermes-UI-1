import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, Link2, Notebook, Pin, PinOff, Plus, Search, Trash2, Undo2 } from 'lucide-react';
import { TAB_POR_DEFECTO, type TabRibbon } from './ribbon/tabs';
import { AccionesDePagina } from './AccionesDePagina';
import { DiagramaPerezoso, EditorPerezoso, precargarDiagrama, precargarEditor } from './perezosos';
import { PantallaDividida } from './PantallaDividida';
import { mismoUsuario, nombreCorto, useEspacios, type DondeEstoy } from './espacios';
import { SelectorDeEspacio } from './SelectorDeEspacio';
import { tokenDeLaUrl, usePaginaPorLink } from './porLink';
import { renglonDeEstado } from './guardado';
import { useAutoguardado } from './useAutoguardado';
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

function mismaSeleccion(a: Seleccion, b: Seleccion): boolean {
  if (a === null || b === null) return a === b;
  if (a.tipo !== b.tipo) return false;
  return a.tipo === 'nota' && b.tipo === 'nota' ? a.id === b.id : true;
}

/**
 * EL EDITOR OCUPA EL ANCHO DEL PANEL; EL TEXTO SIGUE EN COLUMNA.
 *
 * La barra tiene que cruzar la pantalla como la de Word, y vive adentro de
 * `BlockNoteView` (es el patrón oficial: `FormattingToolbar` necesita el
 * contexto que ese componente provee). Si el contenedor estuviera en una columna
 * de `max-w-3xl`, la barra terminaría al ancho del texto.
 *
 * Así que la restricción de ancho se mudó del CONTENEDOR al TEXTO: acá no hay
 * `max-w`, y `.bn-editor` se centra en `index.css`. Se evita levantar la
 * instancia del editor y envolver todo con `BlockNoteContext` a mano, que es API
 * bastante menos transitada que ésta.
 *
 * ⚠️ El `pb-8` va acá y no en `.bn-editor`: ese elemento tiene `min-height: 60vh`
 * para que el clic en el vacío de abajo entre al editor, y sumarle padding
 * empujaría esa zona fuera de la vista.
 */
function ColumnaDeEscritura({ children }: { children: React.ReactNode }) {
  return <div className="pb-8">{children}</div>;
}

/** Un renglón de la lista de páginas. */
function FilaPagina({
  nota,
  activa,
  autora,
  onAbrir,
  onFijar,
  onArchivar,
}: {
  nota: Nota;
  activa: boolean;
  /**
   * A quién mostrar como autora, o `null` para no mostrar a nadie.
   *
   * ⚠️ **En la libreta privada NO se dibuja**, y no es por ahorrar píxeles: todas
   * las páginas son tuyas, así que tu propio nombre repetido en cada renglón es
   * ruido puro. En un espacio compartido es al revés — es la mitad de la
   * información, porque decide a quién preguntarle por ese precio.
   */
  autora: string | null;
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
          {/* 🔴 QUE ESTÁ AFUERA SE DICE EN LA LISTA, no solo al abrirla. Es la
              única forma de contestar «¿qué tengo publicado?» de un vistazo — sin
              esto, compartir sería una acción sin inventario. */}
          {nota.token && (
            <Link2 className="size-3 shrink-0 text-muted-foreground" aria-label="tiene link público" />
          )}
        </div>
        {resumen && <p className="mt-0.5 truncate text-xs text-muted-foreground">{resumen}</p>}
        <p className="mt-1 flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
          {/* QUIÉN LA ESCRIBIÓ va PRIMERO, antes de la fecha: en un espacio del
              equipo, «de quién es esto» se pregunta antes que «de cuándo es».
              Sin oro — acá no se acaba ningún tiempo. */}
          {autora && <span className="font-medium text-foreground/70">{autora}</span>}
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

export function Libreta({ vendedoraId }: { vendedoraId?: string | null }) {
  const [busqueda, setBusqueda] = useState('');
  const [seleccion, setSeleccion] = useState<Seleccion>(null);
  /** Lo recién archivado, para poder deshacerlo. Se limpia solo. */
  const [archivada, setArchivada] = useState<{ id: number; titulo: string } | null>(null);
  /**
   * DÓNDE ESTOY ESCRIBIENDO (ADR 0046). `null` = mi libreta privada.
   *
   * Arranca en `null` y el efecto de más abajo la corre al primer espacio en
   * cuanto hay alguno — ver ese efecto para el porqué. Quien no tenga ni un
   * espacio se queda acá, y ve exactamente la Libreta de antes.
   */
  const [donde, setDonde] = useState<DondeEstoy>(null);
  /**
   * SI LLEGAMOS POR UN LINK INTERNO, la página que ese link señala.
   *
   * `useState(tokenDeLaUrl)` y no una llamada suelta: se lee **una vez, en el
   * primer render**, y el hash se limpia ahí mismo. Con una llamada en el cuerpo
   * del componente, cada re-render volvería a mirar una URL que ya se vació.
   */
  const [tokenEntrante] = useState(tokenDeLaUrl);
  const porLink = usePaginaPorLink(tokenEntrante);
  /**
   * LA PESTAÑA ABIERTA DE LA RIBBON — **una sola, y para las tres formas de
   * abrir una página**. Vive acá porque el editor se remonta al cambiar de nota
   * (ver `EditorDePagina`): adentro de la barra, saltar de página te devolvería
   * a «Inicio» cada vez.
   */
  const [tabRibbon, setTabRibbon] = useState<TabRibbon>(TAB_POR_DEFECTO);
  /**
   * ESCONDER LA LISTA DE PÁGINAS — el «Vista ▸ Lista de páginas» de la Ribbon.
   *
   * ⚠️ **Sólo tiene efecto de `md:` para arriba.** En ancho de teléfono la lista
   * y la página ya son maestro-detalle (o una o la otra), así que esconderla ahí
   * dejaría la pantalla sin forma de volver.
   */
  const [listaVisible, setListaVisible] = useState(true);
  const vista = { listaVisible, alternarLista: () => setListaVisible((v) => !v) };

  const termino = busqueda.trim();
  const lista = useNotas(CLAVE_LIBRETA, donde);
  const encontradas = useBuscarNotas(termino);
  const {
    crear,
    editar,
    archivar,
    desarchivar,
    autoguardar,
    mover,
    abrirLink,
    cortarLink,
    dividir,
    cortarDivision,
    crearDiagrama,
    autoguardarDiagrama,
  } = useMutacionesNotas(CLAVE_LIBRETA, donde);
  /**
   * DIVIDIR PANTALLA (17-ago-2026): «estoy eligiendo con qué otra página se
   * divide ésta». Local y ajeno a la base — lo persistido es
   * `paginaAbierta.paginaDivididaId`, que MANDA sobre esto en cuanto existe
   * (ver el render, más abajo). Se apaga solo al cambiar de página: si no,
   * el selector de la anterior quedaría abierto encima de la nueva.
   */
  const [mostrarSelectorDivision, setMostrarSelectorDivision] = useState(false);
  // Los espacios ya vienen cacheados por el selector: es la MISMA queryKey, así
  // que esto no dispara un request nuevo — solo lee lo que ya está.
  const espacios = useEspacios();

  /**
   * AL ENTRAR, si ya hay algún espacio, arranca AHÍ y no en Mi libreta —
   * decisión del dueño (17-ago-2026): con espacios de equipo en uso, la
   * privada deja de ser lo primero que se ve, aunque sigue existiendo y
   * accesible desde el selector.
   *
   * Se dispara UNA sola vez por montaje (`yaEntro`), no en cada render con
   * `donde === null`: si no fuera así, volver a "Mi libreta" a mano desde el
   * selector la traería de vuelta al espacio en el próximo render, y el botón
   * quedaría muerto. Espera a que la consulta resuelva (`espacios.data`, no
   * `.isPending`) para no pisar un `donde` que YA cambió por otro camino —p.ej.
   * llegar por un link— mientras el pedido todavía viaja.
   */
  const yaEntro = useRef(false);
  useEffect(() => {
    if (yaEntro.current || !espacios.data) return;
    yaEntro.current = true;
    if (espacios.data.length > 0) setDonde(espacios.data[0].id);
  }, [espacios.data]);

  const notas = termino ? (encontradas.data ?? []) : (lista.data ?? []);
  const paginaAbierta =
    seleccion?.tipo === 'nota' ? notas.find((n) => n.id === seleccion.id && n.origen === seleccion.origen) : undefined;
  /** `null`/ausente = pantalla simple. Viene de la nota, así que sobrevive a un reload. */
  const divididaId = paginaAbierta?.paginaDivididaId ?? null;

  /**
   * PRECARGAR LO QUE SE VA A ABRIR (ver `perezosos.tsx`).
   *
   * El editor se pide SIEMPRE y sin esperar: entrar a la Libreta es entrar a
   * escribir, así que el chunk viaja mientras la vendedora todavía está
   * eligiendo la página. El diagrama sólo si en la lista hay alguno — son 82 KB
   * gzip, y quien no usa diagramas no tiene por qué bajarlos.
   *
   * ⚠️ El primer diagrama de una libreta que no tiene ninguno SÍ ve el
   * esqueleto: se crea desde «Nuevo Diagrama» de la pantalla dividida, y
   * adivinar eso desde acá sería precargarlo para todos.
   */
  useEffect(() => {
    precargarEditor();
  }, []);
  const hayDiagramas = notas.some((n) => n.tipo === 'diagrama');
  useEffect(() => {
    if (hayDiagramas) precargarDiagrama();
  }, [hayDiagramas]);

  // Cambiar de página apaga el selector de división de la anterior — si no,
  // «Dividir pantalla» quedaría abierto encima de una página que no lo pidió.
  useEffect(() => {
    setMostrarSelectorDivision(false);
  }, [seleccion]);

  /**
   * El autoguardado vive en su propio hook (`useAutoguardado`), y no por
   * prolijidad: adentro de este componente era un `catch {}` que nadie podía
   * interrogar, y de ahí salieron el «Guardado» falso, la doble creación y la
   * pérdida de lo pendiente al salir. Ahí están los tres, con sus tests.
   *
   * Una página `nueva` todavía no tiene fila: `idActual: null` es lo que le
   * dice al hook que el primer guardado es un POST.
   */
  const { estado: estadoGuardado, alCambiar } = useAutoguardado({
    // El `origen` IMPORTA: el id de una página histórica es de `gestiones`, y
    // mandarlo a `PATCH /api/notas/:id` escribiría sobre la nota que
    // casualmente tenga ese número. Esas son de solo lectura: destino `null`.
    destino:
      seleccion === null
        ? null
        : seleccion.tipo === 'nueva'
          ? { tipo: 'nueva' as const }
          : seleccion.origen === 'nota'
            ? { tipo: 'nota' as const, id: seleccion.id }
            : null,
    puertas: {
      // 🔴 UNA PÁGINA DE DIAGRAMA NUNCA MANDA `doc`: no hay BlockNote de por
      // medio. La izquierda no tiene forma de CREAR una (ese camino es
      // exclusivo de «Nuevo Diagrama», a la derecha), así que `crear` no
      // necesita la rama — solo `actualizar`, para cuando se abre acá una que
      // ya existía como diagrama (por búsqueda, por «Mover», o al reabrirla).
      actualizar: (v) =>
        paginaAbierta?.tipo === 'diagrama' ? autoguardarDiagrama.mutateAsync({ id: v.id, diagrama: v.doc }) : autoguardar.mutateAsync(v),
      crear: (v) => crear.mutateAsync(v),
    },
    alCrear: (id) => setSeleccion({ tipo: 'nota', id, origen: 'nota' }),
  });

  /**
   * La página que vino por link se abre SOLA y por encima de la lista: quien
   * hizo clic en un link quería ESA página, no la Libreta.
   *
   * ⚠️ No se toca `donde` ni `seleccion`: la página puede vivir en un espacio del
   * que no sos miembro —el link es lo que te da acceso, no la membresía—, y
   * mover el selector ahí mostraría una lista que el server va a negar con 403.
   */
  const deLink = porLink.data?.nota ?? null;

  const cargando = termino ? encontradas.isPending : lista.isPending;
  const fallo = termino ? encontradas.isError : lista.isError;
  /**
   * ¿Es la PRIMERA vez? Solo cuando la consulta terminó bien y no trajo nada, y
   * sin término de búsqueda — «nada con ese término» no es una libreta vacía.
   * De eso depende que la pantalla enseñe qué poner en vez de quedarse muda.
   */
  const recienEmpieza = !termino && !cargando && !fallo && notas.length === 0;
  /**
   * 🔴 LA BIENVENIDA ES SOLO DE LA LIBRETA PRIVADA — y esto no es estética.
   *
   * Se lleva la pantalla ENTERA, selector incluido. En un espacio compartido
   * recién creado (que está vacío por definición, siempre) eso escondía la única
   * forma de volver a «Mi libreta»: la vendedora quedaba encerrada adentro de un
   * lugar vacío, y el único camino de vuelta era recargar la app.
   *
   * Además el texto miente ahí: dice «es tuya, nadie más la ve» sobre un espacio
   * que ve todo el equipo.
   */
  const enSuLibretaPrivada = donde === null;
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
  const enBienvenida = recienEmpieza && seleccion === null && enSuLibretaPrivada;

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

        {/* EL RENGLÓN DE ESTADO. Quién decide qué dice es una función pura
            (`renglonDeEstado`), porque el defecto no estaba en el `catch` sino
            en el ternario que sólo sabía decir «Guardando…» o «Guardado» — y
            volvía a decir «Guardado» DESPUÉS de un 400. */}
        {(() => {
          const r = renglonDeEstado(estadoGuardado, Boolean(paginaAbierta?.editadoAt));
          if (!r.texto) return <span className="ml-auto" />;
          return (
            <span
              className={
                'ml-auto flex items-center gap-1 text-xs ' +
                (r.hayFallo ? 'font-medium text-destructive' : 'text-muted-foreground')
              }
              aria-live="polite"
              role={r.hayFallo ? 'alert' : undefined}
            >
              {r.hayFallo && <AlertTriangle className="size-3 shrink-0" />}
              {r.texto}
            </span>
          );
        })()}
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
            (enBienvenida ? 'hidden' : seleccion === null ? 'flex md:flex' : 'hidden md:flex') +
            // «Vista ▸ Lista de páginas». ⚠️ Sólo de `md:` para arriba: abajo la
            // lista y la página ya son maestro-detalle, y esconderla ahí dejaría
            // la pantalla sin forma de volver.
            (listaVisible ? '' : ' md:hidden')
          }
        >
          {/* DÓNDE ESTOY ESCRIBIENDO. Va ARRIBA del botón de página nueva, y en
              ese orden: la pregunta «¿esto lo ve alguien más?» se contesta antes
              de escribir, no después. */}
          <SelectorDeEspacio
            donde={donde}
            vendedoraId={vendedoraId}
            onIr={(destino) => {
              setDonde(destino);
              // 🔴 CAMBIAR DE LUGAR CIERRA LA PÁGINA ABIERTA. El id de una página
              // es de la tabla entera, así que sin esto la selección sobrevive al
              // salto y el editor sigue mostrando —y AUTOGUARDANDO— una página del
              // espacio anterior, con el nombre del nuevo en el selector.
              setSeleccion(null);
              // Y el «Deshacer» tampoco cruza: apunta a una página que ya no está
              // en la lista que se ve.
              setArchivada(null);
            }}
          />

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
            {!deLink && seleccion?.tipo === 'nueva' && (
              <div className="rounded-lg border border-primary bg-secondary px-3 py-2">
                <span className="text-sm font-medium text-foreground">Página nueva</span>
                <p className="mt-0.5 text-xs text-muted-foreground">Se guarda sola al escribir</p>
              </div>
            )}

            {cargando && <p className="px-2 py-3 text-sm text-muted-foreground">Cargando…</p>}
            {fallo && <p className="px-2 py-3 text-sm text-destructive">No se pudieron traer tus páginas.</p>}
            {!cargando && !fallo && notas.length === 0 && (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {termino
                  ? 'Nada con ese término.'
                  : enSuLibretaPrivada
                    ? 'Todavía no escribiste nada acá.'
                    : // En un espacio, «no escribiste» sería falso: puede haber
                      // escrito cualquiera de los miembros, y no lo hizo nadie.
                      'Nadie escribió nada acá todavía.'}
              </p>
            )}

            {notas.map((n) => (
              <FilaPagina
                key={`${n.origen}-${n.id}`}
                nota={n}
                // En un espacio, quién la escribió — salvo si sos vos: «Vos» en
                // cada renglón propio sería el mismo ruido que en la libreta.
                // Es la misma regla que `canales/dueno.ts` en la fila de la cola.
                autora={
                  enSuLibretaPrivada || mismoUsuario(n.vendedoraId, vendedoraId) ? null : nombreCorto(n.vendedoraId)
                }
                activa={mismaSeleccion(seleccion, { tipo: 'nota', id: n.id, origen: n.origen })}
                onAbrir={() => setSeleccion({ tipo: 'nota', id: n.id, origen: n.origen })}
                onFijar={() => editar.mutate({ id: n.id, fijada: !n.fijada })}
                onArchivar={() => {
                  archivar.mutate(n.id);
                  // El camino de VUELTA. Lo pidió el review del PR #47 y el
                  // arreglo quedó en `PanelNotas`, el componente que ya no se
                  // monta: al pasar la Libreta al riel volvió a ser un clic sin
                  // retorno sobre algo que la vendedora escribió.
                  setArchivada({ id: n.id, titulo: tituloDeNota(n) || 'Sin título' });
                  if (seleccion?.tipo === 'nota' && seleccion.id === n.id) setSeleccion(null);
                }}
              />
            ))}
          </div>

          {/* DESHACER — al pie de la lista y no como toast flotante: la lista es
              donde la página desapareció, así que es donde se la busca. Se va
              sola en cuanto se archiva otra o se toca «Deshacer». */}
          {archivada && (
            <div className="m-2 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                Archivaste «{archivada.titulo}»
              </p>
              <button
                type="button"
                onClick={() => {
                  desarchivar.mutate(archivada.id);
                  setArchivada(null);
                }}
                className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Undo2 className="size-3.5" />
                Deshacer
              </button>
            </div>
          )}
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
          {deLink && (
            <ColumnaDeEscritura>
              <div className="mx-auto max-w-3xl px-6 pt-8">
                <div className="mb-4 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                  Llegaste por un link.{' '}
                  {porLink.data?.puedeEditar
                    ? 'Podés editarla, y queda registrado que fuiste vos.'
                    : 'Se lee, no se edita.'}
                </div>
              </div>
              <EditorPerezoso
                key={`link-${deLink.id}`}
                contenidoInicial={docParaEditor(deLink)}
                soloLectura={!porLink.data?.puedeEditar}
                onCambio={alCambiar}
                ribbon={{ tab: tabRibbon, onTab: setTabRibbon, vista }}
              />
            </ColumnaDeEscritura>
          )}

          {porLink.isError && (
            <div className="mx-auto max-w-3xl px-6 py-8">
              <p className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                Ese link ya no sirve. Pedile a quien te lo pasó que lo comparta de nuevo.
              </p>
            </div>
          )}

          {!deLink && !porLink.isError && enBienvenida && (
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

          {!deLink && !porLink.isError && seleccion === null && !enBienvenida && (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <Notebook className="size-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Elegí una página, o creá una nueva.</p>
              {/* ⚠️ «Es tuya, nadie más la ve» es VERDAD solo en la libreta
                  privada. Dicho adentro de un espacio del equipo sería la peor
                  mentira posible de este frente: la que hace escribir un precio
                  mal puesto creyendo que no lo lee nadie. Lo único que se dice
                  siempre es lo que vale en los dos lados (ADR 0012). */}
              <p className="max-w-xs text-xs text-muted-foreground/80">
                {enSuLibretaPrivada
                  ? 'Es tuya: nadie más del equipo la ve. De acá no sale ningún mensaje.'
                  : 'Lo de acá lo ve todo el espacio. De acá no sale ningún mensaje.'}
              </p>
            </div>
          )}

          {!deLink && seleccion?.tipo === 'nueva' && (
            <ColumnaDeEscritura>
              <EditorPerezoso
                key="nueva"
                contenidoInicial={undefined}
                soloLectura={false}
                onCambio={alCambiar}
                ribbon={{ tab: tabRibbon, onTab: setTabRibbon, vista }}
              />
            </ColumnaDeEscritura>
          )}

          {!deLink && paginaAbierta && (() => {
            // PANTALLA DIVIDIDA (17-ago-2026): solo una página editable puede
            // pedirla (`AccionesDePagina` ni se dibuja sobre una histórica), y
            // solo se abre por elección propia o porque ya venía persistida.
            const dividiendo =
              paginaAbierta.origen === 'nota' && (mostrarSelectorDivision || divididaId !== null);
            // Un diagrama arma su PROPIA barra de herramientas y necesita todo
            // el ancho, igual que en la pantalla dividida — el molde es el
            // mismo, y no es casualidad: es la MISMA regla, aplicada del otro
            // lado, para cuando un diagrama se abre acá directo (por
            // búsqueda, por «Mover», o al reabrirlo) y no solo desde el panel.
            const esDiagrama = paginaAbierta.origen === 'nota' && paginaAbierta.tipo === 'diagrama';
            // 🔴 LA COLUMNA ANGOSTA ES DE LAS ACCIONES, NUNCA DEL EDITOR. La
            // Ribbon vive adentro de `BlockNoteView` y tiene que cruzar el panel
            // como la de Word; el ancho del TEXTO lo pone `.bn-editor` en
            // `index.css`. Un `max-w-3xl` acá arriba volvería a encajonar la
            // barra — que es exactamente lo que se deshizo al traerla.
            const anchoDeAcciones = dividiendo ? 'px-6 pt-8' : 'mx-auto max-w-3xl px-6 pt-8';
            return (
              <div className={dividiendo ? 'flex flex-col items-stretch md:flex-row' : ''}>
                <div className={dividiendo ? 'min-w-0 md:w-1/2' : ''}>
                  <ColumnaDeEscritura>
                    {/* Mover, compartir y dividir van sobre una página GUARDADA y
                        editable: una histórica de `gestiones` no se puede mover (vive
                        en otra tabla) ni compartir, y una página en blanco todavía no
                        tiene id. */}
                    {paginaAbierta.origen === 'nota' && (
                      <div className={esDiagrama ? 'px-3 pt-3' : anchoDeAcciones}>
                        <AccionesDePagina
                          nota={paginaAbierta}
                          donde={donde}
                          espacios={espacios.data ?? []}
                          vendedoraId={vendedoraId}
                          onMover={(destino) => {
                            mover.mutate({ id: paginaAbierta.id, destino });
                            // La página se fue de esta lista: dejarla abierta mostraría —y
                            // autoguardaría— algo que ya no está acá.
                            setSeleccion(null);
                          }}
                          onAbrirLink={(v) => abrirLink.mutate({ id: paginaAbierta.id, ...v })}
                          onCortarLink={() => cortarLink.mutate(paginaAbierta.id)}
                          onTocarDividir={() => setMostrarSelectorDivision(true)}
                          onCortarDivision={() => {
                            cortarDivision.mutate(paginaAbierta.id);
                            setMostrarSelectorDivision(false);
                          }}
                        />
                      </div>
                    )}
                    {paginaAbierta.origen === 'gestion' && (
                      <div className={anchoDeAcciones}>
                        <p className="mb-4 rounded-lg border border-dashed border-border bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                          Esta quedó de una gestión vieja. Se lee, no se edita — la etapa de esa conversación se apoya en ella.
                        </p>
                      </div>
                    )}
                    {esDiagrama ? (
                      <DiagramaPerezoso
                        key={`${paginaAbierta.origen}-${paginaAbierta.id}`}
                        contenidoInicial={paginaAbierta.diagrama ?? undefined}
                        onCambio={(v) => alCambiar(v)}
                      />
                    ) : (
                      <EditorPerezoso
                        key={`${paginaAbierta.origen}-${paginaAbierta.id}`}
                        contenidoInicial={docParaEditor(paginaAbierta)}
                        soloLectura={paginaAbierta.origen === 'gestion'}
                        onCambio={alCambiar}
                        ribbon={{ tab: tabRibbon, onTab: setTabRibbon, vista }}
                      />
                    )}
                  </ColumnaDeEscritura>
                </div>

                {dividiendo && (
                  <div className="min-w-0 border-t border-border md:w-1/2 md:border-l md:border-t-0">
                    <PantallaDividida
                      key={paginaAbierta.id}
                      paginaIzquierdaId={paginaAbierta.id}
                      divididaId={divididaId}
                      notasDisponibles={notas}
                      mutaciones={{ crear, editar, dividir, crearDiagrama, autoguardarDiagrama }}
                      onCerrar={() => setMostrarSelectorDivision(false)}
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </main>
      </div>
    </section>
  );
}
