/**
 * EL MODELO DE LA CAPA DE ANOTACIONES — lo que se dibuja ENCIMA del texto.
 *
 * ══ QUÉ ES ESTA CAPA Y QUÉ NO ES ════════════════════════════════════════════
 *
 * La Libreta sigue siendo un editor de TEXTO. Esto no lo convierte en un
 * programa de dibujo: es una hoja transparente apoyada sobre la página, como
 * anotar un PDF impreso con un marcador. Se rodea una palabra, se tira una
 * flecha, se pega una captura al costado — y abajo el texto sigue siendo texto,
 * editable y buscable.
 *
 * Por eso las anotaciones **no viven en el `doc`**: viven en su propia columna
 * (`notas.anotaciones`). Un bloque adentro del documento se puede borrar sin
 * verlo —un ⌘A + Suprimir— y se perdería en silencio.
 *
 * ══ CADA FIGURA ES UN OBJETO CON IDENTIDAD ══════════════════════════════════
 *
 * Nada se «aplasta» contra un bitmap: la capa es una LISTA de objetos, cada uno
 * con su `id` y sus propiedades. Un trazo sigue siendo un trazo el mes que
 * viene, una imagen sigue siendo una imagen que se puede mover y redimensionar.
 *
 * El `id` no es decorativo: es lo que hace posible **seleccionar varios**
 * (la selección es un conjunto de ids, no de posiciones), y lo que impide el
 * defecto clásico de seleccionar por índice — mandar una figura al frente
 * reordena el array, y una selección por índice pasa a marcar otra cosa.
 *
 * El ORDEN DEL ARRAY ES EL ORDEN DE CAPAS: el último se pinta encima. Traer al
 * frente es mover al final; enviar atrás, al principio. `reordenar` ya lo
 * implementa y la barra todavía no lo expone.
 *
 * ══ LAS COORDENADAS SON PÍXELES DEL DOCUMENTO ═══════════════════════════════
 *
 * `[0, 0]` es la esquina superior izquierda del área del documento, y crece
 * hacia abajo **con el scroll incluido**: una flecha en `y: 1800` está a 1800 px
 * del principio de la página, no de lo que se ve en pantalla. Eso es lo que hace
 * que un círculo alrededor de una palabra siga alrededor de esa palabra después
 * de scrollear, y lo que deja que la capa se pinte una sola vez en vez de
 * recalcularse en cada rueda del mouse.
 *
 * ⚠️ **LO QUE ESTO NO PUEDE HACER, DICHO DE FRENTE.** Las coordenadas son
 * absolutas, así que las anotaciones quedan ancladas al DOCUMENTO, no a las
 * palabras. Si después se escribe un párrafo más arriba, el texto baja y el
 * círculo se queda donde estaba. Un PDF anotado tiene la misma limitación —y
 * funciona— porque el documento no se reacomoda. Acá sí puede.
 *
 * ══ ESTE ARCHIVO ES PURO ════════════════════════════════════════════════════
 *
 * Ni React, ni canvas, ni DOM: la forma de los datos y la geometría. Es lo que
 * deja probar el borrador, la selección, el redimensionado y el recorte de
 * tamaño sin montar nada.
 */

/**
 * EL TOPE DE LA CAPA — 64 KB del JSON serializado.
 *
 * ⚠️ **Las imágenes NO cuentan acá**, y esa es la razón de que el número siga
 * siendo chico: una imagen guarda el NOMBRE de su archivo (unas decenas de
 * bytes), no sus bytes. Los bytes viven en disco (`/api/notas/adjuntos`). Meter
 * un PNG en base64 adentro de este JSON reventaría el body de 100 KB de express
 * con una sola captura de pantalla.
 *
 * ⚠️ El server tiene su propia copia (`LIMITE_ANOTACIONES_BYTES`) y el candado
 * que las cruza es `dibujo.paridad.test.ts`.
 */
export const LIMITE_FIGURAS_BYTES = 64 * 1024;

/** Un punto: `[x, y]` en píxeles del área del documento. */
export type Punto = [number, number];

