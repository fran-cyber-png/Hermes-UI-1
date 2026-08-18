import {
  AArrowDown,
  AArrowUp,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AudioLines,
  Baseline,
  BookOpen,
  Bold,
  CaseSensitive,
  ChevronDown,
  Circle,
  ClipboardPaste,
  Code,
  Copy,
  Eraser,
  GitCompare,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  History,
  Image,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListCollapse,
  ListOrdered,
  ListTodo,
  Maximize,
  MessageSquare,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Paintbrush,
  PanelLeft,
  Paperclip,
  Pencil,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Scissors,
  Shapes,
  Shrink,
  Smile,
  SpellCheck,
  SquareCode,
  StretchHorizontal,
  Strikethrough,
  SunMoon,
  Table,
  Underline,
  Undo2,
  Video,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

/**
 * LOS ÍCONOS DE LA RIBBON, EN UN MAPA Y NO EN EL JSX.
 *
 * El catálogo (`catalogo.ts`) es **puro y sin React**: no puede llevar un
 * componente adentro. Lleva el NOMBRE del ícono, y acá se traduce a la pieza de
 * `lucide-react` que usa el resto de la app.
 *
 * ⚠️ **Y por eso hay un test que los cruza** (`catalogo.test.ts`): un nombre mal
 * escrito no da error de compilación si el tipo fuera `string` — dibujaría un
 * hueco. Con `NombreDeIcono` derivado de este objeto, el compilador lo agarra
 * antes; el test cubre el caso de que alguien lo evada con un `as`.
 *
 * Es el mismo criterio de `DESCRIPCION_MOMENTO` en el catálogo de piezas:
 * agregar un valor sin darle su lectura **no compila**.
 */
export const ICONOS = {
  // Acceso rápido
  deshacer: Undo2,
  rehacer: Redo2,

  // Portapapeles
  cortar: Scissors,
  copiar: Copy,
  pegar: ClipboardPaste,
  pincel: Paintbrush,

  // Fuente
  aumentarTamano: AArrowUp,
  reducirTamano: AArrowDown,
  negrita: Bold,
  cursiva: Italic,
  subrayado: Underline,
  tachado: Strikethrough,
  codigo: Code,
  colorTexto: Baseline,
  resaltado: Highlighter,
  limpiarFormato: RemoveFormatting,

  // Párrafo
  vinetas: List,
  numeracion: ListOrdered,
  sangriaMas: IndentIncrease,
  sangriaMenos: IndentDecrease,
  alinearIzquierda: AlignLeft,
  centrar: AlignCenter,
  alinearDerecha: AlignRight,
  justificar: AlignJustify,

  // Estilos
  parrafo: Pilcrow,
  titulo1: Heading1,
  titulo2: Heading2,
  titulo3: Heading3,

  // Insertar
  tabla: Table,
  cita: Quote,
  bloqueDeCodigo: SquareCode,
  separador: Minus,
  tareas: ListTodo,
  desplegable: ListCollapse,
  enlace: Link,
  imagen: Image,
  video: Video,
  audio: AudioLines,
  archivo: Paperclip,
  emoji: Smile,

  // Dibujar
  seleccionar: MousePointer2,
  lapiz: Pencil,
  marcador: Highlighter,
  borrador: Eraser,
  grosor: Minus,
  colorTrazo: Circle,
  formas: Shapes,

  // Revisar
  ortografia: SpellCheck,
  contar: CaseSensitive,
  comentarios: MessageSquare,
  historial: History,
  comparar: GitCompare,

  // Vista
  acercar: ZoomIn,
  alejar: ZoomOut,
  zoomNormal: Maximize,
  anchoPagina: StretchHorizontal,
  modoLectura: BookOpen,
  mostrarLista: PanelLeft,
  contraer: Shrink,
  tema: SunMoon,

  // La cáscara
  mas: MoreHorizontal,
  desplegar: ChevronDown,
} as const;

export type NombreDeIcono = keyof typeof ICONOS;
