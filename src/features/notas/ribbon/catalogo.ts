import { BLOQUES_RETIRADOS, ESQUEMA_LIBRETA } from '../editor';
import type { NombreDeIcono } from './iconos';
import { TABS, type TabRibbon } from './tabs';

/**
 * EL CATÁLOGO DE LA RIBBON — qué hay en cada pestaña, y cuál de esas cosas ANDA.
 *
 * ══ POR QUÉ ESTO ES UN MÓDULO PURO Y NO JSX ═════════════════════════════════
 *
 * Es el molde de `panel/pestanas.ts` y de `ivi/presentacion.ts`: la regla vive
 * afuera del componente para poder interrogarla con un test. Un `switch` adentro
 * de un JSX no se puede preguntar «¿algún comando promete algo que no existe?».
 *
 * Y esa pregunta es LA pregunta de este frente. Una Ribbon de aplicación tiene
 * lugar para cinco pestañas y ~40 cajas, y la mayoría de lo que Word pone ahí
 * **no existe en la Libreta**. La tentación es dibujarlas igual «para que se vea
 * completo». Un botón que no hace nada es peor que la ausencia del botón: se
 * prueba, no pasa nada, y a partir de ahí toda la barra pierde crédito.
 *
 * ══ EL TIPO ES EL CANDADO ═══════════════════════════════════════════════════
 *
 * 🔴 **`futuro` NO SE PUEDE CONSTRUIR SIN MOTIVO** — es un campo requerido de la
 * variante. O sea que no hay forma de apagar una caja sin decir por qué, y ese
 * porqué es lo que termina en el `title` del botón deshabilitado. No es una
 * convención que alguien puede olvidar: no compila.
 *
 * `catalogo.test.ts` cubre lo que el tipo no puede: que nadie lo evada con un
 * `as`, y que los ids no se repitan.
 *
 * ══ 🔴 LO QUE SE DERIVA DEL ESQUEMA, NO SE ESCRIBE A MANO ═══════════════════
 *
 * Imagen, video, audio y archivo están apagados **porque `editor.ts` los sacó
 * del esquema**: sin `uploadFile` una página que sea sólo una imagen aplana a
 * cadena vacía y el server la rechaza por vacía. Esa lista ya existe
 * (`BLOQUES_RETIRADOS`) y acá se LEE.
 *
 * Escrita a mano, el día que los adjuntos existan de verdad el esquema los
 * volvería a traer y estas cuatro cajas seguirían apagadas — sin error, sin
 * test rojo, sin nadie que se entere. Es la forma de #37 aplicada a una lista
 * de dos elementos.
 */

/**
 * 🔴 El motivo es OBLIGATORIO en `futuro`. Ver el docblock de arriba: es lo
 * único que impide que la Ribbon se llene de botones mudos.
 */
export type EstadoComando = { tipo: 'real' } | { tipo: 'futuro'; motivo: string };

export interface Comando {
  /** La identidad. Es contra esto que la presentación cablea el control. */
  id: string;
  /** Lo que se lee debajo del ícono, y el `aria-label` del botón icon-only. */
  etiqueta: string;
  icono: NombreDeIcono;
  /** El atajo, si lo tiene. Va en el tooltip, nunca dibujado en el botón. */
  atajo?: string;
  estado: EstadoComando;
  /**
   * `true` = caja grande, de las que se ven primero. Se reserva para las pocas
   * que la vendedora usa todo el tiempo: llenar la Ribbon de cajas grandes es
   * lo mismo que no tener jerarquía.
   */
  destacado?: boolean;
}

