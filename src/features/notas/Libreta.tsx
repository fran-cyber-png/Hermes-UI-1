import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronLeft, Link2, Notebook, Pin, PinOff, Plus, Search, Trash2, Undo2 } from 'lucide-react';
import { BarraDeDibujo, GROSORES, PALETA, type Herramienta } from './dibujo/BarraDeDibujo';
import { CapaDeAnotaciones } from './dibujo/CapaDeAnotaciones';
import { SelectorDeColor } from './dibujo/SelectorDeColor';
import { useAnotaciones } from './dibujo/useAnotaciones';
import { CAPA_BASE, paraGuardar, type Figura } from './dibujo/figuras';
import {
  CAPAS_INICIALES,
  agregarCapa,
  borrarCapa,
  cambiarCapa,
  capasNecesarias,
  duplicarCapa,
  moverCapa,
  type Capa,
} from './dibujo/capas';
import { PanelDeCapas } from './dibujo/PanelDeCapas';
import { agregarReciente, leerRecientes } from './dibujo/coloresRecientes';
import { ModalDePlantillas } from './ModalDePlantillas';
import { AccionesDePagina } from './AccionesDePagina';
import { DiagramaPerezoso, EditorPerezoso, precargarDiagrama, precargarEditor } from './perezosos';
import { PantallaDividida } from './PantallaDividida';
import { mismoUsuario, nombreCorto, useEspacios, type DondeEstoy } from './espacios';
import { SelectorDeEspacio } from './SelectorDeEspacio';
import { tokenDeLaUrl, usePaginaPorLink } from './porLink';
import { renglonDeEstado } from './guardado';
import { useAutoguardado, type ContenidoDePagina } from './useAutoguardado';
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

/**
 * LA HOJA: el documento con su capa de anotaciones encima.
 *
 * ══ POR QUÉ ESTE ENVOLTORIO EXISTE ══════════════════════════════════════════
 *
 * Es el `relative` que le da a la capa su sistema de coordenadas. `absolute
 * inset-0` adentro de acá mide **exactamente el alto del contenido** —no el de
 * la ventana—, y es lo que hace que las anotaciones scrolleen pegadas al texto
 * sin una línea de código de scroll (ver `CapaDeAnotaciones`).
 *
 * También es el punto donde el texto y el dibujo se juntan y siguen separados:
 * el editor no sabe que hay una capa encima, y la capa no sabe qué dice el
 * texto. Lo único que comparten es este rectángulo.
 */
function Hoja({
  children,
  anotaciones,
  herramienta,
  color,
  grosor,
  opacidad,
  capaActiva,
  capas,
  pedirImagen,
  onSubiendo,
  onSalirDelDibujo,
}: {
  children: React.ReactNode;
  anotaciones: ReturnType<typeof useAnotaciones> | null;
  herramienta: Herramienta;
  color: string;
  grosor: number;
  opacidad: number;
  capaActiva: string;
  capas: Capa[];
  pedirImagen(abrir: (() => void) | null): void;
  onSubiendo(subiendo: boolean): void;
  onSalirDelDibujo(): void;
}) {
  return (
    <div className="relative mx-auto max-w-3xl px-6 py-8">
      {children}
      {anotaciones && (
        <CapaDeAnotaciones
          anotaciones={anotaciones}
          herramienta={herramienta}
          color={color}
          grosor={grosor}
          opacidad={opacidad}
          capaId={capaActiva}
          capas={capas}
          pedirImagen={pedirImagen}
          onSubiendo={onSubiendo}
          onSalirDelDibujo={onSalirDelDibujo}
        />
      )}
    </div>
  );
}

/**
 * LA ZONA DE TRABAJO: el documento que scrollea + la barra de la derecha.
 *
 * ══ POR QUÉ ES UN COMPONENTE APARTE Y VA CON `key` ══════════════════════════
 *
 * Porque acá viven las anotaciones de la página abierta, y **cambiar de página
 * tiene que empezarlas de cero**. Con la `key` puesta afuera, React remonta esto
 * al saltar de nota y el hook se resiembra solo — la misma técnica que ya usa
 * `EditorDePagina`, y por el mismo motivo: sin remontar, la capa seguiría
 * mostrando los círculos de la página anterior sobre el texto de la nueva, y el
 * primer trazo los guardaría todos en la página equivocada.
 *
 * También es lo que junta al documento con la barra sin que el editor sepa que
 * la barra existe: acá adentro son dos hermanos en una fila.
 */
