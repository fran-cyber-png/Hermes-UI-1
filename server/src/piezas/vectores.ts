import type { DireccionDePieza } from "./direccion.js";
import type { ContenidoDePieza } from "./version.js";

/**
 * LOS VECTORES DE LA COSTURA — el contrato entre el catálogo y el lazo, escrito
 * con números literales para que no se pueda romper por accidente.
 *
 * ══ QUÉ PROBLEMA RESUELVE ═══════════════════════════════════════════════════
 *
 * `version.ts` y `direccion.ts` son la receta única. Pero «una sola receta» es
 * una promesa hasta que algo la verifica, y el modo de fallo que estamos
 * evitando **no rompe ningún test**: si el catálogo publica una versión y el
 * lazo estampa otra, los dos lados siguen verdes en su propia suite y el join
 * entre ellos da **cero filas, en silencio**. Se lee como «esa pieza no se usó
 * nunca» — que es exactamente la conclusión falsa que #169 existe para no sacar.
 *
 * Estos vectores son el candado. Cada uno dice: *para este contenido, esta
 * dirección y esta versión, LITERALES*. Y los dos frentes lo afirman desde su
 * lado:
 *
 *   · el catálogo, que lo que **publica** para esa pieza es esta versión;
 *   · el lazo, que lo que **estampa** en `envios_wa` para esa misma pieza es
 *     esta versión y esta `ref`.
 *
 * Si cualquiera de los dos cambia su receta, los literales de acá dejan de
 * casar y el test se cae **en la rama que lo cambió**, no meses después en un
 * reporte que nadie sabe leer. Es la misma disciplina que
 * `urgencia.paridad.test.db.ts` (#37): la única defensa contra dos
 * implementaciones de la misma verdad es un test que las compare.
 *
 * ══ CÓMO SE ACTUALIZA (si de verdad hay que hacerlo) ════════════════════════
 *
 * Cambiar un literal de acá **invalida todo lo ya acumulado en `envios_wa`**:
 * los envíos viejos quedan con la versión vieja y los nuevos con otra, y una
 * pieza que no cambió parece haber cambiado. O sea: no es un archivo que se
 * «arregla» para que el test pase. Si la receta tiene que cambiar de verdad, va
 * con su ADR y con la decisión explícita de qué pasa con lo acumulado.
 *
 * Los valores salieron de correr la receta, no de escribirlos a mano.
 */

// ── Los contenidos, en un solo lugar para que los dos vectores hablen de lo mismo ──

/** Un dato recomendado (#153): la frase que se dijo 2 veces en 1.876 conversaciones. */
export const TEXTO_CUOTAS = "Se puede pagar en 2 cuotas, sin recargo.";

/** Un acuse fuera de horario: sintaxis `{{doble}}`, la de `autorespuesta/plantillas.ts`. */
export const TEXTO_ACUSE =
  "Hola{{saludo}} 🙌 gracias por escribirnos por {{curso}}. Te respondemos a las {{hora_apertura}}.";

/** Un gancho de campaña: media frase, no un mensaje. */
export const TEXTO_GANCHO = "que trabaja el área de inteligencia";

/** El paso 1 de la secuencia de venta: texto + flyer. **El 42 % lleva imagen.** */
export const PASO_FLYER: ContenidoDePieza = {
  texto: "Hola {nombre}, te dejo el flyer del {curso} 👇",
  archivo: "flyer-julio.jpg",
};

/**
 * EL MISMO paso con el flyer de agosto. El texto no cambió ni una letra: lo que
 * cambió es la imagen, y **en Goberna el precio y las fechas viven adentro de la
 * imagen**. Si su versión fuera la misma que la de arriba, los resultados de dos
 * ofertas distintas se sumarían.
 */
export const PASO_FLYER_AGOSTO: ContenidoDePieza = {
  ...PASO_FLYER,
  archivo: "flyer-agosto-PRECIO-NUEVO.jpg",
};

