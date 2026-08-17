import { useState } from 'react';
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Highlighter,
  Image as IconoImagen,
  Layers,
  Minus,
  MousePointer2,
  Pencil,
  Pipette,
  Redo2,
  Sparkles,
  Square,
  TextCursor,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { SelectorDeColor } from './SelectorDeColor';
import type { ClaseDeDosPuntos } from './figuras';

/**
 * LA BARRA DE ANOTACIONES — vertical, sobre el borde derecho de la Libreta.
 *
 * ══ LA PRIMERA HERRAMIENTA ES «NO DIBUJAR», Y ESO NO ES UN DETALLE ══════════
 *
 * `puntero` es el modo por defecto y el que devuelve la página a ser un editor
 * de texto: con él activo la capa transparente no intercepta un solo clic y la
 * Libreta se comporta exactamente como antes de que esto existiera.
 *
 * Está PRIMERO y separado del resto por un corte, porque es la salida. Una capa
 * de dibujo sin una forma evidente de apagarla convierte un editor de texto en
 * una pizarra de la que no se puede salir — y el texto es lo principal acá.
 *
 * ══ POR QUÉ AL COSTADO Y A LA DERECHA ═══════════════════════════════════════
 *
 * Una cinta horizontal arriba (la de Paint) come alto de una hoja que se lee
 * scrolleando. Al costado gasta ancho, que es lo que sobra. Y a la derecha
 * porque a la izquierda ya están el riel de la app y la lista de páginas: una
 * tercera columna de muebles de ese lado empuja el texto y lo deja descentrado.
 *
 * ══ ESTE COMPONENTE NO SABE DIBUJAR ═════════════════════════════════════════
 *
 * Es presentacional: recibe qué está elegido y avisa qué se tocó. El trazo, el
 * borrador y la pila de deshacer viven en `CapaDeAnotaciones` y `useAnotaciones`,
 * y la geometría en `figuras.ts`. Lo único que tiene de estado propio es si el
 * popup del selector está abierto, que no le importa a nadie más.
 */

export type Herramienta =
  /** Modo texto: la capa deja pasar todo y la Libreta se edita como siempre. */
  | 'puntero'
  /** Agarrar una o varias anotaciones para moverlas, redimensionarlas o borrarlas. */
  | 'seleccion'
  | 'lapiz'
  | 'resaltador'
  | 'borrador'
  /** Escribir un rótulo pintado en el canvas (lo previo a las cajas). */
  | 'rotulo'
  /** Crear una CAJA de texto flotante: texto real, editable y movible. */
  | 'caja'
  | ClaseDeDosPuntos;

/**
 * ¿Con esta herramienta la capa tiene que capturar el puntero?
 *
 * Devuelve un PREDICADO de tipo y no un `boolean` para que el estrechamiento
 * viaje: en la capa, un `if (!activa) return` deja demostrado que más abajo la
 * herramienta ya no puede ser `puntero`, y el compilador acepta usarla como
 * clase de figura sin un `as`.
 */
export function dibujaAlgo(h: Herramienta): h is Exclude<Herramienta, 'puntero'> {
  return h !== 'puntero';
}

/**
 * LA PALETA RÁPIDA. Doce colores y ni uno más: es la diferencia entre elegir de
 * un vistazo y ponerse a buscar. Lo que falte sale del selector avanzado, que
 * está al lado — esto NO se recorta por eso, es el camino corto.
 */
export const PALETA = [
  '#111827', // negro
  '#6b7280', // gris
  '#ef4444', // rojo
  '#f97316', // naranja
  '#eab308', // amarillo
  '#22c55e', // verde
  '#14b8a6', // agua
  '#3b82f6', // azul
  '#8b5cf6', // violeta
  '#ec4899', // rosa
  '#92400e', // marrón
  '#ffffff', // blanco
] as const;

/** Los cuatro grosores, en píxeles del documento. El 3 arranca elegido. */
export const GROSORES = [2, 3, 6, 12] as const;

type Entrada = { id: Herramienta; rotulo: string; Icono: typeof Pencil };

/** El modo texto va aparte de todo: es la salida, no una herramienta más. */
const SALIDA: Entrada = { id: 'puntero', rotulo: 'Escribir (modo texto)', Icono: TextCursor };

/** PINCELES: los dos tipos de trazo a mano alzada. */
const PINCELES: Entrada[] = [
  { id: 'lapiz', rotulo: 'Lápiz', Icono: Pencil },
  { id: 'resaltador', rotulo: 'Resaltador', Icono: Highlighter },
];

/** HERRAMIENTAS: lo que no dibuja una figura nueva o la saca. */
const UTILES: Entrada[] = [{ id: 'borrador', rotulo: 'Borrador', Icono: Eraser }];

/** TEXTO: la caja flotante. El `rotulo` pintado queda para las notas viejas. */
/**
 * ⚠️ El rótulo del BOTÓN no puede ser igual al del GRUPO que lo envuelve
 * («Texto»): un `aria-label` repetido hace que buscar el control encuentre el
 * contenedor, que no responde a un clic. Le pasa a quien navega con lector de
 * pantalla igual que a un test.
 */