export interface Grupo {
  id: string;
  /** El rótulo de abajo. Es lo que hace descubrible la Ribbon: no se esconde nunca. */
  etiqueta: string;
  /**
   * 1 = no se va de la barra por más angosta que quede.
   * 2 = cuando no entra, cae al desplegable «Más».
   */
  prioridad: 1 | 2;
  comandos: Comando[];
  /**
   * En qué índice arranca la segunda fila. Word apila dos: arriba lo que se
   * ELIGE (fuente, tamaño), abajo lo que se PRENDE (N K S̲). Sin el corte, el
   * grupo «Fuente» mide once cajas de ancho y empuja todo lo demás fuera de la
   * pantalla.
   */
  corte?: number;
  /**
   * Un renglón que se dibuja debajo del grupo cuando TODO él está apagado. Sin
   * esto, siete cajas grises no explican nada.
   */
  aviso?: string;
}

const real: EstadoComando = { tipo: 'real' };
const futuro = (motivo: string): EstadoComando => ({ tipo: 'futuro', motivo });

/**
 * DESHACER Y REHACER NO VIVEN EN NINGUNA PESTAÑA.
 *
 * Van en la fila de las pestañas, a la izquierda — la barra de acceso rápido de
 * Office. El motivo no es estético: metidos adentro de «Inicio», **desaparecen
 * al pasar a «Insertar»**, y deshacer es justo lo que se busca después de
 * insertar algo que no era.
 */
export const ACCESO_RAPIDO: readonly Comando[] = [
  { id: 'deshacer', etiqueta: 'Deshacer', icono: 'deshacer', atajo: 'Mod+Z', estado: real },
  { id: 'rehacer', etiqueta: 'Rehacer', icono: 'rehacer', atajo: 'Mod+Shift+Z', estado: real },
];

/** Lo que `editor.ts` sacó del esquema, indexado para preguntarle de a uno. */
const RETIRADOS = new Set<string>(BLOQUES_RETIRADOS);

const MOTIVO_ADJUNTOS =
  'Todavía no hay dónde guardar el archivo: una página que sea sólo un adjunto no se puede guardar';

/**
 * Un bloque de «Insertar» se ofrece si el esquema lo tiene, y se apaga si
 * `editor.ts` lo retiró. Nunca al revés, y nunca escrito a mano.
 */
function bloque(
  tipo: string,
  datos: { id: string; etiqueta: string; icono: NombreDeIcono; destacado?: boolean },
): Comando {
  const enElEsquema = tipo in ESQUEMA_LIBRETA.blockSchema;
  return {
    ...datos,
    estado: enElEsquema
      ? real
      : futuro(RETIRADOS.has(tipo) ? MOTIVO_ADJUNTOS : 'Este bloque no está en el esquema de la Libreta'),
  };
}

