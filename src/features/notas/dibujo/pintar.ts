import { bitmapDe } from './adjuntos';
import { type Caja, type Figura, type Punto, cajaDeFigura, cajaDeVarias, tiradoresDeCaja } from './figuras';

/**
 * DE FIGURAS A PÍXELES, SOBRE UN CANVAS TRANSPARENTE.
 *
 * ══ LO QUE NO HACE, Y ES LO MÁS IMPORTANTE ══════════════════════════════════
 *
 * **No pinta ningún fondo.** El `clearRect` deja el canvas con alfa cero, así
 * que lo único opaco que queda son los trazos y por el resto se ve el texto de
 * la página. Un `fillRect` blanco acá —el reflejo natural al escribir un
 * canvas— convertiría la capa en la hoja tapada que este frente vino a evitar.
 *
 * Lo mismo vale para las imágenes: `drawImage` respeta el canal alfa del PNG, y
 * acá no se pinta nada debajo. Una captura con fondo transparente se ve con el
 * texto de la página atrás, que es justamente para lo que sirve.
 *
 * ══ CADA OBJETO SE PINTA APARTE ═════════════════════════════════════════════
 *
 * No hay «aplanado»: la capa es una lista y esto la recorre. El orden del array
 * es el orden de encima, igual que en el papel. Agregar una figura nueva es un
 * `case` acá y nada más.
 *
 * ══ POR QUÉ EL BUFFER ES MÁS GRANDE QUE LA CAPA ═════════════════════════════
 *
 * El canvas se monta a `dpr` veces las medidas en CSS y todo se pinta en
 * coordenadas del documento, con la escala puesta una vez en la transformación.
 * Sin eso, en una pantalla Retina los trazos salen con el borde baboso — y una
 * anotación de línea fina sobre texto es justo donde más se nota.
 */

/**
 * La tipografía de los rótulos: la de la app, con las de sistema atrás. Si
 * `@fontsource` no cargó, el rótulo sale en otra fuente pero **sale**, y no se
 * cae al serif del navegador que desentonaría con toda la pantalla.
 */
const FUENTE = "'Montserrat', system-ui, sans-serif";

/** Qué tan grande es la punta de una flecha respecto de su grosor, y su mínimo. */
const PUNTA_POR_GROSOR = 4;
const PUNTA_MINIMA = 10;

/**
 * EL RESALTADOR: cuánto se ensancha y cuánta tinta deja.
 *
 * `multiply` y no un alfa a secas: con transparencia normal, el amarillo sobre
 * una letra negra la aclara y el texto queda lavado. Multiplicando, el trazo
 * oscurece el papel blanco y **deja intacto lo que ya era oscuro** — que es
 * exactamente lo que hace un marcador de verdad sobre tinta.
 */
const RESALTADOR_ANCHO = 4;
const RESALTADOR_ALFA = 0.4;

/** El azul de la selección, y cuánto se separa el recuadro de la figura. */
const SELECCION_COLOR = '#3b82f6';
const SELECCION_MARGEN = 6;

/** El lado de un tirador de redimensionado, en píxeles del documento. */
export const LADO_TIRADOR = 9;