function ZonaDeTrabajo({
  hoja,
  onGuardarAnotaciones,
  children,
}: {
  /**
   * La página abierta, o `null` cuando lo que se muestra no es un documento
   * (la bienvenida, «elegí una página», un link roto). Con `null` esto es un
   * contenedor con scroll y nada más: ni capa, ni barra.
   */
  hoja: { anotacionesIniciales: unknown; soloLectura: boolean } | null;
  onGuardarAnotaciones(figuras: Figura[]): void;
  children: React.ReactNode;
}) {
  const [herramienta, setHerramienta] = useState<Herramienta>('puntero');
  const [color, setColor] = useState<string>(PALETA[0]);
  const [grosor, setGrosor] = useState<number>(GROSORES[1]);
  const [opacidad, setOpacidad] = useState(1);
  const [capaActiva, setCapaActiva] = useState(CAPA_BASE);
  const [capas, setCapas] = useState<Capa[]>(CAPAS_INICIALES);
  const [panelDeCapas, setPanelDeCapas] = useState(false);
  const [selectorDeColor, setSelectorDeColor] = useState(false);
  /**
   * El color de antes de abrir el selector, para que «Cancelar» pueda volver.
   * Se toma al ABRIR y no en cada render: durante la vista previa `color` ya
   * cambió, y leerlo entonces devolvería el color previsualizado.
   */
  const [colorAlAbrir, setColorAlAbrir] = useState(PALETA[0] as string);
  const [recientes, setRecientes] = useState<string[]>(leerRecientes);
  const [subiendo, setSubiendo] = useState(false);
  /**
   * El abridor del buscador de archivos, que vive en la CAPA (ahí está el
   * `<input type="file">`, porque ahí se sabe dónde soltar la imagen) y lo
   * dispara un botón de la BARRA. Esto es el cable entre los dos hermanos.
   */
  const [abrirArchivo, setAbrirArchivo] = useState<{ abrir: () => void } | null>(null);
  /**
   * 🔴 `useCallback` y no una flecha suelta. La capa registra el abridor desde un
   * efecto que depende de esta función; con una identidad nueva en cada render,
   * el efecto vuelve a correr, vuelve a llamar a este `setState` con un objeto
   * NUEVO, y eso dispara otro render — un bucle infinito que cuelga la pestaña.
   */
  const registrarAbridor = useCallback(
    (abrir: (() => void) | null) => setAbrirArchivo(abrir ? { abrir } : null),
    [],
  );

  const anotaciones = useAnotaciones({
    iniciales: hoja?.anotacionesIniciales,
    onGuardar: onGuardarAnotaciones,
  });

  /**
   * ELEGIR UN COLOR HACE DOS COSAS DISTINTAS, y cuál depende de si hay algo
   * seleccionado. Es la convención de todo editor de dibujo:
   *
   *  · **Con figuras elegidas** las REPINTA — es lo que uno espera al marcar un
   *    trazo y tocar el rojo. Va como un solo paso de deshacer.
   *  · **Sin nada elegido** queda como el color del próximo trazo.
   *
   * En los dos casos el color pasa a «recientes»: la lista es de lo que se USÓ,
   * y usarlo para repintar cuenta igual que usarlo para dibujar.
   */
  /**
   * Las capas que la página necesita: las declaradas más una por cada `capaId`
   * huérfano de las figuras. Sin esto, una página guardada con figuras en una
   * capa que ya no existe las dejaría invisibles e inalcanzables.
   */
  const capasVivas = capasNecesarias(capas, anotaciones.figuras);

  /**
   * LA OPACIDAD HACE LO MISMO QUE EL COLOR, y antes no.
   *
   * Con objetos elegidos los atenúa; sin nada elegido queda para los próximos.
   * El deslizador solo guardaba el valor futuro, así que sobre una selección no
   * pasaba nada — se veía como un control roto.
   */
  const elegirOpacidad = (o: number) => {
    setOpacidad(o);
    anotaciones.opacarSeleccion(o);
  };

  /** Mientras se arrastra por el selector: se ve, pero no se anota. */
  const previsualizarColor = (c: string) => {
    setColor(c);
    anotaciones.pintarSeleccion(c);
  };

  /** Elegido de verdad (paleta, reciente o «Aceptar»): además va a la lista. */
  const elegirColor = (c: string) => {
    previsualizarColor(c);
    setRecientes(agregarReciente(c));
  };

  /**
   * ⚠️ Sobre una página de SOLO LECTURA las anotaciones **se ven pero no se
   * tocan**: la herramienta queda clavada en `puntero` y la barra no se dibuja.
   * Dejar la barra ahí sería ofrecer dibujar sobre una histórica de `gestiones`
   * — el trazo saldría en pantalla y no se guardaría nunca.
   */
  const puedeDibujar = hoja !== null && !hoja.soloLectura;
  const herramientaEfectiva: Herramienta = puedeDibujar ? herramienta : 'puntero';

  return (
    <div className="flex min-h-0 flex-1">
      {/* EL SCROLL ES DE ESTA COLUMNA, no de la fila: la barra tiene que quedarse
          quieta mientras la página se desplaza debajo. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {hoja ? (
          <Hoja
            anotaciones={anotaciones}
            herramienta={herramientaEfectiva}
            opacidad={opacidad}
            capaActiva={capaActiva}
            capas={capasVivas}
            color={color}
            grosor={grosor}
            pedirImagen={registrarAbridor}
            onSubiendo={setSubiendo}
            onSalirDelDibujo={() => setHerramienta('puntero')}
          >
            {children}
          </Hoja>
        ) : (
          children
        )}
      </div>

      {/*
        EL PANEL DE CAPAS, a la izquierda de la barra: es donde hay lugar. Se
        monta acá y no adentro de la barra para que su ancho no pelee con los
        48 px de la columna de botones.
      */}
      {puedeDibujar && panelDeCapas && (
        <div className="relative">
          <div className="absolute bottom-2 right-2 z-30">
            <PanelDeCapas
              capas={capasVivas}
              figuras={anotaciones.figuras}
              capaActiva={capaActiva}
              haySeleccion={anotaciones.seleccionadas.length > 0}
              onCapaActiva={setCapaActiva}
              onCambiarCapa={(id, cambios) => setCapas(cambiarCapa(capasVivas, id, cambios))}
              onRenombrar={(id, nombre) => setCapas(cambiarCapa(capasVivas, id, { nombre }))}
              onAgregar={() => {
                const r = agregarCapa(capasVivas, capaActiva);
                setCapas(r.capas);
                // La nueva queda activa: es lo que se espera al apretar «+».
                setCapaActiva(r.nueva.id);
              }}
              onDuplicar={(id) => {
                const r = duplicarCapa(capasVivas, anotaciones.figuras, id);
                if (!r) return;
                setCapas(r.capas);
                setCapaActiva(r.nueva.id);
                // Las copias van por el hook para que entren al historial: un
                // ⌘Z tiene que poder deshacer «dupliqué una capa».
                anotaciones.reemplazar(r.figuras);
              }}
              onBorrar={(id) => {
                const r = borrarCapa(capasVivas, anotaciones.figuras, id);
                if (!r) return;
                /**
                 * 🔴 SE PREGUNTA SOLO SI SE LLEVA ALGO. Un `confirm` sobre una
                 * capa vacía es una fricción que enseña a apretar «Aceptar» sin
                 * leer — y entonces el día que la capa tenga ocho objetos, la
                 * confirmación tampoco se lee.
                 */
                if (r.seLleva.length > 0) {
                  const cuantos = r.seLleva.length;
                  const ok = window.confirm(
                    `¿Eliminar esta capa?\n\nTambién se eliminan los ${cuantos} ${cuantos === 1 ? 'elemento' : 'elementos'} que contiene.`,
                  );
                  if (!ok) return;
                }
                setCapas(r.capas);
                if (capaActiva === id) setCapaActiva(r.activaNueva);
                anotaciones.reemplazar(
                  anotaciones.figuras.filter((f) => f.capaId !== id),
                  [],
                );
              }}
              onMover={(id, hacia) => setCapas(moverCapa(capasVivas, id, hacia))}
              onOrdenar={anotaciones.ordenarSeleccion}
            />
          </div>
        </div>
      )}

      {/*
        EL SELECTOR AVANZADO. Fuera de la barra, por el mismo motivo que el panel
        de capas: la barra scrollea (`overflow-y-auto`) y recorta todo lo que se
        posicione fuera de su caja. Adentro se montaba y no se veía.
      */}
      {puedeDibujar && selectorDeColor && (
        <div className="relative">
          <div className="absolute bottom-2 right-2 z-40">
            <SelectorDeColor
              inicial={colorAlAbrir}
              onVistaPrevia={previsualizarColor}
              onCancelar={() => setSelectorDeColor(false)}
              onAceptar={(c) => {
                elegirColor(c);
                setSelectorDeColor(false);
              }}
            />
          </div>
        </div>
      )}

      {puedeDibujar && (
        <BarraDeDibujo
          herramienta={herramienta}
          color={color}
          grosor={grosor}
          opacidad={opacidad}
          recientes={recientes}
          capasAbiertas={panelDeCapas}
          selectorAbierto={selectorDeColor}
          puedeDeshacer={anotaciones.puedeDeshacer}
          puedeRehacer={anotaciones.puedeRehacer}
          hayAlgo={anotaciones.hayAlgo}
          hayImagenSubiendo={subiendo}
          onHerramienta={setHerramienta}
          onColor={elegirColor}
          onGrosor={setGrosor}
          onOpacidad={elegirOpacidad}
          onCapas={() => setPanelDeCapas((v) => !v)}
          onSelector={() => {
            // Al abrir se recuerda el color actual: es lo que «Cancelar» restaura.
            if (!selectorDeColor) setColorAlAbrir(color);
            setSelectorDeColor((v) => !v);
          }}
          onImagen={() => abrirArchivo?.abrir()}
          onDeshacer={anotaciones.deshacer}
          onRehacer={anotaciones.rehacer}
          onLimpiar={anotaciones.limpiar}
        />
      )}
    </div>
  );
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
   * EL MODAL DE PLANTILLAS VIVE ACÁ Y NO ADENTRO DE `EditorDePagina`
   * (ver su docblock): esta página del componente NO se remonta al crear la
   * primera página, así que el modal sobrevive esa transición. Lo que SÍ
   * cambia con cada remonte es CÓMO pegar —la instancia de `editor` es otra—,
   * y por eso viaja por una `ref` que la página activa se encarga de mantener
   * al día (`registrarPegado`, más abajo).
   */
  const [plantillasAbierto, setPlantillasAbierto] = useState(false);
  const pegarPlantillaRef = useRef<((texto: string) => void) | null>(null);
  const abrirPlantillas = useCallback(() => setPlantillasAbierto(true), []);
  const registrarPegado = useCallback((fn: ((texto: string) => void) | null) => {
    pegarPlantillaRef.current = fn;
  }, []);

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
        paginaAbierta?.tipo === 'diagrama' ? autoguardarDiagrama.mutateAsync({ id: v.id, diagrama: v.diagrama }) : autoguardar.mutateAsync(v),
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

  /**
   * QUÉ PÁGINA ESTÁ EN LA HOJA. Es la `key` de la zona de trabajo —remonta las
   * anotaciones al saltar de nota— y la misma que ya usa cada `EditorDePagina`.
   */
  const claveDePagina = deLink
    ? `link-${deLink.id}`
    : seleccion === null
      ? 'ninguna'
      : seleccion.tipo === 'nueva'
        ? 'nueva'
        : `${seleccion.origen}-${seleccion.id}`;

  /**
   * LA HOJA ABIERTA, o `null` cuando lo que se muestra no es un documento.
   *
   * Decide tres cosas de una sola vez: si hay capa de anotaciones, si hay barra
   * a la derecha, y con qué se siembra la capa. Tenerlo en UN lugar es lo que
   * impide que «se ve la barra» y «se puede guardar» se contesten distinto —
   * ofrecer dibujar sobre algo que no se guarda es la peor de las dos.
   */
  const hoja: { anotacionesIniciales: unknown; soloLectura: boolean } | null = deLink
    ? { anotacionesIniciales: deLink.anotaciones, soloLectura: !porLink.data?.puedeEditar }
    : seleccion?.tipo === 'nueva'
      ? { anotacionesIniciales: null, soloLectura: false }
      : paginaAbierta
        ? {
            anotacionesIniciales: paginaAbierta.anotaciones,
            // Una histórica de `gestiones` se lee y no se edita — tampoco se anota.
            soloLectura: paginaAbierta.origen === 'gestion',
          }
        : null;

  /**
   * LO ÚLTIMO QUE SE SABE DE LA PÁGINA ABIERTA — el documento y la capa.
   *
   * ══ POR QUÉ HACE FALTA ESTE PAR DE REFERENCIAS ══════════════════════════════
   *
   * El texto y el dibujo cambian por caminos distintos (el editor y la capa) y
   * ninguno de los dos conoce al otro, pero el guardado es UNO. Sin esto, el
   * PATCH que sale al dibujar llevaría solo `anotaciones` y el que sale al
   * teclear solo `doc`; funciona —el server trata la ausencia como «no lo
   * toques»— **hasta la página nueva**: ahí el primer guardado es un POST, y si
   * el primer gesto fue dibujar, la página nacería sin el texto que ya se había
   * escrito en el mismo segundo.
   *
   * ⚠️ Se vacían al CAMBIAR DE PÁGINA, en el render y no en un efecto: un efecto
   * corre después de pintar, y un trazo hecho en ese hueco mandaría el `doc` de
   * la página anterior sobre la nueva. Es la misma técnica que `useAutoguardado`
   * usa para resetear su estado.
   */
  const contenido = useRef<ContenidoDePagina>({});
  const clavePreviaDeHoja = useRef(claveDePagina);
  if (clavePreviaDeHoja.current !== claveDePagina) {
    clavePreviaDeHoja.current = claveDePagina;
    contenido.current = {};
  }

  const alCambiarDoc = (doc: unknown) => {
    contenido.current.doc = doc;
    alCambiar({ ...contenido.current });
  };

  /**
   * EL DIAGRAMA va por su propia clave del sobre y NO por `doc`: una página de
   * diagrama no tiene BlockNote, y mandarlo como `doc` haría que `aTextoPlano`
   * lo lea como `""` y `validarTexto` rechace el guardado entero. Ver el
   * docblock de `notas.diagrama` en el schema.
   */
  const alCambiarDiagrama = (diagrama: unknown) => {
    contenido.current.diagrama = diagrama;
    alCambiar({ ...contenido.current });
  };

  const alCambiarAnotaciones = (figuras: Figura[]) => {
    // `paraGuardar` redondea las coordenadas: es lo que baja el JSON a la mitad
    // y decide si una página muy anotada entra en el tope.
    contenido.current.anotaciones = paraGuardar(figuras);
    alCambiar({ ...contenido.current });
  };

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
            (enBienvenida ? 'hidden' : seleccion === null ? 'flex md:flex' : 'hidden md:flex')
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
          className={`flex min-h-0 flex-1 flex-col md:flex ${
            seleccion === null && !enBienvenida ? 'hidden' : 'flex'
          }`}
        >
          {/* La vuelta a la lista, solo en teléfono: en desktop la lista nunca se fue. */}
          {seleccion !== null && (
            <button
              type="button"
              onClick={() => setSeleccion(null)}
              className="flex shrink-0 items-center gap-1 px-4 pt-3 text-sm text-muted-foreground hover:text-foreground md:hidden"
            >
              <ChevronLeft className="size-4" />
              Tus páginas
            </button>
          )}

          {/*
            LA ZONA DE TRABAJO envuelve TODAS las ramas y no solo las del editor:
            se excluyen solas (cada una tiene su condición) y así la capa y la
            barra se montan en un único lugar. Con un envoltorio por rama, las
            tres tendrían que acordarse de pasarle lo mismo.

            La `key` es lo que remonta las anotaciones al cambiar de página.
          */}
          <ZonaDeTrabajo key={claveDePagina} hoja={hoja} onGuardarAnotaciones={alCambiarAnotaciones}>
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
                onCambio={alCambiarDoc}
                onAbrirPlantillas={abrirPlantillas}
                registrarPegado={registrarPegado}
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
                onCambio={alCambiarDoc}
                onAbrirPlantillas={abrirPlantillas}
                registrarPegado={registrarPegado}
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
                        onCambio={alCambiarDiagrama}
                      />
                    ) : (
                      <EditorPerezoso
                        key={`${paginaAbierta.origen}-${paginaAbierta.id}`}
                        contenidoInicial={docParaEditor(paginaAbierta)}
                        soloLectura={paginaAbierta.origen === 'gestion'}
                        onCambio={alCambiarDoc}
                        onAbrirPlantillas={abrirPlantillas}
                        registrarPegado={registrarPegado}
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
          </ZonaDeTrabajo>
        </main>
      </div>

      {/* Acá y no adentro de `EditorDePagina`: ver el docblock de `abrirPlantillas`. */}
      {plantillasAbierto && (
        <ModalDePlantillas
          onCerrar={() => setPlantillasAbierto(false)}
          onElegir={(texto) => {
            pegarPlantillaRef.current?.(texto);
            setPlantillasAbierto(false);
          }}
        />
      )}
    </section>
  );
}