const TEXTO: Entrada = { id: 'caja', rotulo: 'Texto (caja flotante)', Icono: Type };

const FORMAS: Entrada[] = [
  { id: 'linea', rotulo: 'Línea', Icono: Minus },
  { id: 'flecha', rotulo: 'Flecha', Icono: ArrowUpRight },
  { id: 'rectangulo', rotulo: 'Rectángulo', Icono: Square },
  { id: 'elipse', rotulo: 'Elipse', Icono: Circle },
];

const SELECCION: Entrada = { id: 'seleccion', rotulo: 'Seleccionar y mover', Icono: MousePointer2 };

function Boton({
  activo,
  rotulo,
  onClick,
  children,
  deshabilitado,
}: {
  activo?: boolean;
  rotulo: string;
  onClick: () => void;
  children: React.ReactNode;
  deshabilitado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={deshabilitado}
      title={rotulo}
      aria-label={rotulo}
      // `aria-pressed` y no solo el color: quién está elegido tiene que poder
      // saberse sin ver el fondo — es lo mismo que hace el riel de la app.
      aria-pressed={activo}
      className={
        'flex size-8 items-center justify-center rounded-lg border transition disabled:opacity-30 ' +
        (activo
          ? 'border-primary bg-secondary text-primary'
          : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground')
      }
    >
      {children}
    </button>
  );
}

/** Una pastilla de color de la paleta o de los recientes. */
function Pastilla({ color, elegido, onClick }: { color: string; elegido: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={color}
      aria-label={`Color ${color}`}
      aria-pressed={elegido}
      className={
        'size-3.5 rounded-full border transition ' +
        // El elegido se marca con un anillo por AFUERA y no cambiándole el
        // borde: sobre el blanco de la paleta, un borde de color sería
        // indistinguible del que ya tiene para poder verse.
        (elegido ? 'border-foreground ring-2 ring-primary ring-offset-1' : 'border-border')
      }
      style={{ backgroundColor: color }}
    />
  );
}

/** El separador entre grupos. Un `<hr>` de verdad, no un div con borde. */
function Corte() {
  return <hr className="my-1 w-full border-t border-border" />;
}

export function BarraDeDibujo({
  herramienta,
  color,
  grosor,
  opacidad,
  recientes,
  capasAbiertas,
  puedeDeshacer,
  puedeRehacer,
  hayAlgo,
  hayImagenSubiendo,
  onHerramienta,
  onColor,
  onGrosor,
  onOpacidad,
  onCapas,
  onImagen,
  onDeshacer,
  onRehacer,
  onLimpiar,
}: {
  herramienta: Herramienta;
  color: string;
  grosor: number;
  /** 0–1. */
  opacidad: number;
  /** Los últimos colores propios. Vacío = todavía no se usó ninguno. */
  recientes: string[];
  capasAbiertas: boolean;
  puedeDeshacer: boolean;
  puedeRehacer: boolean;
  hayAlgo: boolean;
  hayImagenSubiendo: boolean;
  onHerramienta: (h: Herramienta) => void;
  onColor: (c: string) => void;
  onGrosor: (g: number) => void;
  onOpacidad: (o: number) => void;
  onCapas: () => void;
  /** Abre el buscador de archivos. La subida la maneja la capa. */
  onImagen: () => void;
  onDeshacer: () => void;
  onRehacer: () => void;
  onLimpiar: () => void;
}) {
  const [abierto, setAbierto] = useState(false);

  const boton = ({ id, rotulo, Icono }: Entrada) => (
    <Boton key={id} activo={herramienta === id} rotulo={rotulo} onClick={() => onHerramienta(id)}>
      <Icono className="size-4" />
    </Boton>
  );

  return (
    <div
      // `relative` porque el popup del selector se ancla acá.
      className="relative flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-l border-border bg-card px-2 py-2"
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Herramientas de anotación"
    >
      {boton(SALIDA)}

      <Corte />

      {/* SELECCIÓN va arriba de todo lo que crea: es con lo que se vuelve a
          tocar lo ya dibujado, y la que más se alterna con el modo texto. */}
      <div role="group" aria-label="Selección" className="contents">
        {boton(SELECCION)}
      </div>

      <div role="group" aria-label="Imagen" className="contents">
        {/* IMAGEN no es una herramienta con modo: es una ACCIÓN. Al tocarla se
            abre el buscador de archivos y la imagen entra ya seleccionada — no
            hay un estado «insertando imágenes» en el que quedarse. */}
        <Boton rotulo="Insertar imagen" onClick={onImagen} deshabilitado={hayImagenSubiendo}>
          <IconoImagen className={`size-4 ${hayImagenSubiendo ? 'animate-pulse' : ''}`} />
        </Boton>
      </div>

      <div role="group" aria-label="Texto" className="contents">
        {boton(TEXTO)}
      </div>

      <Corte />

      <div role="group" aria-label="Pinceles" className="contents">
        {PINCELES.map(boton)}
      </div>

      <div role="group" aria-label="Herramientas" className="contents">
        {UTILES.map(boton)}
      </div>

      <Corte />

      <div role="group" aria-label="Formas" className="contents">
        {FORMAS.map(boton)}
      </div>

      <Corte />

      {/* EL GROSOR se muestra como lo que hace: una barrita del ancho que va a
          tener el trazo. Un número («2», «6») obliga a traducir mentalmente. */}
      {GROSORES.map((g) => (
        <Boton key={g} activo={grosor === g} rotulo={`Grosor ${g}`} onClick={() => onGrosor(g)}>
          <span
            className="block w-4 rounded-full bg-current"
            // El alto sale del dato, no de una clase: son los mismos números que
            // van al `lineWidth`, así que la muestra no puede mentir sobre el
            // trazo. Se recorta a 2 px o el más fino no se vería.
            style={{ height: `${Math.max(2, g / 2)}px` }}
          />
        </Boton>
      ))}

      <Corte />

      {/* LOS COLORES, de a dos por fila: la barra tiene 12 de ancho útil y una
          sola columna dejaría la paleta más alta que la pantalla. */}
      <div className="grid grid-cols-2 gap-1" aria-label="Colores" role="group">
        {PALETA.map((c) => (
          <Pastilla key={c} color={c} elegido={color === c} onClick={() => onColor(c)} />
        ))}
      </div>

      {/* MÁS COLORES. El cuentagotas abre el selector completo. */}
      <Boton rotulo="Más colores" activo={abierto} onClick={() => setAbierto((a) => !a)}>
        <Pipette className="size-4" />
      </Boton>

      {/* LOS RECIENTES solo aparecen cuando hay alguno: un rótulo «Recientes»
          sobre una fila vacía ocupa lugar y no dice nada. */}
      {recientes.length > 0 && (
        <>
          <Corte />
          <span className="text-[0.5rem] uppercase tracking-wide text-muted-foreground">Rec.</span>
          <div className="grid grid-cols-2 gap-1" aria-label="Colores recientes" role="group">
            {recientes.map((c) => (
              <Pastilla key={c} color={c} elegido={color === c} onClick={() => onColor(c)} />
            ))}
          </div>
        </>
      )}

      <Corte />

      {/* OPACIDAD. Un deslizador y no cuatro botones: es un continuo, y lo que
          se busca al atenuar un resaltado es «un poco menos», no un valor. */}
      <label className="flex w-full flex-col items-center gap-0.5" title={`Opacidad ${Math.round(opacidad * 100)}%`}>
        <span className="text-[0.5rem] uppercase tracking-wide text-muted-foreground">Opac.</span>
        <input
          type="range"
          min={10}
          max={100}
          value={Math.round(opacidad * 100)}
          onChange={(e) => onOpacidad(Number(e.target.value) / 100)}
          aria-label="Opacidad"
          className="h-1 w-8 cursor-pointer accent-primary"
        />
      </label>

      <Corte />

      <div role="group" aria-label="Capas" className="contents">
        <Boton rotulo="Panel de capas" activo={capasAbiertas} onClick={onCapas}>
          <Layers className="size-4" />
        </Boton>
      </div>

      {/*
        COPILOT. El botón existe porque la barra lo pide, y está APAGADO a
        propósito: no hay comportamiento definido para él en ninguna parte, y un
        botón que responde con algo inventado es peor que uno que dice que
        todavía no está. La app ya tiene su asistente (Ivi, `i`); si esto va a
        ser eso mismo sobre la anotación, hay que definir qué hace primero.
      */}
      <div role="group" aria-label="Copilot" className="contents">
        <Boton rotulo="Copilot (todavía no conectado)" onClick={() => {}} deshabilitado>
          <Sparkles className="size-4" />
        </Boton>
      </div>

      <Corte />

      <Boton rotulo="Deshacer" onClick={onDeshacer} deshabilitado={!puedeDeshacer}>
        <Undo2 className="size-4" />
      </Boton>
      <Boton rotulo="Rehacer" onClick={onRehacer} deshabilitado={!puedeRehacer}>
        <Redo2 className="size-4" />
      </Boton>
      <Boton rotulo="Borrar todo" onClick={onLimpiar} deshabilitado={!hayAlgo}>
        <Trash2 className="size-4" />
      </Boton>

      {/*
        EL POPUP. Va a la IZQUIERDA de la barra (`right-full`) porque la barra ya
        está pegada al borde derecho de la ventana: hacia afuera se saldría de la
        pantalla. Y anclado abajo (`bottom-2`) para que el panel, que es más alto
        que muchos de los botones, no se corte contra el techo.
      */}
      {abierto && (
        <div className="absolute bottom-2 right-full z-30 mr-2">
          <SelectorDeColor
            inicial={color}
            onCancelar={() => setAbierto(false)}
            onAceptar={(c) => {
              onColor(c);
              setAbierto(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
