import type { db } from "../db/client.js";
import type { ProductoCatalogo } from "../cerberus/productos.js";
import { consultarInteresesDerivados } from "./consultarDerivados.js";
import { registrarInteresDeFamilia, tieneInteresRegistrado } from "./registrarFamilia.js";
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
 *
 * ⚠️ **La ESCRITURA no vive acá**: la regla 2 (qué nombre, qué recorte, con qué
 * producto atado y con qué política de conflicto) es `registrarFamilia.ts`,
 * porque el bot conversacional también registra intereses (F3) y las dos filas
 * tienen que ser indistinguibles. Lo que decide este archivo es lo suyo: **de
 * dónde sale la familia** — del anuncio o del formulario, recalculado en el
 * server.
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
  if (await tieneInteresRegistrado(base, o.clave)) {
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

  // De acá en adelante la familia ya está decidida y lo que queda es escribirla:
  // eso vive una sola vez, compartido con el bot. Los dos códigos de error que
  // puede devolver (`sin_producto`, `catalogo_caido`) son dos de los cinco de
  // esta función, así que el resultado se propaga tal cual.
  const r = await registrarInteresDeFamilia(base, {
    clave: o.clave,
    familia: propuesta.familia,
    vendedoraId: o.vendedoraId,
    catalogo: o.catalogo,
    etiqueta: propuesta.curso ?? propuesta.familia,
  });
  if (!r.ok) return r;

  return { ok: true, curso: r.curso, sku: r.sku, familia: r.familia };
}