function gruposDeInicio(): Grupo[] {
  return [
    {
      id: 'portapapeles',
      etiqueta: 'Portapapeles',
      prioridad: 2,
      comandos: [
        {
          id: 'pegar',
          etiqueta: 'Pegar',
          icono: 'pegar',
          atajo: 'Mod+V',
          destacado: true,
          // 🔴 No es que falte hacerlo: el navegador NO deja leer el portapapeles
          // desde un clic sin permiso, y en Firefox no lo deja de ninguna forma.
          // El atajo sí anda siempre, así que lo que corresponde es decirlo.
          estado: futuro('Usá Mod+V: el navegador no deja pegar desde un botón'),
        },
        { id: 'cortar', etiqueta: 'Cortar', icono: 'cortar', atajo: 'Mod+X', estado: real },
        { id: 'copiar', etiqueta: 'Copiar', icono: 'copiar', atajo: 'Mod+C', estado: real },
        { id: 'copiarFormato', etiqueta: 'Copiar formato', icono: 'pincel', estado: real },
      ],
    },
    {
      id: 'fuente',
      etiqueta: 'Fuente',
      prioridad: 1,
      corte: 4,
      comandos: [
        { id: 'fuente', etiqueta: 'Fuente', icono: 'parrafo', estado: real },
        { id: 'tamano', etiqueta: 'Tamaño', icono: 'contar', estado: real },
        { id: 'aumentarTamano', etiqueta: 'Agrandar', icono: 'aumentarTamano', estado: real },
        { id: 'reducirTamano', etiqueta: 'Achicar', icono: 'reducirTamano', estado: real },
        { id: 'negrita', etiqueta: 'Negrita', icono: 'negrita', atajo: 'Mod+B', estado: real },
        { id: 'cursiva', etiqueta: 'Cursiva', icono: 'cursiva', atajo: 'Mod+I', estado: real },
        { id: 'subrayado', etiqueta: 'Subrayado', icono: 'subrayado', atajo: 'Mod+U', estado: real },
        { id: 'tachado', etiqueta: 'Tachado', icono: 'tachado', estado: real },
        { id: 'codigo', etiqueta: 'Código', icono: 'codigo', estado: real },
        // ⚠️ UNA sola caja para color de texto y resaltado: es lo que BlockNote
        // trae (`ColorStyleButton` abre las dos paletas en el mismo panel).
        // Partirlo en dos sería reimplementar su panel — la regla de #37.
        { id: 'colores', etiqueta: 'Colores', icono: 'colorTexto', estado: real },
        { id: 'limpiarFormato', etiqueta: 'Limpiar', icono: 'limpiarFormato', estado: real },
      ],
    },
    {
      id: 'parrafo',
      etiqueta: 'Párrafo',
      prioridad: 1,
      corte: 4,
      comandos: [
        { id: 'vinetas', etiqueta: 'Viñetas', icono: 'vinetas', estado: real },
        { id: 'numeracion', etiqueta: 'Numeración', icono: 'numeracion', estado: real },
        { id: 'reducirSangria', etiqueta: 'Menos sangría', icono: 'sangriaMenos', estado: real },
        { id: 'aumentarSangria', etiqueta: 'Más sangría', icono: 'sangriaMas', estado: real },
        { id: 'alinearIzquierda', etiqueta: 'Izquierda', icono: 'alinearIzquierda', estado: real },
        { id: 'centrar', etiqueta: 'Centrar', icono: 'centrar', estado: real },
        { id: 'alinearDerecha', etiqueta: 'Derecha', icono: 'alinearDerecha', estado: real },
        // `justify` ya está en el esquema de BlockNote (con ícono y traducción
        // al español): es gratis y faltaba.
        { id: 'justificar', etiqueta: 'Justificar', icono: 'justificar', estado: real },
      ],
    },
    {
      id: 'estilos',
      etiqueta: 'Estilos',
      prioridad: 2,
      comandos: [
        { id: 'estiloNormal', etiqueta: 'Normal', icono: 'parrafo', estado: real },
        { id: 'estiloTitulo1', etiqueta: 'Título 1', icono: 'titulo1', estado: real },
        { id: 'estiloTitulo2', etiqueta: 'Título 2', icono: 'titulo2', estado: real },
        { id: 'estiloTitulo3', etiqueta: 'Título 3', icono: 'titulo3', estado: real },
        { id: 'masEstilos', etiqueta: 'Más estilos', icono: 'desplegar', estado: real },
      ],
    },
  ];
}

