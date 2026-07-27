import { CLASE_CON_PASOS, direccionDesdeRef } from "../piezas/direccion.js";
import {
  procedenciaDesdeColumnas,
  versionDePieza,
  type ContenidoDePieza,
  type Procedencia,
} from "./pieza.js";

/**
 * DE QUÉ PIEZA SALIÓ LO QUE LA VENDEDORA MANDÓ DESDE LA CAJA (épica #169).
 *
 * El bloque de datos recomendados (#153) y las dos respuestas del panel **no
 * envían**: dejan el texto en el composer y ella manda (la regla de #45). El
 * server no tiene forma de saber de dónde salió ese texto, así que la pantalla
 * lo declara — incluido si lo reescribió antes de mandar.
 *
 * ══ POR QUÉ ESTE MÓDULO EXISTE, Y NO ES UN `if` EN LA RUTA ═══════════════════
 *
 * Porque **la versión de una plantilla NO se puede calcular con lo que mandó el
 * cliente**, y calcularla igual dejaba el join en cero justo para la pieza que
 * más importa. Medido sobre `PASO_FLYER` de `piezas/vectores.ts` —el paso 1 con
 * imagen, cuya versión publicada es un valor literal del contrato—:
 *
 *   catálogo publica (12#1)      sha256:97ddb49e06f65c7b
 *   `enviar-paso` estampa        sha256:97ddb49e06f65c7b   CASA
 *   el composer estampaba        sha256:c7fd30aec30cb2bc   *** NO CASA ***
 *
 * Y no fallaba por una razón sino por dos, las dos estructurales:
 *
 *   1. **El archivo no viaja.** `PiezaDeclarada` (el contrato del front) lleva
 *      `textoPieza` y nada más, porque el front nunca supo el nombre del archivo
 *      —`GET /api/sugerencias` le manda `conImagen: boolean`, no el nombre—. El
 *      42 % de la secuencia de venta lleva imagen y en Goberna el precio vive
 *      DENTRO del flyer: sin el archivo, la versión es otra.
 *   2. **El texto que viaja ya está RESUELTO.** En la caja cae
 *      `vistaPrevia.texto`, que el server expandió con el `{nombre}` y el
 *      `{precio}` de ESA persona (`routes/sugerencias.ts`). Hashear eso hace de
 *      **cada destinatario una versión distinta** — medido: la misma pieza da
 *      `sha256:c7fd30ae…` para Ana y `sha256:5adf571e…` para Javier—, que es
 *      exactamente lo que `piezas/version.ts` dice que el versionado no puede
 *      hacer.
 *
 * Ninguna de las dos se arregla mandando más campos desde el navegador: el
 * contenido autoral de un paso vive en `plantilla_pasos` y **se lee de ahí**, la
 * misma fila que lee `POST /api/plantillas/:id/enviar-paso`. Por eso el lector
 * va INYECTADO: el criterio se prueba sin base, y la ruta es la única que sabe
 * de dónde sale la fila.
 *
 * ══ EL `hecho` NO PASA POR AHÍ, Y ESTÁ BIEN ═════════════════════════════════
 *
 * Un dato recomendado cae en la caja con el texto del catálogo tal cual (sin
 * marcadores que resolver, sin archivo: la tabla `hechos` no tiene media). Ahí
 * hashear lo que llegó es MÁS fiel que releer la fila: si alguien editó el
 * catálogo entre que ella abrió el panel y apretó enviar, lo que salió fue el
 * texto viejo, y la versión estampada tiene que ser la de ese texto.
 *
 * ══ ANTE CUALQUIER DUDA, LA LÍNEA DE BASE ═══════════════════════════════════
 *
 * Un cuerpo raro no se convierte en una pieza inventada. Y una plantilla que no
 * se pudo leer conserva `clase`/`ref` con **versión `null`**, que en este modelo
 * significa una sola cosa —«no se pudo determinar el contenido»— y nunca se
 * mezcla con una versión conocida. Perder una versión es barato; inventarla es
 * el error que este trabajo existe para no cometer.
 */

/**
 * Cómo se lee el contenido AUTORAL de un paso: el texto GUARDADO (con sus
 * `{nombre}`/`{curso}`/`{precio}` sin resolver) y el archivo adjunto.
 * `null` = no se pudo leer (la plantilla se borró, no es visible para ella…).
 */
export type LeerPasoDeSecuencia = (plantillaId: number, orden: number) => Promise<ContenidoDePieza | null>;

/** Un id de plantilla que se pueda mirar en la base: entero positivo y nada más. */
function idDePlantilla(id: string): number | null {
  return /^[1-9][0-9]*$/.test(id) ? Number(id) : null;
}

export async function procedenciaDelComposer(
  pieza: unknown,
  leerPaso: LeerPasoDeSecuencia,
): Promise<Procedencia | undefined> {
  if (!pieza || typeof pieza !== "object") return undefined;
  const p = pieza as Record<string, unknown>;

  const clase = typeof p.clase === "string" ? p.clase : null;
  const ref = typeof p.ref === "string" && p.ref.length <= 120 ? p.ref : null;
  const direccion = direccionDesdeRef(clase, ref);

  // Una plantilla NUNCA se versiona con lo que mandó el navegador: su contenido
  // autoral vive en `plantilla_pasos` y de ahí sale, o no sale (`null` = no se
  // pudo determinar). Vale también para una `ref` de plantilla sin paso o con un
  // id que no se puede mirar en la base: ahí tampoco hay nada que hashear, y
  // caer al texto sería volver a la versión inventada por otra puerta.
  const esPlantilla = direccion?.clase === CLASE_CON_PASOS;
  const idPaso = esPlantilla && direccion.orden !== undefined ? idDePlantilla(direccion.id) : null;

  let contenido: ContenidoDePieza | null = null;
  if (idPaso !== null) {
    contenido = await leerPaso(idPaso, direccion!.orden!);
  } else if (!esPlantilla) {
    // Un `hecho` cae en la caja con el texto del catálogo tal cual: ahí ese texto
    // ES la pieza. El tope de largo es el mismo de siempre.
    contenido = typeof p.textoPieza === "string" && p.textoPieza.length <= 4000 ? { texto: p.textoPieza } : null;
  }

  const leida = procedenciaDesdeColumnas({
    piezaClase: clase,
    piezaRef: ref,
    // LA VERSIÓN LA CALCULA EL SERVER, no el cliente. Que el hash lo hiciera el
    // navegador significaría que dos clientes con distinta normalización parten
    // en dos la historia de una pieza sin que nadie lo note.
    piezaVersion: versionDePieza(contenido),
    piezaVia: typeof p.via === "string" ? p.via : null,
    piezaEditada: p.editada === true,
    // El momento NO viaja desde el cliente: lo clasifica el server en
    // `enviarYProyectar`, con la misma cabeza que decide qué mandar.
    momentoVenta: null,
  });
  return leida.tipo === "pieza" ? leida : undefined;
}