/** Las que se dibujan arrastrando de una esquina a la otra. */
export type ClaseDeDosPuntos = 'linea' | 'flecha' | 'rectangulo' | 'elipse';

/** Las que se dibujan a mano alzada. El resaltador es un trazo ancho y translúcido. */
export type ClaseDeMano = 'trazo' | 'resaltador';

/**
 * LO QUE TODA FIGURA TIENE, sin importar su clase.
 *
 * ══ POR QUÉ `capaId` Y `opacidad` VIVEN ACÁ Y NO EN CADA TIPO ═══════════════
 *
 * Porque son propiedades del OBJETO, no de su forma: una imagen se puede
 * atenuar igual que un trazo, y las dos pueden estar en la capa «borradores».
 * Repetirlas en los cinco miembros de la unión sería garantizar que la sexta
 * clase que se agregue se olvide de una.
 *
 * `rotacion` está declarada y **todavía no se usa**: es el pedido explícito de
 * dejar la estructura lista. Guardarla desde ahora significa que el día que se
 * implemente no hay migración de datos — las figuras viejas ya tienen su 0.
 */
export interface Comun {
  id: string;
  /** 0–1. El resaltador además multiplica; ver `pintar.ts`. */
  opacidad: number;
  /** A qué capa pertenece. Ver `capas.ts`. */
  capaId: string;
  /** Grados. Declarada para el futuro; hoy nadie la lee. */
  rotacion?: number;
}

/**
 * LA CAJA DE TEXTO. Es el único objeto que **no se pinta en el canvas**: es un
 * `contenteditable` de verdad, apoyado en el mismo sistema de coordenadas.
 *
 * ══ POR QUÉ NO ES CANVAS ════════════════════════════════════════════════════
 *
 * Porque tiene que seguir siendo TEXTO: cursor que se ve, caracteres que se
 * seleccionan, ⌘A adentro de la caja, y word-wrap al angostarla. Nada de eso
 * existe en un canvas sin reimplementar un editor entero — y el pedido es
 * explícito: «El texto debe continuar siendo texto real/editable. NO
 * convertirlo en imagen.»
 *
 * `alto` es la última altura MEDIDA, no una que se imponga: el contenido manda
 * y el ancho es lo único que se arrastra. Se guarda para poder dibujar la caja
 * de selección y calcular el rectángulo del grupo sin tener que montar el DOM.
 */
export interface CajaDeTexto {
  clase: 'caja';
  x: number;
  y: number;
  ancho: number;
  /** La última altura medida del contenido. La escribe el componente. */
  alto: number;
  texto: string;
  fuente: string;
  tamano: number;
  negrita: boolean;
  cursiva: boolean;
  subrayado: boolean;
  alineacion: 'left' | 'center' | 'right';
  color: string;
}

export type Figura = Comun &
  (
    | { clase: ClaseDeMano; color: string; grosor: number; puntos: Punto[] }
    | { clase: ClaseDeDosPuntos; color: string; grosor: number; desde: Punto; hasta: Punto }
    /** Un rótulo pintado en el canvas. Es lo que había antes de las cajas. */
    | { clase: 'rotulo'; color: string; tamano: number; en: Punto; texto: string }
    | CajaDeTexto
    /**
     * UNA IMAGEN PEGADA. `archivo` es el nombre en el almacén del server, nunca
     * los bytes: la capa viaja en cada autoguardado y una captura en base64 la
     * volvería impagable.
     *
     * `natural*` guarda las medidas originales para poder restaurar la
     * proporción y saber a qué relación volver al redimensionar.
     */
    | {
        clase: 'imagen';
        archivo: string;
        x: number;
        y: number;
        ancho: number;
        alto: number;
        naturalAncho: number;
        naturalAlto: number;
      }
  );

/** Los valores por defecto de lo común. Un solo lugar. */
export const CAPA_BASE = 'base';
export const OPACIDAD_PLENA = 1;

/** El formato con el que nace una caja de texto. */
export const CAJA_POR_DEFECTO = {
  fuente: 'Montserrat, system-ui, sans-serif',
  tamano: 18,
  negrita: false,
  cursiva: false,
  subrayado: false,
  alineacion: 'left',
  ancho: 240,
  alto: 32,
} as const;