function gruposDeInsertar(): Grupo[] {
  return [
    {
      id: 'tablas',
      etiqueta: 'Tablas',
      prioridad: 1,
      comandos: [bloque('table', { id: 'insertarTabla', etiqueta: 'Tabla', icono: 'tabla', destacado: true })],
    },
    {
      id: 'bloques',
      etiqueta: 'Bloques',
      prioridad: 1,
      corte: 3,
      comandos: [
        bloque('quote', { id: 'insertarCita', etiqueta: 'Cita', icono: 'cita' }),
        bloque('codeBlock', { id: 'insertarCodigo', etiqueta: 'Código', icono: 'bloqueDeCodigo' }),
        bloque('divider', { id: 'insertarSeparador', etiqueta: 'Separador', icono: 'separador' }),
        bloque('checkListItem', { id: 'insertarTareas', etiqueta: 'Tareas', icono: 'tareas' }),
        bloque('toggleListItem', { id: 'insertarDesplegable', etiqueta: 'Desplegable', icono: 'desplegable' }),
      ],
    },
    {
      id: 'vinculos',
      etiqueta: 'Vínculos',
      prioridad: 1,
      comandos: [{ id: 'enlace', etiqueta: 'Enlace', icono: 'enlace', atajo: 'Mod+K', estado: real }],
    },
    {
      id: 'multimedia',
      etiqueta: 'Multimedia',
      prioridad: 2,
      corte: 2,
      comandos: [
        bloque('image', { id: 'insertarImagen', etiqueta: 'Imagen', icono: 'imagen' }),
        bloque('video', { id: 'insertarVideo', etiqueta: 'Video', icono: 'video' }),
        bloque('audio', { id: 'insertarAudio', etiqueta: 'Audio', icono: 'audio' }),
        bloque('file', { id: 'insertarArchivo', etiqueta: 'Archivo', icono: 'archivo' }),
      ],
    },
    {
      id: 'simbolos',
      etiqueta: 'Símbolos',
      prioridad: 2,
      comandos: [
        {
          id: 'insertarEmoji',
          etiqueta: 'Emoji',
          icono: 'emoji',
          // 🔴 MEDIDO, no supuesto: el selector de emojis de BlockNote es un
          // `GridSuggestionMenuController` con `triggerCharacter=":"` y
          // **`minQueryLength={2}`**, así que no se abre hasta la tercera tecla.
          // Un botón que inserte `:` no abriría nada — dejaría dos puntos
          // sueltos en el texto y la sensación de que está roto.
          //
          // Apagado, el tooltip enseña el camino que SÍ existe, que es lo mismo
          // que hace «Pegar». Descubribilidad es justamente eso.
          estado: futuro('Escribí «:» y dos letras — por ejemplo «:so» para 😄'),
        },
      ],
    },
  ];
}

/**
 * DIBUJAR — la pestaña entera apagada, y a propósito.
 *
 * BlockNote no dibuja y en el repo no hay lienzo. Se dibuja igual, con los siete
 * grupos que tendría, porque la forma es la decisión: el día que exista un
 * canvas se enchufa acá y no hay que rediscutir dónde va cada herramienta.
 *
 * Lo que la hace honesta es el `aviso`: no son botones rotos, es una capacidad
 * que todavía no está.
 */
const MOTIVO_LIENZO = 'Todavía no hay lienzo para dibujar';

function gruposDeDibujar(): Grupo[] {
  return [
    {
      id: 'herramientas',
      etiqueta: 'Herramientas',
      prioridad: 1,
      corte: 2,
      aviso: 'Todavía no hay lienzo para dibujar. La Libreta escribe, no dibuja.',
      comandos: [
        { id: 'dibujarSeleccionar', etiqueta: 'Seleccionar', icono: 'seleccionar', estado: futuro(MOTIVO_LIENZO) },
        { id: 'dibujarLapiz', etiqueta: 'Lápiz', icono: 'lapiz', estado: futuro(MOTIVO_LIENZO) },
        { id: 'dibujarMarcador', etiqueta: 'Marcador', icono: 'marcador', estado: futuro(MOTIVO_LIENZO) },
        { id: 'dibujarBorrador', etiqueta: 'Borrador', icono: 'borrador', estado: futuro(MOTIVO_LIENZO) },
      ],
    },
    {
      id: 'trazo',
      etiqueta: 'Trazo',
      prioridad: 2,
      comandos: [
        { id: 'dibujarGrosor', etiqueta: 'Grosor', icono: 'grosor', estado: futuro(MOTIVO_LIENZO) },
        { id: 'dibujarColor', etiqueta: 'Color', icono: 'colorTrazo', estado: futuro(MOTIVO_LIENZO) },
      ],
    },
    {
      id: 'formas',
      etiqueta: 'Formas',
      prioridad: 2,
      comandos: [{ id: 'dibujarFormas', etiqueta: 'Formas', icono: 'formas', estado: futuro(MOTIVO_LIENZO) }],
    },
  ];
}