function trazarMano(ctx: CanvasRenderingContext2D, puntos: Punto[]): void {
  if (puntos.length === 1) {
    // Un clic sin arrastrar es un punto, y una línea de un solo vértice no pinta
    // nada: se dibuja el redondel del grosor que tenga.
    ctx.beginPath();
    ctx.arc(puntos[0][0], puntos[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(puntos[0][0], puntos[0][1]);
  // Curvas cuadráticas entre los puntos medios: unir los puntos con `lineTo`
  // deja los codos angulosos de un polígono, y a mano alzada eso se ve como un
  // garabato de mouse, no como un trazo. El punto crudo hace de control y la
  // curva pasa por el medio de cada par — la técnica de siempre para suavizar
  // tinta sin recalcular el trazo entero.
  for (let i = 1; i < puntos.length - 1; i++) {
    ctx.quadraticCurveTo(
      puntos[i][0],
      puntos[i][1],
      (puntos[i][0] + puntos[i + 1][0]) / 2,
      (puntos[i][1] + puntos[i + 1][1]) / 2,
    );
  }
  const ultimo = puntos[puntos.length - 1];
  ctx.lineTo(ultimo[0], ultimo[1]);
  ctx.stroke();
}

function trazarFlecha(ctx: CanvasRenderingContext2D, desde: Punto, hasta: Punto, grosor: number): void {
  ctx.beginPath();
  ctx.moveTo(desde[0], desde[1]);
  ctx.lineTo(hasta[0], hasta[1]);
  ctx.stroke();

  const largo = Math.hypot(hasta[0] - desde[0], hasta[1] - desde[1]);
  // Una flecha de largo cero no tiene hacia dónde apuntar: sin esto, el `atan2`
  // da 0 y aparece una punta mirando a la derecha donde no se arrastró nada.
  if (largo < 1) return;

  const angulo = Math.atan2(hasta[1] - desde[1], hasta[0] - desde[0]);
  const punta = Math.max(PUNTA_MINIMA, grosor * PUNTA_POR_GROSOR);
  const abertura = Math.PI / 7;

  ctx.beginPath();
  ctx.moveTo(hasta[0], hasta[1]);
  ctx.lineTo(hasta[0] - punta * Math.cos(angulo - abertura), hasta[1] - punta * Math.sin(angulo - abertura));
  ctx.lineTo(hasta[0] - punta * Math.cos(angulo + abertura), hasta[1] - punta * Math.sin(angulo + abertura));
  ctx.closePath();
  ctx.fillStyle = ctx.strokeStyle as string;
  ctx.fill();
}

function trazarElipse(ctx: CanvasRenderingContext2D, desde: Punto, hasta: Punto): void {
  ctx.beginPath();
  ctx.ellipse(
    (desde[0] + hasta[0]) / 2,
    (desde[1] + hasta[1]) / 2,
    Math.abs(hasta[0] - desde[0]) / 2,
    Math.abs(hasta[1] - desde[1]) / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
}

function trazarRotulo(ctx: CanvasRenderingContext2D, texto: string, en: Punto, tamano: number): void {
  ctx.font = `${tamano}px ${FUENTE}`;
  ctx.textBaseline = 'top';
  // Se parte por `\n`: `fillText` no interpreta el salto, pintaría un cuadradito.
  const lineas = texto.split('\n');
  for (let i = 0; i < lineas.length; i++) {
    ctx.fillText(lineas[i], en[0], en[1] + i * tamano * 1.25);
  }
}

/**
 * UNA IMAGEN, o su hueco.
 *
 * Mientras el bitmap se está bajando —y para siempre, si el archivo ya no está—
 * se dibuja un marco punteado en lugar de no dibujar nada. Un hueco invisible
 * deja a la vendedora con una figura que ocupa espacio, se puede seleccionar y
 * mover, y **no se ve**: parecería que la app perdió la imagen. El marco dice
 * «acá hay algo que no se pudo cargar», que es la verdad.
 */
function trazarImagen(ctx: CanvasRenderingContext2D, f: Extract<Figura, { clase: 'imagen' }>): void {
  const bitmap = bitmapDe(f.archivo);
  if (bitmap) {
    // Sin `fillRect` debajo: el alfa del PNG se conserva y por los huecos se ve
    // el texto de la página.
    ctx.drawImage(bitmap, f.x, f.y, f.ancho, f.alto);
    return;
  }

  ctx.save();
  ctx.strokeStyle = '#9ca3af';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(f.x, f.y, f.ancho, f.alto);
  ctx.restore();
}

/**
 * ⚠️ La opacidad llega RESUELTA (objeto × capa) y no se lee de la figura: la de
 * la capa es una lente, no una edición, así que no está guardada en el objeto.
 * Ver `opacidadEfectiva` en `capas.ts`.
 */
function trazarUna(ctx: CanvasRenderingContext2D, f: Figura, opacidad: number): void {
  /**
   * 🔴 LA CAJA DE TEXTO NO SE PINTA ACÁ. Es un `contenteditable` de verdad,
   * apoyado sobre el mismo contenedor — ver `CajaFlotante.tsx`. Dibujarla
   * además en el canvas la mostraría dos veces, y la copia pintada no tendría
   * cursor ni se podría seleccionar con el mouse.
   */
  if (f.clase === 'caja') return;

  // La opacidad del OBJETO se aplica a todo lo que se dibuje de él. El
  // resaltador la multiplica por la suya adentro de su `save`.
  ctx.save();
  ctx.globalAlpha = opacidad;

  if (f.clase === 'imagen') {
    trazarImagen(ctx, f);
    ctx.restore();
    return;
  }

  ctx.strokeStyle = f.color;
  ctx.fillStyle = f.color;

  if (f.clase === 'rotulo') {
    trazarRotulo(ctx, f.texto, f.en, f.tamano);
    ctx.restore();
    return;
  }

  if (f.clase === 'resaltador') {
    // El estado se guarda y se repone: sin el `restore`, el `multiply` y el alfa
    // se quedarían puestos y TODO lo que se pinte después —incluido el recuadro
    // de selección— saldría translúcido y mezclado con el texto de abajo.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = opacidad * RESALTADOR_ALFA;
    ctx.lineWidth = f.grosor * RESALTADOR_ANCHO;
    // Punta cuadrada: un marcador deja una banda con los extremos rectos, no
    // dos semicírculos.
    ctx.lineCap = 'butt';
    trazarMano(ctx, f.puntos);
    ctx.restore();
    ctx.restore();
    return;
  }

  ctx.lineWidth = f.grosor;

  switch (f.clase) {
    case 'trazo':
      trazarMano(ctx, f.puntos);
      break;
    case 'linea':
      ctx.beginPath();
      ctx.moveTo(f.desde[0], f.desde[1]);
      ctx.lineTo(f.hasta[0], f.hasta[1]);
      ctx.stroke();
      break;
    case 'flecha':
      trazarFlecha(ctx, f.desde, f.hasta, f.grosor);
      break;
    case 'rectangulo':
      ctx.beginPath();
      ctx.rect(
        Math.min(f.desde[0], f.hasta[0]),
        Math.min(f.desde[1], f.hasta[1]),
        Math.abs(f.hasta[0] - f.desde[0]),
        Math.abs(f.hasta[1] - f.desde[1]),
      );
      ctx.stroke();
      break;
    case 'elipse':
      trazarElipse(ctx, f.desde, f.hasta);
      break;
  }

  ctx.restore();
}

/** El recuadro punteado de una figura elegida. */
function trazarRecuadro(ctx: CanvasRenderingContext2D, c: Caja, margen = SELECCION_MARGEN): void {
  ctx.save();
  ctx.strokeStyle = SELECCION_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(c.x1 - margen, c.y1 - margen, c.x2 - c.x1 + margen * 2, c.y2 - c.y1 + margen * 2);
  ctx.restore();
}

/**
 * LOS TIRADORES de redimensionado, en las cuatro esquinas.
 *
 * Se pintan **solo cuando hay UNA figura elegida y es redimensionable**. Con
 * varias, arrastrar una esquina tendría que escalar el grupo entero alrededor de
 * un origen común —otra operación, con sus propios casos— y mostrar tiradores
 * que no hacen eso sería prometer algo que no pasa.
 */
function trazarTiradores(ctx: CanvasRenderingContext2D, c: Caja): void {
  const tiradores = tiradoresDeCaja({
    x1: c.x1 - SELECCION_MARGEN,
    y1: c.y1 - SELECCION_MARGEN,
    x2: c.x2 + SELECCION_MARGEN,
    y2: c.y2 + SELECCION_MARGEN,
  });

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = SELECCION_COLOR;
  ctx.lineWidth = 1.5;
  for (const p of Object.values(tiradores)) {
    ctx.beginPath();
    ctx.rect(p[0] - LADO_TIRADOR / 2, p[1] - LADO_TIRADOR / 2, LADO_TIRADOR, LADO_TIRADOR);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** El rectángulo que se está arrastrando para seleccionar varias figuras. */
function trazarLazo(ctx: CanvasRenderingContext2D, c: Caja): void {
  const x = Math.min(c.x1, c.x2);
  const y = Math.min(c.y1, c.y2);
  const ancho = Math.abs(c.x2 - c.x1);
  const alto = Math.abs(c.y2 - c.y1);

  ctx.save();
  ctx.fillStyle = 'rgba(59, 130, 246, 0.10)';
  ctx.strokeStyle = SELECCION_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(x, y, ancho, alto);
  ctx.strokeRect(x, y, ancho, alto);
  ctx.restore();
}

export interface OpcionesDePintado {
  ancho: number;
  alto: number;
  dpr: number;
  /** Los ids elegidos. Vacío = nada seleccionado. */
  seleccionadas?: readonly string[];
  /** Si se está arrastrando el rectángulo de selección múltiple. */
  lazo?: Caja | null;
  /** Con `false` no se dibujan recuadros ni tiradores (modo texto, solo lectura). */
  conAdornos?: boolean;
  /**
   * Con qué opacidad va cada figura. Se inyecta en vez de leerse de la figura
   * porque la de la CAPA la multiplica y no está guardada en el objeto — quien
   * pinta no conoce las capas, y no tiene por qué.
   */
  opacidadDe?: (f: Figura) => number;
}

/**
 * PINTA LA CAPA ENTERA, de cero, sobre fondo transparente.
 *
 * No hay pintado incremental a propósito: con la capa acotada a 64 KB son unos
 * cientos de figuras como mucho, repintar cuesta menos que un frame, y a cambio
 * **no existe la clase de defecto** en que la pantalla y la lista se van
 * separando (un deshacer que deja el trazo pintado, un borrado que no se va
 * hasta mover el mouse).
 */
export function pintar(ctx: CanvasRenderingContext2D, figuras: Figura[], opciones: OpcionesDePintado): void {
  const { ancho, alto, dpr, seleccionadas = [], lazo = null, conAdornos = true, opacidadDe } = opciones;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, ancho, alto);

  // Puntas y uniones redondeadas: es lo que hace que un trazo grueso se vea como
  // tinta y no como una tubería con las esquinas cortadas en escuadra. El
  // resaltador las pisa adentro de su `save`.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const f of figuras) trazarUna(ctx, f, opacidadDe ? opacidadDe(f) : f.opacidad);

  if (!conAdornos) return;

  const elegidas = figuras.filter((f) => seleccionadas.includes(f.id));
  for (const f of elegidas) trazarRecuadro(ctx, cajaDeFigura(f));

  // Los tiradores, solo con UNA imagen elegida. Ver `trazarTiradores`.
  // Los tiradores salen con UNA sola elegida y redimensionable: una imagen (dos
  // dimensiones) o una caja de texto (solo el ancho; el alto lo pone el
  // contenido). Con varias, arrastrar una esquina tendría que escalar el grupo
  // entero — otra operación, con sus propios casos.
  if (elegidas.length === 1 && (elegidas[0].clase === 'imagen' || elegidas[0].clase === 'caja')) {
    trazarTiradores(ctx, cajaDeFigura(elegidas[0]));
  }

  /**
   * EL RECUADRO DEL GRUPO. Con dos o más elegidas, además de marcar cada una se
   * envuelve el conjunto: sin él, ocho figuras sueltas parecen ocho selecciones
   * independientes y no se ve qué se va a mover junto.
   */
  const conjunto = elegidas.length > 1 ? cajaDeVarias(elegidas) : null;
  if (conjunto) {
    ctx.save();
    ctx.strokeStyle = SELECCION_COLOR;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    const m = SELECCION_MARGEN + 4;
    ctx.strokeRect(conjunto.x1 - m, conjunto.y1 - m, conjunto.x2 - conjunto.x1 + m * 2, conjunto.y2 - conjunto.y1 + m * 2);
    ctx.restore();
  }

  if (lazo) trazarLazo(ctx, lazo);
}
