import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeMouseHandler,
  type OnConnectEnd,
  type OnNodeDrag,
  type OnReconnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowRight,
  ArrowRightLeft,
  Clipboard,
  ClipboardCopy,
  Copy,
  Eraser,
  Grid3x3,
  Map as IconoMapa,
  Maximize,
  Minus,
  MousePointerClick,
  Network,
  Play,
  PlayCircle,
  Redo2,
  Route,
  Spline,
  Sparkles,
  Square,
  StopCircle,
  Trash2,
  Undo2,
  Waypoints,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { BordeDiagrama, type FormaDeLinea } from './BordeDiagrama';
import { ContextoDiagrama } from './contextoDiagrama';
import { nodoMasCercano, organizarConDagre } from './diagramaLayout';
import { LineaDeConexion } from './LineaDeConexion';
import { ModalEtiqueta } from './ModalEtiqueta';
import { NodoDiagrama } from './NodoDiagrama';

/**
 * EL EDITOR DE DIAGRAMAS — React Flow (17-ago-2026 · ampliado dos veces el
 * mismo día), la otra clase de página que puede vivir en la pantalla
 * dividida.
 *
 * ══ POR QUÉ ES OTRO COMPONENTE Y NO UN MODO DE `EditorDePagina` ═════════════
 *
 * BlockNote y React Flow no comparten una sola idea: uno edita prosa, el otro
 * un grafo. Forzarlos al mismo componente habría significado un editor con la
 * mitad de sus props sin sentido según el `tipo`.
 *
 * ══ QUÉ CUBRE, EN LOS TÉRMINOS DE reactflow.dev ═════════════════════════════
 *
 *   · **Nodos**: tres tipos (inicio/paso/fin — `NodoDiagrama.tsx`), cada uno
 *     con su Node Toolbar (duplicar/eliminar al seleccionar). Doble clic
 *     renombra. 🔴 El cuarto tipo, «grupo», se retiró el mismo día que nació
 *     — ver el porqué en `NodoDiagrama.tsx`.
 *   · **Bordes**: cuatro formas de línea, animados (opcional), con marcador
 *     elegible (ninguno/flecha/flecha rellena), etiqueta editable (doble
 *     clic), botón de borrar al seleccionar, y RECONECTABLES.
 *   · **Interacción**: selección múltiple (Mayús+arrastrar, nativo),
 *     copiar/pegar, deshacer/rehacer, Supr para borrar, menú contextual,
 *     agregar un nodo soltando una conexión en el vacío, y **conexión por
 *     proximidad**: arrastrar un nodo cerca de otro los resalta y, al
 *     soltar, los conecta solo — sin pasar por ninguna manija.
 *   · **Línea de conexión personalizada**: mientras se arrastra desde una
 *     manija (antes de soltar), se pinta distinto según si soltarla ahí
 *     formaría una conexión válida (`LineaDeConexion.tsx`).
 *   · **Árbol de Dagre + flujo horizontal**: un botón reacomoda todo el
 *     diagrama en árbol (`@dagrejs/dagre`), en vertical (de arriba hacia
 *     abajo) u horizontal (de izquierda a derecha) según el toggle — que
 *     también rota las manijas de los nodos para que el dibujo se lea de
 *     corrido en ese sentido.
 *   · **Flujo Turbo**: nodos con glow/gradiente, bordes con degradado
 *     animado (`#gradiente-turbo`, definido acá abajo).
 *   · **Borrador**: un modo que cambia el cursor y convierte el clic (o
 *     arrastre) sobre un nodo/borde en un borrado directo.
 *
 * Lo que NO trae, a propósito y por alcance: sub-flujos de verdad (nodos
 * HIJOS de otro, con `parentId`/`extent`) y detección de ciclos —
 * `isValidConnection` solo veta que un nodo se conecte consigo mismo.
 */

/** Los tres tipos de nodo apuntan al MISMO componente — decide por `type`. */
const TIPOS_DE_NODO = { inicio: NodoDiagrama, paso: NodoDiagrama, fin: NodoDiagrama };
/** Un solo tipo de borde registrado — decide la forma por `data.forma`. */
const TIPOS_DE_BORDE = { personalizado: BordeDiagrama };

const ETIQUETA_POR_TIPO: Record<string, string> = { inicio: 'Inicio', paso: 'Paso', fin: 'Fin' };