export type ClaseDeFigura = Figura['clase'];

const CLASES_DE_MANO: readonly ClaseDeMano[] = ['trazo', 'resaltador'];
const CLASES_DE_DOS_PUNTOS: readonly ClaseDeDosPuntos[] = ['linea', 'flecha', 'rectangulo', 'elipse'];

/**
 * UN ID NUEVO. `crypto.randomUUID` cuando está (todo navegador moderno y Node
 * 19+), con una vuelta a `Math.random` para que un test en un entorno pelado no
 * se caiga por esto. La unicidad solo tiene que valer dentro de UNA página.
 */
export function nuevoId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * LA BASE DE UNA FIGURA NUEVA — id, opacidad y capa.
 *
 * Existe para que crear una figura sea imposible de hacer a medias. Con los tres
 * campos escritos a mano en cada sitio de creación —hay seis— basta olvidarse de
 * `opacidad` en uno para que ese tipo de figura nazca con `undefined` en el
 * `globalAlpha` y se pinte invisible.
 */
export function nuevaBase(opciones: { opacidad?: number; capaId?: string } = {}): Comun {
  return {
    id: nuevoId(),
    opacidad: opciones.opacidad ?? OPACIDAD_PLENA,
    capaId: opciones.capaId ?? CAPA_BASE,
  };
}

/* ─────────────────────────── Serialización ─────────────────────────────── */

/**
 * Un decimal y no más. Un `pointermove` produce coordenadas como
 * `312.7333335876465`: quince dígitos que **no se ven** y que pesan cuatro veces
 * lo mismo. Redondear deja el trazo idéntico en pantalla y baja el JSON a menos
 * de la mitad, que es lo que decide si una página muy anotada entra en el tope.
 */
function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}

function puntoLimpio(p: Punto): Punto {
  return [redondear(p[0]), redondear(p[1])];
}

/**
 * LAS FIGURAS COMO SE GUARDAN — un array, no un string.
 *
 * La columna es `jsonb`: mandar un string adentro del JSON sería guardar JSON
 * escapado dentro de JSON, y el server no podría ni contar las figuras sin
 * parsear a mano.
 */
export function paraGuardar(figuras: Figura[]): Figura[] {
  return figuras.map((f) => {
    if ('puntos' in f) return { ...f, puntos: f.puntos.map(puntoLimpio) };
    if ('en' in f) return { ...f, en: puntoLimpio(f.en) };
    if ('texto' in f && 'ancho' in f) {
      return { ...f, x: redondear(f.x), y: redondear(f.y), ancho: redondear(f.ancho), alto: redondear(f.alto) };
    }
    if ('archivo' in f) {
      return {
        ...f,
        x: redondear(f.x),
        y: redondear(f.y),
        ancho: redondear(f.ancho),
        alto: redondear(f.alto),
      };
    }
    return { ...f, desde: puntoLimpio(f.desde), hasta: puntoLimpio(f.hasta) };
  });
}

function esPunto(v: unknown): v is Punto {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === 'number' &&
    typeof v[1] === 'number' &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1])
  );
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function colorDe(v: unknown): string {
  return typeof v === 'string' && v !== '' ? v : '#000000';
}

function numeroDe(v: unknown, siNo: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : siNo;
}

/** Acepta el 0 y los negativos: una imagen puede estar en `x: -12`. */
function coordenadaDe(v: unknown, siNo: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : siNo;
}

function idDe(v: unknown): string {
  return typeof v === 'string' && v !== '' ? v : nuevoId();
}

/**
 * LO GUARDADO → las figuras. **Nunca lanza y nunca inventa.**
 *
 * Lo que entra acá es una columna `jsonb` que puede venir de una versión
 * anterior, a medio escribir o tocada a mano. La regla es la misma que la del
 * aplanador del server: lo que no se entiende **se saltea y se sigue**, porque
 * una anotación que no se puede pintar no puede ser el motivo por el que la
 * página entera no abre. Una figura suelta que se pierde es una figura; una
 * excepción acá deja la ventana en blanco (no hay ErrorBoundary en `src/` —
 * está verificado en `editor.ts`).
 *
 * A una figura sin `id` se le pone uno: las que se guardaron antes de que los
 * ids existieran tienen que poder seleccionarse igual.
 */