/** El paso 2: solo texto, con el `{precio}` sin resolver. */
export const PASO_PRECIO: ContenidoDePieza = {
  texto: "El precio es {precio}. ¿Te reservo el cupo?",
  archivo: null,
};

// ── Los vectores ────────────────────────────────────────────────────────────

/** Una pieza que es UN mensaje: un hecho, un acuse, un gancho. */
export interface VectorDeMensaje {
  /** Para que el fallo del test diga cuál se rompió. */
  nombre: string;
  direccion: DireccionDePieza;
  /** Lo que va en `envios_wa.pieza_ref`, literal. */
  ref: string;
  contenido: ContenidoDePieza;
  /** Lo que publica el catálogo y lo que estampa el lazo. El mismo valor. */
  version: string;
}

export const VECTORES_DE_MENSAJE: readonly VectorDeMensaje[] = [
  {
    nombre: "hecho · cuotas",
    direccion: { clase: "hecho", id: "cuotas" },
    ref: "cuotas",
    contenido: { texto: TEXTO_CUOTAS },
    version: "sha256:3ff1953f5af0a2f7",
  },
  {
    nombre: "acuse · fuera-de-horario-primer-contacto",
    direccion: { clase: "acuse", id: "fuera-de-horario-primer-contacto" },
    ref: "fuera-de-horario-primer-contacto",
    contenido: { texto: TEXTO_ACUSE },
    version: "sha256:0cd792d6a619cb96",
  },
  {
    nombre: "gancho · inteligencia",
    direccion: { clase: "gancho", id: "inteligencia" },
    ref: "inteligencia",
    contenido: { texto: TEXTO_GANCHO },
    version: "sha256:9fb26571e4539b02",
  },
  {
    nombre: "contenido vacío — es una versión, no un «no sabemos»",
    direccion: { clase: "hecho", id: "vacio" },
    ref: "vacio",
    contenido: { texto: "" },
    version: "sha256:390feabc786e369e",
  },
];

/**
 * Una plantilla-secuencia: la pieza entera **y cada uno de sus pasos**.
 *
 * Los dos niveles importan y son de dueños distintos: el catálogo publica la
 * plantilla (`{clase:"plantilla", id:"12"}`) porque un paso no tiene id estable
 * propio, y el lazo estampa el paso (`ref:"12#3"`) porque el flyer y el
 * seguimiento funcionan distinto. **Es la misma dirección con `orden` o sin él**,
 * no dos vocabularios.
 */
export interface VectorDeSecuencia {
  nombre: string;
  plantillaId: string;
  pasos: readonly ContenidoDePieza[];
  /** La ref de la plantilla entera. */
  ref: string;
  /** La versión de la secuencia — lo que publica el catálogo para la plantilla. */
  version: string;
  /** La ref de cada paso, en orden — lo que estampa el lazo. */
  refsDePaso: readonly string[];
  /** La versión de cada paso, en orden. */
  versionesDePaso: readonly string[];
}

export const VECTORES_DE_SECUENCIA: readonly VectorDeSecuencia[] = [
  {
    nombre: "secuencia 12 · flyer de julio",
    plantillaId: "12",
    pasos: [PASO_FLYER, PASO_PRECIO],
    ref: "12",
    version: "sha256:363122842aa34071",
    refsDePaso: ["12#1", "12#2"],
    versionesDePaso: ["sha256:97ddb49e06f65c7b", "sha256:8f503eaeccc7fc3e"],
  },
  {
    nombre: "secuencia 12 · el MISMO texto con el flyer de agosto",
    plantillaId: "12",
    pasos: [PASO_FLYER_AGOSTO, PASO_PRECIO],
    ref: "12",
    version: "sha256:5db029910023507c",
    refsDePaso: ["12#1", "12#2"],
    versionesDePaso: ["sha256:e3ceadd2d1b49ace", "sha256:8f503eaeccc7fc3e"],
  },
];