/** Una foto de nodos+bordes, para deshacer/rehacer. */
interface Instantanea {
  nodes: Node[];
  edges: Edge[];
}

const FORMAS: { forma: FormaDeLinea; titulo: string; icono: typeof Spline }[] = [
  { forma: 'curva', titulo: 'Línea curva', icono: Spline },
  { forma: 'recta', titulo: 'Línea recta', icono: Route },
  { forma: 'escalonSuave', titulo: 'Línea en escalón, con esquinas redondeadas', icono: Waypoints },
  { forma: 'escalon', titulo: 'Línea en escalón, esquinas rectas', icono: MousePointerClick },
];

type EstiloMarcador = 'ninguno' | 'flecha' | 'flechaRellena';
const MARCADORES: { valor: EstiloMarcador; titulo: string; icono: typeof Minus }[] = [
  { valor: 'ninguno', titulo: 'Conexiones sin marcador', icono: Minus },
  { valor: 'flecha', titulo: 'Conexiones con flecha abierta', icono: ArrowRight },
  { valor: 'flechaRellena', titulo: 'Conexiones con flecha rellena', icono: PlayCircle },
];

function BotonDeBarra({
  onClick,
  titulo,
  activo,
  deshabilitado,
  children,
}: {
  onClick: () => void;
  titulo: string;
  activo?: boolean;
  deshabilitado?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      aria-pressed={activo}
      disabled={deshabilitado}
      className={`flex size-7 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-30 ${
        activo
          ? 'border-primary bg-secondary text-foreground'
          : 'border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function Lienzo({
  contenidoInicial,
  onCambio,
}: {
  contenidoInicial: { nodes: unknown[]; edges: unknown[] } | undefined;
  onCambio: (v: { nodes: Node[]; edges: Edge[] }) => void;
}) {
  const [nodos, setNodos, alCambiarNodos] = useNodesState<Node>((contenidoInicial?.nodes as Node[] | undefined) ?? []);
  const [conexiones, setConexiones, alCambiarConexiones] = useEdgesState<Edge>(
    (contenidoInicial?.edges as Edge[] | undefined) ?? [],
  );
  const [conCuadricula, setConCuadricula] = useState(true);
  const [conMinimapa, setConMinimapa] = useState(true);
  const [turbo, setTurbo] = useState(false);
  const [borrador, setBorrador] = useState(false);
  const [formaDeLinea, setFormaDeLinea] = useState<FormaDeLinea>('curva');
  const [bordesAnimados, setBordesAnimados] = useState(false);
  const [estiloMarcador, setEstiloMarcador] = useState<EstiloMarcador>('flechaRellena');
  const [direccionFlujo, setDireccionFlujo] = useState<'vertical' | 'horizontal'>('vertical');
  const [menu, setMenu] = useState<{ x: number; y: number; nodoId?: string } | null>(null);
  /** El modal de renombrar — nodo o borde, el mismo estado para los dos. */
  const [renombrando, setRenombrando] = useState<{ tipo: 'nodo' | 'borde'; id: string; valor: string } | null>(null);
  const { zoomIn, zoomOut, fitView, screenToFlowPosition } = useReactFlow();
  const actualizarInternosDeNodo = useUpdateNodeInternals();

  /**
   * 🔴 EL BUG DEL FLUJO HORIZONTAL — «se estanca, hay que apretar varias
   * veces». La causa: `direccionFlujo` cambia el lado de las manijas de CADA
   * nodo (`Handle position={Top/Bottom}` ↔ `{Left/Right}`, adentro de
   * `NodoDiagrama.tsx`), pero React Flow no se entera de un cambio de lado
   * por su cuenta — solo remide un nodo cuando su TAMAÑO cambia (vía
   * `ResizeObserver`), y el lado de una manija no mueve un píxel el tamaño
   * del rectángulo. Sin avisarle, sigue dibujando los bordes contra la
   * posición VIEJA de la manija hasta que alguna otra cosa (mover un nodo a
   * mano, agregar uno nuevo) fuerza un remedido de refilón — de ahí el
   * "hay que apretar varias veces": cada clic de más tenía una chance de
   * coincidir con ese remedido accidental, no de arreglarlo por sí mismo.
   *
   * `useUpdateNodeInternals` es la puerta que la propia librería documenta
   * para esto exacto ("update a node's handle position, you need to let
   * React Flow know using this hook"). Se llama por TODOS los nodos cada vez
   * que `direccionFlujo` cambia, así el primer clic ya deja los bordes bien.
   */
  useEffect(() => {
    actualizarInternosDeNodo(nodos.map((n) => n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando CAMBIA la dirección, no en cada edición de `nodos`.
  }, [direccionFlujo]);

  /**
   * EL AVISO AL PADRE VIVE EN UN EFECTO, NO EN CADA HANDLER — y `onCambio` va
   * por REF, no en el array de dependencias. Con `onCambio` como dependencia
   * esto fue un LOOP INFINITO — cada guardado re-renderiza al padre, que crea
   * un `onCambio` nuevo, que vuelve a disparar el efecto.
   */
  const alAvisarRef = useRef(onCambio);
  alAvisarRef.current = onCambio;
  const primerRender = useRef(true);
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      return;
    }
    alAvisarRef.current({ nodes: nodos, edges: conexiones });
  }, [nodos, conexiones]);

  /**
   * EL PRÓXIMO ID — un contador, no un escaneo del array en cada alta. Hace
   * falta poder pedirlo ANTES de que el nodo exista de verdad (agregar un
   * nodo soltando una conexión necesita el id para armar el borde en el
   * MISMO movimiento). Arranca del máximo id que trajo el diagrama.
   */
  const proximoId = useRef(1);
  useEffect(() => {
    const existentes = (contenidoInicial?.nodes as Node[] | undefined) ?? [];
    const maximo = existentes.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0);
    proximoId.current = maximo + 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- una sola vez, al montar.
  }, []);
  const nuevoId = () => String(proximoId.current++);

  /** DESHACER / REHACER — una pila de instantáneas. `guardarHistorial` se llama ANTES de cada cambio. */
  const [pasado, setPasado] = useState<Instantanea[]>([]);
  const [futuro, setFuturo] = useState<Instantanea[]>([]);
  const TOPE_HISTORIAL = 50;
  const guardarHistorial = useCallback(() => {
    setPasado((p) => [...p.slice(-TOPE_HISTORIAL + 1), { nodes: nodos, edges: conexiones }]);
    setFuturo([]);
  }, [nodos, conexiones]);
  const deshacer = useCallback(() => {
    setPasado((p) => {
      if (p.length === 0) return p;
      const anterior = p[p.length - 1];
      setFuturo((f) => [...f, { nodes: nodos, edges: conexiones }]);
      setNodos(anterior.nodes);
      setConexiones(anterior.edges);
      return p.slice(0, -1);
    });
  }, [nodos, conexiones, setNodos, setConexiones]);
  const rehacer = useCallback(() => {
    setFuturo((f) => {
      if (f.length === 0) return f;
      const siguiente = f[f.length - 1];
      setPasado((p) => [...p, { nodes: nodos, edges: conexiones }]);
      setNodos(siguiente.nodes);
      setConexiones(siguiente.edges);
      return f.slice(0, -1);
    });
  }, [nodos, conexiones, setNodos, setConexiones]);

  const agregarNodo = (tipo: keyof typeof ETIQUETA_POR_TIPO, posicion?: { x: number; y: number }) => {
    guardarHistorial();
    const id = nuevoId();
    const nuevo: Node = {
      id,
      type: tipo,
      position: posicion ?? { x: 120 + Math.random() * 240, y: 80 + Math.random() * 200 },
      data: { label: ETIQUETA_POR_TIPO[tipo] },
    };
    setNodos([...nodos, nuevo]);
    return id;
  };

  const eliminarSeleccion = () => {
    guardarHistorial();
    const idsFuera = new Set(nodos.filter((n) => n.selected).map((n) => n.id));
    setNodos(nodos.filter((n) => !n.selected));
    setConexiones(conexiones.filter((c) => !c.selected && !idsFuera.has(c.source) && !idsFuera.has(c.target)));
  };

  const duplicarNodo = useCallback(
    (id: string) => {
      const original = nodos.find((n) => n.id === id);
      if (!original) return;
      guardarHistorial();
      const nuevo: Node = {
        ...original,
        id: nuevoId(),
        position: { x: original.position.x + 32, y: original.position.y + 32 },
        selected: true,
      };
      setNodos([...nodos.map((n) => ({ ...n, selected: false })), nuevo]);
    },
    [nodos, guardarHistorial, setNodos],
  );

  const eliminarNodo = useCallback(
    (id: string) => {
      guardarHistorial();
      setNodos(nodos.filter((n) => n.id !== id));
      setConexiones(conexiones.filter((c) => c.source !== id && c.target !== id));
    },
    [nodos, conexiones, guardarHistorial, setNodos, setConexiones],
  );

  // Doble clic en un nodo abre el modal para renombrar su etiqueta.
  const renombrarNodo = useCallback(
    (id: string) => {
      const actual = nodos.find((n) => n.id === id);
      if (!actual) return;
      setRenombrando({ tipo: 'nodo', id, valor: String(actual.data?.label ?? '') });
    },
    [nodos],
  );

  // Doble clic en un borde abre el modal para ponerle (o cambiarle) una etiqueta.
  const renombrarBorde = useCallback(
    (id: string) => {
      const actual = conexiones.find((c) => c.id === id);
      if (!actual) return;
      setRenombrando({ tipo: 'borde', id, valor: String((actual.data as { label?: string })?.label ?? '') });
    },
    [conexiones],
  );

  /** Confirmar el modal — aplica el cambio al nodo o al borde según corresponda. */
  const confirmarRenombre = useCallback(
    (valorNuevo: string) => {
      if (!renombrando) return;
      guardarHistorial();
      if (renombrando.tipo === 'nodo') {
        setNodos(nodos.map((n) => (n.id === renombrando.id ? { ...n, data: { ...n.data, label: valorNuevo } } : n)));
      } else {
        setConexiones(conexiones.map((c) => (c.id === renombrando.id ? { ...c, data: { ...c.data, label: valorNuevo || undefined } } : c)));
      }
      setRenombrando(null);
    },
    [renombrando, nodos, conexiones, guardarHistorial, setNodos, setConexiones],
  );

  const marcadorDeAhora = () => {
    if (estiloMarcador === 'ninguno') return undefined;
    return { type: estiloMarcador === 'flecha' ? MarkerType.Arrow : MarkerType.ArrowClosed };
  };

  const nuevoBorde = (origen: string, destino: string, params?: Partial<Connection>): Edge => ({
    id: `e${origen}-${destino}-${nuevoId()}`,
    source: origen,
    target: destino,
    sourceHandle: params?.sourceHandle ?? null,
    targetHandle: params?.targetHandle ?? null,
    type: 'personalizado',
    animated: bordesAnimados,
    markerEnd: marcadorDeAhora(),
    data: { forma: formaDeLinea },
  });

  const onConnect = useCallback(
    (conexion: Connection) => {
      guardarHistorial();
      setConexiones(addEdge(nuevoBorde(conexion.source, conexion.target, conexion), conexiones));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `nuevoBorde` lee estado por closure fresca en cada render.
    [conexiones, guardarHistorial, setConexiones, formaDeLinea, bordesAnimados, estiloMarcador],
  );

  /** Ni un nodo consigo mismo. La única validación de conexión de este editor. */
  const esConexionValida = useCallback((c: Connection | Edge) => c.source !== c.target, []);

  /**
   * AGREGAR UN NODO SOLTANDO LA CONEXIÓN EN EL VACÍO ("Add Node On Edge
   * Drop"). Si la conexión terminó sobre una manija de verdad, `onConnect`
   * ya la resolvió — acá solo entra la que terminó en el lienzo pelado.
   */
  const onConnectEnd: OnConnectEnd = useCallback(
    (evento, estado) => {
      if (estado.isValid || !estado.fromNode) return;
      const punto = 'changedTouches' in evento ? evento.changedTouches[0] : evento;
      const posicion = screenToFlowPosition({ x: punto.clientX, y: punto.clientY });
      guardarHistorial();
      const id = nuevoId();
      const nodo: Node = { id, type: 'paso', position: posicion, data: { label: ETIQUETA_POR_TIPO.paso } };
      const borde = nuevoBorde(estado.fromNode.id, id, { sourceHandle: estado.fromHandle?.id ?? null, targetHandle: null });
      setNodos((ns) => [...ns, nodo]);
      setConexiones((es) => [...es, borde]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [screenToFlowPosition, guardarHistorial, setNodos, setConexiones, formaDeLinea, bordesAnimados, estiloMarcador],
  );

  /**
   * CONEXIÓN POR PROXIMIDAD ("Proximity Connect"): mientras se arrastra un
   * nodo, el más cercano se resalta (`data.cercano`, lo lee `NodoDiagrama` —
   * es el «cambio de color» que avisa que soltar ahí conecta). Al soltar, si
   * seguía cerca y la conexión no existía ya, se crea sola.
   *
   * `guardarHistorial` NO se llama de nuevo en `onDragStop`: `onNodeDragStart`
   * ya sacó la foto de ANTES de mover nada, así que un solo «deshacer»
   * revierte el arrastre entero —posición y borde nuevo— como un solo gesto.
   */
  const onNodeDrag: OnNodeDrag = useCallback(
    (_e, arrastrado) => {
      const cercano = nodoMasCercano(arrastrado, nodos);
      setNodos((ns) =>
        ns.map((n) => {
          const marcar = Boolean(cercano) && (n.id === cercano?.source || n.id === cercano?.target);
          if (Boolean(n.data?.cercano) === marcar) return n;
          return { ...n, data: { ...n.data, cercano: marcar } };
        }),
      );
    },
    [nodos, setNodos],
  );
  const onNodeDragStop: OnNodeDrag = useCallback(
    (_e, arrastrado) => {
      const cercano = nodoMasCercano(arrastrado, nodos);
      setNodos((ns) => (ns.some((n) => n.data?.cercano) ? ns.map((n) => (n.data?.cercano ? { ...n, data: { ...n.data, cercano: false } } : n)) : ns));
      if (!cercano) return;
      const yaExiste = conexiones.some((c) => c.source === cercano.source && c.target === cercano.target);
      if (yaExiste) return;
      setConexiones((es) => [...es, nuevoBorde(cercano.source, cercano.target)]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodos, conexiones, setNodos, setConexiones, formaDeLinea, bordesAnimados, estiloMarcador],
  );

  /**
   * RECONECTAR UN BORDE + "Delete Edge on Drop": si al soltar la punta no
   * cayó sobre ninguna manija, el borde se borra en vez de quedar como
   * estaba.
   */
  const reconexionOk = useRef(true);
  const onReconnectStart = useCallback(() => {
    reconexionOk.current = false;
  }, []);
  const onReconnect: OnReconnect = useCallback(
    (bordeViejo, conexionNueva) => {
      reconexionOk.current = true;
      guardarHistorial();
      setConexiones((es) => reconnectEdge(bordeViejo, conexionNueva, es));
    },
    [guardarHistorial, setConexiones],
  );
  const onReconnectEnd = useCallback(
    (_evento: unknown, borde: Edge) => {
      if (!reconexionOk.current) {
        guardarHistorial();
        setConexiones((es) => es.filter((e) => e.id !== borde.id));
      }
      reconexionOk.current = true;
    },
    [guardarHistorial, setConexiones],
  );

  // ── MODO BORRADOR: un clic sobre un nodo/borde lo elimina directo ──
  const onNodeClick: NodeMouseHandler = useCallback(
    (_e, nodo) => {
      if (!borrador) return;
      eliminarNodo(nodo.id);
    },
    [borrador, eliminarNodo],
  );
  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_e, borde) => {
      if (!borrador) return;
      guardarHistorial();
      setConexiones((es) => es.filter((e) => e.id !== borde.id));
    },
    [borrador, guardarHistorial, setConexiones],
  );
  const onNodeMouseEnter: NodeMouseHandler = useCallback(
    (e, nodo) => {
      if (!borrador || e.buttons !== 1) return;
      eliminarNodo(nodo.id);
    },
    [borrador, eliminarNodo],
  );

  // ── MENÚ CONTEXTUAL (clic derecho) ──
  const onNodeContextMenu: NodeMouseHandler = useCallback((e, nodo) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, nodoId: nodo.id });
  }, []);
  const onPaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    setMenu({ x: (e as React.MouseEvent).clientX, y: (e as React.MouseEvent).clientY });
  }, []);

  // ── COPIAR / PEGAR / DESHACER / REHACER, por teclado ──
  const portapapeles = useRef<Instantanea | null>(null);
  const copiar = useCallback(() => {
    const nodosCopiados = nodos.filter((n) => n.selected);
    if (nodosCopiados.length === 0) return;
    const idsCopiados = new Set(nodosCopiados.map((n) => n.id));
    const bordesCopiados = conexiones.filter((c) => idsCopiados.has(c.source) && idsCopiados.has(c.target));
    portapapeles.current = { nodes: nodosCopiados, edges: bordesCopiados };
  }, [nodos, conexiones]);
  const pegar = useCallback(() => {
    const copia = portapapeles.current;
    if (!copia || copia.nodes.length === 0) return;
    guardarHistorial();
    const mapaIds = new Map<string, string>();
    const nodosPegados = copia.nodes.map((n) => {
      const id = nuevoId();
      mapaIds.set(n.id, id);
      return { ...n, id, position: { x: n.position.x + 40, y: n.position.y + 40 }, selected: true };
    });
    const bordesPegados = copia.edges.map((e) => ({
      ...e,
      id: `e${mapaIds.get(e.source)}-${mapaIds.get(e.target)}-${nuevoId()}`,
      source: mapaIds.get(e.source)!,
      target: mapaIds.get(e.target)!,
      selected: true,
    }));
    setNodos([...nodos.map((n) => ({ ...n, selected: false })), ...nodosPegados]);
    setConexiones([...conexiones.map((c) => ({ ...c, selected: false })), ...bordesPegados]);
  }, [nodos, conexiones, guardarHistorial, setNodos, setConexiones]);

  /** ÁRBOL DE DAGRE — reacomoda todo, en la dirección elegida en la barra. */
  const organizarEnArbol = () => {
    guardarHistorial();
    setNodos(organizarConDagre(nodos, conexiones, direccionFlujo === 'horizontal' ? 'LR' : 'TB'));
    // `fitView` necesita que React ya haya pintado las posiciones nuevas —
    // llamarlo en el mismo tick encuadra contra el layout VIEJO.
    window.setTimeout(() => fitView(), 0);
  };

  const manejarTecla = (e: React.KeyboardEvent) => {
    // Escribiendo en el modal de renombrar (u otro input futuro): ⌘C/⌘V/⌘Z
    // son del CAMPO DE TEXTO, no del lienzo — sin esta guarda, pegar una
    // etiqueta larga con ⌘V terminaba pegando la selección del diagrama en
    // vez del texto en el portapapeles del sistema operativo.
    const enUnCampo = (e.target as HTMLElement)?.closest('input, textarea');
    if (enUnCampo) return;
    const conMod = e.ctrlKey || e.metaKey;
    if (!conMod) return;
    const tecla = e.key.toLowerCase();
    if (tecla === 'c') {
      copiar();
    } else if (tecla === 'v') {
      pegar();
    } else if (tecla === 'z' && e.shiftKey) {
      rehacer();
    } else if (tecla === 'z') {
      deshacer();
    } else if (tecla === 'y') {
      rehacer();
    } else {
      return;
    }
    e.preventDefault();
  };

  return (
    <ContextoDiagrama.Provider value={{ turbo, borrador, direccionFlujo, duplicarNodo, eliminarNodo }}>
      <div onKeyDown={manejarTecla} onClick={() => setMenu(null)}>
        {/* LA BARRA DE HERRAMIENTAS. `flex-wrap` porque a 1/2 pantalla (donde
            vive esto, dividida) no entran en una sola línea sin apretarse. */}
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-3 py-2">
          <BotonDeBarra titulo="Nodo de inicio — por donde arranca el flujo" onClick={() => agregarNodo('inicio')}>
            <PlayCircle className="size-4" />
          </BotonDeBarra>
          <BotonDeBarra titulo="Nodo — un paso del flujo, con entrada y salida" onClick={() => agregarNodo('paso')}>
            <Square className="size-4" />
          </BotonDeBarra>
          <BotonDeBarra titulo="Nodo de fin — donde termina el flujo" onClick={() => agregarNodo('fin')}>
            <StopCircle className="size-4" />
          </BotonDeBarra>

          <span className="mx-1 h-5 w-px shrink-0 bg-border" />

          {FORMAS.map(({ forma, titulo, icono: Icono }) => (
            <BotonDeBarra key={forma} titulo={titulo} activo={formaDeLinea === forma} onClick={() => setFormaDeLinea(forma)}>
              <Icono className="size-4" />
            </BotonDeBarra>
          ))}
          <BotonDeBarra titulo="Bordes animados — las conexiones nuevas salen con rayado en movimiento" activo={bordesAnimados} onClick={() => setBordesAnimados((v) => !v)}>
            <Play className="size-4" />
          </BotonDeBarra>
          {MARCADORES.map(({ valor, titulo, icono: Icono }) => (
            <BotonDeBarra key={valor} titulo={titulo} activo={estiloMarcador === valor} onClick={() => setEstiloMarcador(valor)}>
              <Icono className="size-4" />
            </BotonDeBarra>
          ))}

          <span className="mx-1 h-5 w-px shrink-0 bg-border" />

          <BotonDeBarra titulo="Organizar en árbol (Dagre)" onClick={organizarEnArbol}>
            <Network className="size-4" />
          </BotonDeBarra>
          <BotonDeBarra
            titulo={direccionFlujo === 'horizontal' ? 'Flujo horizontal — cambiar a vertical' : 'Flujo vertical — cambiar a horizontal'}
            activo={direccionFlujo === 'horizontal'}
            onClick={() => setDireccionFlujo((v) => (v === 'horizontal' ? 'vertical' : 'horizontal'))}
          >
            <ArrowRightLeft className="size-4" />
          </BotonDeBarra>

          <span className="mx-1 h-5 w-px shrink-0 bg-border" />

          <BotonDeBarra titulo="Deshacer" deshabilitado={pasado.length === 0} onClick={deshacer}>
            <Undo2 className="size-4" />
          </BotonDeBarra>
          <BotonDeBarra titulo="Rehacer" deshabilitado={futuro.length === 0} onClick={rehacer}>
            <Redo2 className="size-4" />
          </BotonDeBarra>
          <BotonDeBarra titulo="Copiar la selección (⌘C)" onClick={copiar}>
            <ClipboardCopy className="size-4" />
          </BotonDeBarra>
          {/* Sin `deshabilitado`: `portapapeles` es un ref (no dispara render),
              y un `disabled` calculado de acá quedaría VIEJO un render entero
              — un botón `disabled` de verdad en el DOM no dispara `click()`. */}
          <BotonDeBarra titulo="Pegar (⌘V)" onClick={pegar}>
            <Clipboard className="size-4" />
          </BotonDeBarra>

          <span className="mx-1 h-5 w-px shrink-0 bg-border" />

          <BotonDeBarra titulo="Acercar" onClick={() => zoomIn()}>
            <ZoomIn className="size-4" />
          </BotonDeBarra>
          <BotonDeBarra titulo="Alejar" onClick={() => zoomOut()}>
            <ZoomOut className="size-4" />
          </BotonDeBarra>
          <BotonDeBarra titulo="Ajustar todo el diagrama a la pantalla" onClick={() => fitView()}>
            <Maximize className="size-4" />
          </BotonDeBarra>

          <span className="mx-1 h-5 w-px shrink-0 bg-border" />

          <BotonDeBarra titulo="Mostrar u ocultar la cuadrícula de fondo" activo={conCuadricula} onClick={() => setConCuadricula((v) => !v)}>
            <Grid3x3 className="size-4" />
          </BotonDeBarra>
          <BotonDeBarra titulo="Mostrar u ocultar el minimapa" activo={conMinimapa} onClick={() => setConMinimapa((v) => !v)}>
            <IconoMapa className="size-4" />
          </BotonDeBarra>

          <span className="mx-1 h-5 w-px shrink-0 bg-border" />

          <BotonDeBarra titulo="Modo Turbo — nodos con brillo y bordes con degradado animado" activo={turbo} onClick={() => setTurbo((v) => !v)}>
            <Sparkles className="size-4" />
          </BotonDeBarra>
          <BotonDeBarra
            titulo="Modo borrador — un clic (o arrastrar) sobre un nodo o conexión lo elimina"
            activo={borrador}
            onClick={() => setBorrador((v) => !v)}
          >
            <Eraser className="size-4" />
          </BotonDeBarra>
          <BotonDeBarra titulo="Duplicar la selección" onClick={() => nodos.filter((n) => n.selected).forEach((n) => duplicarNodo(n.id))}>
            <Copy className="size-4" />
          </BotonDeBarra>

          <span className="mx-1 h-5 w-px shrink-0 bg-border" />

          <BotonDeBarra titulo="Eliminar los nodos y conexiones seleccionados" onClick={eliminarSeleccion}>
            <Trash2 className="size-4" />
          </BotonDeBarra>
        </div>

        {/* EL LIENZO. Altura fija y no `flex-1`/`h-full`: React Flow necesita un
            contenedor con altura DEFINIDA para medir el viewport. */}
        <div className={`relative h-[560px] ${borrador ? 'cursor-crosshair' : ''}`}>
          {/* El degradado del modo Turbo se define UNA vez acá — `BordeDiagrama`
              lo referencia como `url(#gradiente-turbo)`. */}
          <svg width={0} height={0} className="absolute">
            <defs>
              <linearGradient id="gradiente-turbo" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#d946ef" />
                <stop offset="50%" stopColor="#0ea5e9" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
            </defs>
          </svg>

          <ReactFlow
            nodes={nodos}
            edges={conexiones}
            nodeTypes={TIPOS_DE_NODO}
            edgeTypes={TIPOS_DE_BORDE}
            connectionLineComponent={LineaDeConexion}
            isValidConnection={esConexionValida}
            onNodesChange={alCambiarNodos}
            onEdgesChange={alCambiarConexiones}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            onReconnectStart={onReconnectStart}
            onReconnect={onReconnect}
            onReconnectEnd={onReconnectEnd}
            onNodeDoubleClick={(_e, nodo) => renombrarNodo(nodo.id)}
            onEdgeDoubleClick={(_e, borde) => renombrarBorde(borde.id)}
            onNodeDragStart={guardarHistorial}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onEdgeClick={onEdgeClick}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeContextMenu={onNodeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            onPaneClick={() => setMenu(null)}
            onMoveStart={() => setMenu(null)}
            // `null` mientras el modal de renombrar está abierto: el nodo/borde
            // que se está editando sigue SELECCIONADO por detrás, y sin esto un
            // Backspace de más al borrar una letra podía dispararle el borrado
            // global del lienzo — se le iba el nombre Y el nodo de un tirón.
            deleteKeyCode={renombrando ? null : ['Backspace', 'Delete']}
            multiSelectionKeyCode={['Meta', 'Control']}
            fitView
          >
            {conCuadricula && <Background variant={BackgroundVariant.Dots} gap={16} size={1} />}
            <Controls showInteractive={false} />
            {conMinimapa && <MiniMap pannable zoomable />}
            {borrador && (
              <Panel position="top-center" className="!m-2 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
                Modo borrador — clic o arrastre sobre lo que querés borrar
              </Panel>
            )}
          </ReactFlow>

          {/* MENÚ CONTEXTUAL — clic derecho sobre un nodo o el lienzo. */}
          {menu && (
            <div
              role="menu"
              style={{ left: menu.x, top: menu.y }}
              className="fixed z-50 min-w-[9rem] rounded-lg border border-border bg-card p-1 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              {menu.nodoId ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      duplicarNodo(menu.nodoId!);
                      setMenu(null);
                    }}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
                  >
                    <Copy className="size-3.5" /> Duplicar
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      eliminarNodo(menu.nodoId!);
                      setMenu(null);
                    }}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3.5" /> Eliminar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    agregarNodo('paso', screenToFlowPosition({ x: menu.x, y: menu.y }));
                    setMenu(null);
                  }}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
                >
                  <Square className="size-3.5" /> Nodo nuevo acá
                </button>
              )}
            </div>
          )}

          {/* EL MODAL DE RENOMBRAR — nodo o borde, `role="dialog"` propio.
              Va ACÁ, adentro del `relative h-[560px]` del lienzo, no en el
              nivel de la vista: es lo que lo centra sobre EL DIAGRAMA (y no
              sobre la nota de al lado, si la pantalla está dividida) y lo
              que hace que `absolute inset-0` no se estire a toda la app. */}
          {renombrando && (
            <ModalEtiqueta
              titulo={renombrando.tipo === 'nodo' ? 'Texto del nodo' : 'Etiqueta de la conexión'}
              ayuda={renombrando.tipo === 'borde' ? 'Dejalo vacío para quitar la etiqueta.' : undefined}
              valorInicial={renombrando.valor}
              turbo={turbo}
              permiteVacio={renombrando.tipo === 'borde'}
              onGuardar={confirmarRenombre}
              onCancelar={() => setRenombrando(null)}
            />
          )}
        </div>
      </div>
    </ContextoDiagrama.Provider>
  );
}

export function DiagramaDePagina(props: {
  contenidoInicial: { nodes: unknown[]; edges: unknown[] } | undefined;
  onCambio: (v: { nodes: Node[]; edges: Edge[] }) => void;
}) {
  return (
    <ReactFlowProvider>
      <Lienzo {...props} />
    </ReactFlowProvider>
  );
}