export function parsear(valor: unknown): Figura[] {
  let crudo: unknown = valor;
  if (typeof valor === 'string') {
    if (valor.trim() === '') return [];
    try {
      crudo = JSON.parse(valor);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(crudo)) return [];

  const figuras: Figura[] = [];
  for (const f of crudo) {
    if (!esObjeto(f)) continue;
    const id = idDe(f.id);
    const color = colorDe(f.color);
    // Lo COMÚN se completa siempre, y con defaults: una figura guardada antes de
    // que existieran la opacidad y las capas tiene que abrirse igual, opaca y en
    // la capa base. Sin esto, `undefined` llegaría a un `globalAlpha` y la figura
    // se pintaría transparente sin que nadie lo haya pedido.
    const comun = {
      id,
      opacidad: typeof f.opacidad === 'number' && f.opacidad >= 0 && f.opacidad <= 1 ? f.opacidad : OPACIDAD_PLENA,
      capaId: typeof f.capaId === 'string' && f.capaId !== '' ? f.capaId : CAPA_BASE,
      ...(typeof f.rotacion === 'number' && Number.isFinite(f.rotacion) ? { rotacion: f.rotacion } : {}),
    };

    if (CLASES_DE_MANO.includes(f.clase as ClaseDeMano)) {
      const puntos = Array.isArray(f.puntos) ? f.puntos.filter(esPunto) : [];
      // Un trazo sin puntos no se ve: no se guarda, para no engordar el JSON ni
      // darle al borrador algo invisible que borrar.
      if (puntos.length > 0) {
        figuras.push({ ...comun, clase: f.clase as ClaseDeMano, color, grosor: numeroDe(f.grosor, 3), puntos });
      }
      continue;
    }

    if (f.clase === 'rotulo') {
      const texto = typeof f.texto === 'string' ? f.texto : '';
      if (texto !== '' && esPunto(f.en)) {
        figuras.push({ ...comun, clase: 'rotulo', color, tamano: numeroDe(f.tamano, 20), en: f.en, texto });
      }
      continue;
    }

    if (f.clase === 'caja') {
      // Una caja sin texto no se ve y no se puede agarrar: sería un objeto
      // fantasma que ocupa lugar en la capa. Se descarta al leer, igual que un
      // trazo sin puntos.
      const texto = typeof f.texto === 'string' ? f.texto : '';
      if (texto.trim() !== '') {
        const alineacion = f.alineacion === 'center' || f.alineacion === 'right' ? f.alineacion : 'left';
        figuras.push({
          ...comun,
          clase: 'caja',
          x: coordenadaDe(f.x, 0),
          y: coordenadaDe(f.y, 0),
          ancho: numeroDe(f.ancho, CAJA_POR_DEFECTO.ancho),
          alto: numeroDe(f.alto, CAJA_POR_DEFECTO.alto),
          texto,
          fuente: typeof f.fuente === 'string' && f.fuente !== '' ? f.fuente : CAJA_POR_DEFECTO.fuente,
          tamano: numeroDe(f.tamano, CAJA_POR_DEFECTO.tamano),
          negrita: f.negrita === true,
          cursiva: f.cursiva === true,
          subrayado: f.subrayado === true,
          alineacion,
          color,
        });
      }
      continue;
    }

    if (f.clase === 'imagen') {
      // Sin `archivo` no hay nada que pintar, y el nombre se revalida igual del
      // lado del server antes de tocar el disco.
      const archivo = typeof f.archivo === 'string' ? f.archivo : '';
      if (archivo !== '') {
        const naturalAncho = numeroDe(f.naturalAncho, 1);
        const naturalAlto = numeroDe(f.naturalAlto, 1);
        figuras.push({
          ...comun,
          clase: 'imagen',
          archivo,
          x: coordenadaDe(f.x, 0),
          y: coordenadaDe(f.y, 0),
          ancho: numeroDe(f.ancho, naturalAncho),
          alto: numeroDe(f.alto, naturalAlto),
          naturalAncho,
          naturalAlto,
        });
      }
      continue;
    }

    if (CLASES_DE_DOS_PUNTOS.includes(f.clase as ClaseDeDosPuntos) && esPunto(f.desde) && esPunto(f.hasta)) {
      figuras.push({
        ...comun,
        clase: f.clase as ClaseDeDosPuntos,
        color,
        grosor: numeroDe(f.grosor, 3),
        desde: f.desde,
        hasta: f.hasta,
      });
    }
  }
  return figuras;
}

/** ¿La capa pasa del tope? Devuelve los bytes, para poder decirlo en pantalla. */
export function pesoDeFiguras(figuras: Figura[]): number {
  // `Blob` no está en Node y esto también corre en los tests: se mide con
  // `TextEncoder`, que es el mismo UTF-8 que va a contar el server.
  return new TextEncoder().encode(JSON.stringify(paraGuardar(figuras))).length;
}

/** Los archivos que la capa usa. Lo necesita el precargador de imágenes. */
export function archivosDeFiguras(figuras: Figura[]): string[] {
  return [...new Set(figuras.flatMap((f) => (f.clase === 'imagen' ? [f.archivo] : [])))];
}

/* ──────────────────────────── Geometría ────────────────────────────────── */

/** Distancia de un punto al SEGMENTO `a-b` (no a la recta infinita). */
function distanciaASegmento(p: Punto, a: Punto, b: Punto): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const largo2 = dx * dx + dy * dy;
  // Segmento degenerado (los dos puntos iguales): es la distancia al punto.
  if (largo2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);

  // Proyección escalar de `a→p` sobre `a→b`, recortada al segmento.
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / largo2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export interface Caja {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * LA CAJA QUE ENVUELVE UNA FIGURA. La usan el recuadro de selección, los tiradores
 * de redimensionado y el rectángulo de selección múltiple.
 *
 * El ancho de un rótulo se ESTIMA (0,55 em por carácter, la proporción de una
 * sans-serif): medirlo de verdad exige un canvas, y este archivo es puro. Errar
 * por poco solo mueve el borde del recuadro unos píxeles.
 */
export function cajaDeFigura(f: Figura): Caja {
  if ('puntos' in f) {
    const xs = f.puntos.map((p) => p[0]);
    const ys = f.puntos.map((p) => p[1]);
    return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  }
  if ('en' in f) {
    const lineas = f.texto.split('\n');
    const ancho = Math.max(...lineas.map((l) => l.length)) * f.tamano * 0.55;
    return { x1: f.en[0], y1: f.en[1], x2: f.en[0] + ancho, y2: f.en[1] + lineas.length * f.tamano * 1.25 };
  }
  // Imagen y caja de texto comparten forma: x/y/ancho/alto.
  if ('archivo' in f || ('texto' in f && 'ancho' in f)) {
    return { x1: f.x, y1: f.y, x2: f.x + f.ancho, y2: f.y + f.alto };
  }
  return {
    x1: Math.min(f.desde[0], f.hasta[0]),
    y1: Math.min(f.desde[1], f.hasta[1]),
    x2: Math.max(f.desde[0], f.hasta[0]),
    y2: Math.max(f.desde[1], f.hasta[1]),
  };
}

/** La caja que envuelve a VARIAS figuras. `null` si no hay ninguna. */
export function cajaDeVarias(figuras: Figura[]): Caja | null {
  if (figuras.length === 0) return null;
  const cajas = figuras.map(cajaDeFigura);
  return {
    x1: Math.min(...cajas.map((c) => c.x1)),
    y1: Math.min(...cajas.map((c) => c.y1)),
    x2: Math.max(...cajas.map((c) => c.x2)),
    y2: Math.max(...cajas.map((c) => c.y2)),
  };
}

/** ¿El punto `p` toca el BORDE de la caja (no su interior)? */
function tocaElBorde(p: Punto, caja: Caja, radio: number): boolean {
  const { x1, y1, x2, y2 } = caja;
  const dentroConMargen = p[0] >= x1 - radio && p[0] <= x2 + radio && p[1] >= y1 - radio && p[1] <= y2 + radio;
  if (!dentroConMargen) return false;
  const adentroDelHueco = p[0] > x1 + radio && p[0] < x2 - radio && p[1] > y1 + radio && p[1] < y2 - radio;
  return !adentroDelHueco;
}

function dentroDeLaCaja(p: Punto, caja: Caja, radio: number): boolean {
  return p[0] >= caja.x1 - radio && p[0] <= caja.x2 + radio && p[1] >= caja.y1 - radio && p[1] <= caja.y2 + radio;
}

/**
 * QUÉ FIGURA HAY BAJO EL PUNTERO — el índice de la de más ARRIBA, o `-1`.
 *
 * Lo usan el borrador (para sacarla) y la selección (para agarrarla), y por eso
 * vive una sola vez: con dos copias, «lo que borro» y «lo que selecciono» se
 * irían separando y el borrador terminaría llevándose algo distinto de lo que
 * el recuadro estaba marcando.
 *
 * Se recorre **de atrás para adelante** porque la última dibujada está encima:
 * agarrar la de abajo cuando hay dos superpuestas se siente como que el puntero
 * atravesó lo que se estaba tocando.
 */
export function figuraTocada(figuras: Figura[], p: Punto, radio: number): number {
  for (let i = figuras.length - 1; i >= 0; i--) {
    const f = figuras[i];

    if ('puntos' in f) {
      // Un trazo de un solo punto es un puntito: se compara contra sí mismo.
      if (f.puntos.length === 1) {
        if (Math.hypot(p[0] - f.puntos[0][0], p[1] - f.puntos[0][1]) <= radio + f.grosor) return i;
        continue;
      }
      let toca = false;
      for (let j = 1; j < f.puntos.length && !toca; j++) {
        toca = distanciaASegmento(p, f.puntos[j - 1], f.puntos[j]) <= radio + f.grosor / 2;
      }
      if (toca) return i;
      continue;
    }

    // Un rótulo y una imagen son manchas LLENAS, no contornos: se agarran por
    // adentro. Pedir que se toque el borde de una foto sería insufrible.
    if ('en' in f || 'archivo' in f || f.clase === 'caja') {
      if (dentroDeLaCaja(p, cajaDeFigura(f), radio)) return i;
      continue;
    }

    if (f.clase === 'linea' || f.clase === 'flecha') {
      if (distanciaASegmento(p, f.desde, f.hasta) <= radio + f.grosor / 2) return i;
      continue;
    }

    // Rectángulo y elipse son HUECOS: se agarran por el contorno, no por el
    // centro. Es lo que hace usable rodear una palabra — con el interior
    // sensible, el círculo que rodea un párrafo se tragaría todo clic adentro
    // suyo, incluido el que iba al texto o a otra anotación.
    if (tocaElBorde(p, cajaDeFigura(f), radio + f.grosor)) return i;
  }
  return -1;
}

/**
 * LAS FIGURAS QUE EL RECTÁNGULO DE SELECCIÓN AGARRA.
 *
 * Toma lo CONTENIDO y también lo INTERSECTADO: alcanza con rozar una figura
 * para llevársela. Es lo pedido, y es lo que hace rápido «agarrá todo lo de esta
 * zona» — sobre un párrafo anotado, exigir contener por completo obliga a
 * abarcar la flecha más larga para poder tomar el círculo de al lado.
 *
 * El precio, dicho de frente: un trazo que cruza media página entra apenas se lo
 * toca. Para esos casos está el clic directo y el `Ctrl+clic`.
 */
export function figurasEnCaja(figuras: Figura[], caja: Caja): string[] {
  const x1 = Math.min(caja.x1, caja.x2);
  const x2 = Math.max(caja.x1, caja.x2);
  const y1 = Math.min(caja.y1, caja.y2);
  const y2 = Math.max(caja.y1, caja.y2);

  return figuras
    .filter((f) => {
      const c = cajaDeFigura(f);
      // Dos rectángulos se cruzan salvo que uno esté enteramente a un lado del
      // otro. Escrito por la negativa es una condición y no cuatro casos.
      return !(c.x2 < x1 || c.x1 > x2 || c.y2 < y1 || c.y1 > y2);
    })
    .map((f) => f.id);
}

/** La misma figura, corrida. Devuelve una nueva: nada se muta en su lugar. */
export function moverFigura(f: Figura, dx: number, dy: number): Figura {
  const corrido = (p: Punto): Punto => [p[0] + dx, p[1] + dy];
  // Por `in` y no por `clase`: TypeScript no descarta un miembro cuyo `clase` es
  // un alias de unión. Además es lo correcto de leer — lo que decide cómo se
  // mueve una figura es qué puntos tiene, no su nombre.
  if ('puntos' in f) return { ...f, puntos: f.puntos.map(corrido) };
  if ('en' in f) return { ...f, en: corrido(f.en) };
  if ('archivo' in f || f.clase === 'caja') return { ...f, x: f.x + dx, y: f.y + dy };
  return { ...f, desde: corrido(f.desde), hasta: corrido(f.hasta) };
}

/**
 * EL COLOR DE UNA FIGURA, cambiado. Una imagen **no tiene color** y se devuelve
 * intacta: pintarla de rojo no significa nada, y devolver `undefined` obligaría
 * a cada llamador a filtrar antes.
 */
export function conColor(f: Figura, color: string): Figura {
  return f.clase === 'imagen' ? f : { ...f, color };
}

/** La misma figura con otra opacidad. Vale para TODAS, imágenes incluidas. */
export function conOpacidad(f: Figura, opacidad: number): Figura {
  return { ...f, opacidad: Math.min(1, Math.max(0, opacidad)) };
}

/** El formato de una caja de texto, cambiado. Las demás figuras pasan intactas. */
export function conFormato(f: Figura, cambios: Partial<Omit<CajaDeTexto, 'clase'>>): Figura {
  return f.clase === 'caja' ? { ...f, ...cambios } : f;
}

/**
 * ANGOSTAR O ENSANCHAR UNA CAJA DE TEXTO. Solo el ANCHO se arrastra: el alto lo
 * decide el contenido con `word-wrap`, y forzarlo produciría texto cortado o una
 * caja con un hueco abajo. Es la diferencia con una imagen, donde las dos
 * dimensiones son del objeto.
 */
export function redimensionarCaja(f: CajaDeTexto & Comun, esquina: Esquina, p: Punto): Figura {
  const derecha = esquina === 'ne' || esquina === 'se';
  const fijo = derecha ? f.x : f.x + f.ancho;
  const ancho = Math.max(MINIMO_CAJA, Math.abs(p[0] - fijo));
  return { ...f, ancho, x: derecha ? fijo : fijo - ancho };
}

/* ─────────────────── Redimensionar (por ahora, imágenes) ───────────────── */

export type Esquina = 'ne' | 'no' | 'se' | 'so';

export const ESQUINAS: readonly Esquina[] = ['no', 'ne', 'so', 'se'];

/** Dónde va cada tirador de una caja. En coordenadas del documento. */
export function tiradoresDeCaja(c: Caja): Record<Esquina, Punto> {
  return {
    no: [c.x1, c.y1],
    ne: [c.x2, c.y1],
    so: [c.x1, c.y2],
    se: [c.x2, c.y2],
  };
}

/** Qué tirador cae bajo el puntero, o `null`. */
export function tiradorTocado(c: Caja, p: Punto, radio: number): Esquina | null {
  const tiradores = tiradoresDeCaja(c);
  for (const esquina of ESQUINAS) {
    const t = tiradores[esquina];
    if (Math.hypot(p[0] - t[0], p[1] - t[1]) <= radio) return esquina;
  }
  return null;
}

/** Lo más chico que puede quedar una imagen: menos que esto no se puede agarrar. */
const MINIMO_IMAGEN = 24;

/** Y lo más angosta que puede quedar una caja: menos parte cada palabra. */
const MINIMO_CAJA = 60;

/**
 * REDIMENSIONAR ARRASTRANDO UN TIRADOR.
 *
 * ══ LA PROPORCIÓN SE MANTIENE POR DEFECTO ═══════════════════════════════════
 *
 * Y `libre` (Shift) la suelta. Es al revés de lo que hacen los editores de
 * formas, y a propósito: acá lo que se redimensiona es una FOTO, y una foto
 * deformada casi nunca es lo que alguien quiso. La deformación tiene que costar
 * una tecla, no ser el default.
 *
 * La esquina OPUESTA a la que se arrastra queda clavada — es lo que hace que la
 * imagen «crezca desde donde la agarraste» en vez de saltar de lugar.
 */
export function redimensionarImagen(
  f: Extract<Figura, { clase: 'imagen' }>,
  esquina: Esquina,
  p: Punto,
  libre: boolean,
): Extract<Figura, { clase: 'imagen' }> {
  const fijoX = esquina === 'no' || esquina === 'so' ? f.x + f.ancho : f.x;
  const fijoY = esquina === 'no' || esquina === 'ne' ? f.y + f.alto : f.y;

  let ancho = Math.abs(p[0] - fijoX);
  let alto = Math.abs(p[1] - fijoY);

  if (!libre) {
    // Se manda la dimensión que MÁS creció respecto de la original: usar siempre
    // el ancho hace que arrastrar en vertical no responda, que se siente roto.
    const razon = f.naturalAlto / f.naturalAncho;
    if (ancho * razon > alto) alto = ancho * razon;
    else ancho = alto / razon;
  }

  ancho = Math.max(MINIMO_IMAGEN, ancho);
  alto = Math.max(MINIMO_IMAGEN, alto);

  return {
    ...f,
    ancho,
    alto,
    x: esquina === 'no' || esquina === 'so' ? fijoX - ancho : fijoX,
    y: esquina === 'no' || esquina === 'ne' ? fijoY - alto : fijoY,
  };
}

/* ───────────────────────────── Capas ───────────────────────────────────── */

export type Reordenamiento = 'frente' | 'fondo' | 'subir' | 'bajar';

/**
 * MOVER LO SELECCIONADO EN EL ORDEN DE CAPAS.
 *
 * El orden del array ES el orden de pintado, así que esto es una permutación y
 * nada más. Está escrito y probado aunque la barra todavía no lo exponga: era
 * el pedido explícito de dejar la estructura lista, y la parte difícil no es el
 * botón sino conservar el orden RELATIVO de lo seleccionado cuando se mueven
 * varias figuras juntas.
 */
export function reordenar(figuras: Figura[], ids: string[], a: Reordenamiento): Figura[] {
  const elegidas = new Set(ids);
  if (elegidas.size === 0) return figuras;

  if (a === 'frente' || a === 'fondo') {
    const quedan = figuras.filter((f) => !elegidas.has(f.id));
    const van = figuras.filter((f) => elegidas.has(f.id));
    return a === 'frente' ? [...quedan, ...van] : [...van, ...quedan];
  }

  // Un paso: se recorre en el sentido del movimiento para que un bloque de
  // figuras contiguas suba junto en vez de amontonarse contra la primera.
  const nuevas = [...figuras];
  const indices = nuevas.map((f, i) => [f, i] as const).filter(([f]) => elegidas.has(f.id)).map(([, i]) => i);
  const orden = a === 'subir' ? [...indices].reverse() : indices;

  for (const i of orden) {
    const destino = a === 'subir' ? i + 1 : i - 1;
    if (destino < 0 || destino >= nuevas.length) continue;
    if (elegidas.has(nuevas[destino].id)) continue;
    [nuevas[i], nuevas[destino]] = [nuevas[destino], nuevas[i]];
  }
  return nuevas;
}

/**
 * COPIAS INDEPENDIENTES de las figuras dadas: ids nuevos y corridas un poco.
 *
 * El corrimiento no es cosmético: una copia exactamente encima de su original es
 * indistinguible de que no haya pasado nada, y el segundo clic vuelve a agarrar
 * la de arriba — se juntan diez copias en el mismo lugar sin que se note.
 */
export function duplicar(figuras: Figura[], desplazamiento = 16): Figura[] {
  return figuras.map((f) => ({ ...moverFigura(f, desplazamiento, desplazamiento), id: nuevoId() }));
}
