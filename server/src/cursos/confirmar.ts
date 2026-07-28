import { eq } from "drizzle-orm";
import type { db } from "../db/client.js";
import { intereses } from "../db/schema.js";
import type { ProductoCatalogo } from "../cerberus/productos.js";
import { elegirUltimaEdicion } from "./catalogo.js";
import { consultarInteresesDerivados } from "./consultarDerivados.js";
import type { AliasCurso } from "./alias.js";

/**
 * CONFIRMAR LA PROPUESTA — el ÚNICO camino por el que un interés derivado se
 * vuelve una fila (#102).
 *
 * Todo lo demás en esta carpeta es derivación pura, que no escribe nada. Acá se
 * escribe, y por eso hay dos reglas:
 *
 * 1. **La propuesta se recalcula del lado del server.** El cliente manda la
 *    conversación, nunca el curso: si mandara el nombre, cualquiera podría
 *    asentar cualquier cosa a nombre de la vendedora, y una propuesta vieja
 *    cacheada en el front (ADR 0007: el caché sobrevive al cierre de la app)
 *    registraría un curso que ya no corresponde.
 * 2. **Se guarda el nombre CRUDO del producto de Cerberus**, la última edición
 *    activa de la familia — nunca el nombre corto del chip. `intereses.curso` es
 *    lo que después se cotiza; un «Inteligencia y Contrainteligencia» a secas no
 *    existe en el catálogo y no se puede facturar.
 *
 * FALLA RUIDOSO, como el proxy de Ivi: si Cerberus no contesta o la familia no
 * tiene ningún producto activo, devuelve un código de error explicado — jamás
 * inventa un nombre parecido ni registra el chip.
 */

export type CodigoConfirmacion =
  /** Ya hay un interés asentado: no había nada que confirmar (y lo asentado manda). */
  | "ya_registrado"
  /** Esa conversación no tiene de dónde derivar (ni anuncio ni formulario). */
  | "sin_propuesta"
  /** Hay texto de origen pero ningún alias lo mapea: se registra a mano. */
  | "sin_mapeo"
  /** La familia no tiene ninguna edición activa en el catálogo de Cerberus. */
  | "sin_producto"
  /** Cerberus no respondió. Es distinto de «no hay producto» y se dice distinto. */
  | "catalogo_caido";

export type ResultadoConfirmacion =
  | { ok: true; curso: string; sku: string; familia: string }
  | { ok: false; codigo: CodigoConfirmacion; message: string };

export interface OpcionesConfirmar {
  clave: string;
  vendedoraId: string;
  /**
   * De dónde sale el catálogo. INYECTADO para poder testear la confirmación sin
   * red (el test le pasa una lista literal; la ruta, `buscarProductos`).
   */
  catalogo: () => Promise<ProductoCatalogo[]>;
  /** Los alias a usar. Por defecto, los activos de la tabla. */
  aliases?: readonly AliasCurso[];
}

export async function confirmarInteresDerivado(
  base: typeof db,
  o: OpcionesConfirmar,
): Promise<ResultadoConfirmacion> {
  const registrados = await base
    .select({ curso: intereses.curso })
    .from(intereses)
    .where(eq(intereses.clave, o.clave));
  if (registrados.length > 0) {
    return {
      ok: false,
      codigo: "ya_registrado",
      message: "Esta conversación ya tiene un interés registrado: ese manda.",
    };
  }

  const derivados = await consultarInteresesDerivados(base, {
    claves: [o.clave],
    registradosPorClave: {},
    aliases: o.aliases,
  });
  const propuesta = derivados[o.clave];
  if (!propuesta) {
    return {
      ok: false,
      codigo: "sin_propuesta",
      message: "Esta conversación no dice de qué curso vino: registrá el interés a mano.",
    };
  }
  if (!propuesta.familia) {
    return {
      ok: false,
      codigo: "sin_mapeo",
      message: `«${propuesta.textoOrigen}» no está mapeado a ningún curso: buscalo y registralo a mano.`,
    };
  }

  let catalogo: ProductoCatalogo[];
  try {
    catalogo = await o.catalogo();
  } catch (err) {
    return {
      ok: false,
      codigo: "catalogo_caido",
      message: `Cerberus no respondió el catálogo (${(err as Error).message}) — probá de nuevo en un rato.`,
    };
  }

  const producto = elegirUltimaEdicion(catalogo, propuesta.familia);
  if (!producto) {
    return {
      ok: false,
      codigo: "sin_producto",
      message: `Cerberus no tiene ninguna edición activa de ${propuesta.curso ?? propuesta.familia}: registrá el interés a mano.`,
    };
  }

  // El mismo recorte que el POST manual: `intereses.curso` guarda el nombre de
  // Cerberus, y 120 caracteres es lo que la ficha puede mostrar.
  const curso = producto.nombre.trim().slice(0, 120);
  // Y EL PRODUCTO, que hasta acá se calculaba y se tiraba: esta función ya había
  // recorrido campaña/anuncio → familia → última edición activa → producto y
  // devolvía `{curso, sku, familia}`, pero el insert guardaba sólo el nombre.
  // Con un nombre no se arma una cotización —la orden pide `producto_id`—, así
  // que ése era exactamente el eslabón que faltaba para precargar el carrito.
  await base
    .insert(intereses)
    .values({
      clave: o.clave,
      curso,
      productoId: producto.id,
      sku: producto.sku,
      vendedoraId: o.vendedoraId,
    })
    .onConflictDoNothing();

  return { ok: true, curso, sku: producto.sku, familia: propuesta.familia };
}