function gruposDeRevisar(): Grupo[] {
  return [
    {
      id: 'correccion',
      etiqueta: 'Corrección',
      prioridad: 1,
      comandos: [{ id: 'ortografia', etiqueta: 'Ortografía', icono: 'ortografia', destacado: true, estado: real }],
    },
    {
      id: 'medida',
      etiqueta: 'Medida',
      prioridad: 1,
      // No es un adorno: la página tiene un tope duro de 20.000 caracteres
      // (`notas.ts`), y hoy no hay forma de saber cuánto te queda hasta que el
      // server te lo rebota.
      comandos: [{ id: 'contarPalabras', etiqueta: 'Palabras', icono: 'contar', estado: real }],
    },
    {
      id: 'colaboracion',
      etiqueta: 'Colaboración',
      prioridad: 2,
      comandos: [
        {
          id: 'comentarios',
          etiqueta: 'Comentarios',
          icono: 'comentarios',
          estado: futuro('Necesita un almacén de hilos en el server'),
        },
        {
          id: 'historialVersiones',
          etiqueta: 'Historial',
          icono: 'historial',
          estado: futuro('La Libreta guarda una sola versión de cada página'),
        },
        {
          id: 'comparar',
          etiqueta: 'Comparar',
          icono: 'comparar',
          estado: futuro('Hace falta el historial de versiones primero'),
        },
      ],
    },
  ];
}

function gruposDeVista(): Grupo[] {
  return [
    {
      id: 'zoom',
      etiqueta: 'Zoom',
      prioridad: 1,
      comandos: [
        { id: 'alejar', etiqueta: 'Alejar', icono: 'alejar', estado: real },
        { id: 'zoomNormal', etiqueta: '100 %', icono: 'zoomNormal', estado: real },
        { id: 'acercar', etiqueta: 'Acercar', icono: 'acercar', estado: real },
      ],
    },
    {
      id: 'pagina',
      etiqueta: 'Página',
      prioridad: 1,
      comandos: [
        { id: 'anchoPagina', etiqueta: 'Ancho completo', icono: 'anchoPagina', estado: real },
        { id: 'modoLectura', etiqueta: 'Modo lectura', icono: 'modoLectura', destacado: true, estado: real },
      ],
    },
    {
      id: 'mostrar',
      etiqueta: 'Mostrar',
      prioridad: 2,
      comandos: [
        { id: 'mostrarLista', etiqueta: 'Lista de páginas', icono: 'mostrarLista', estado: real },
        { id: 'contraerRibbon', etiqueta: 'Contraer', icono: 'contraer', estado: real },
      ],
    },
    {
      id: 'apariencia',
      etiqueta: 'Apariencia',
      prioridad: 2,
      comandos: [
        {
          id: 'tema',
          etiqueta: 'Tema',
          icono: 'tema',
          estado: futuro('La Libreta está fijada en claro'),
        },
      ],
    },
  ];
}

/** Los grupos de una pestaña. Sólo se pide la activa: las otras no se montan. */
export function gruposDe(tab: TabRibbon): Grupo[] {
  switch (tab) {
    case 'inicio':
      return gruposDeInicio();
    case 'insertar':
      return gruposDeInsertar();
    case 'dibujar':
      return gruposDeDibujar();
    case 'revisar':
      return gruposDeRevisar();
    case 'vista':
      return gruposDeVista();
  }
}

/** Todo lo que la Ribbon ofrece, de una. Lo usan los tests y el overflow. */
export function todosLosComandos(): Comando[] {
  return [...ACCESO_RAPIDO, ...TABS.flatMap((t) => gruposDe(t.id).flatMap((g) => g.comandos))];
}
