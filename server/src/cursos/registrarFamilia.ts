import { eq } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { intereses } from "../db/schema.js";
import type { ProductoCatalogo } from "../cerberus/productos.js";
import { elegirUltimaEdicion } from "./catalogo.js";

/**
 * DE UNA FAMILIA A UNA FILA EN `intereses` — el único lugar donde se escribe.
 *
 * ══ POR QUÉ ESTO SE EXTRAJO ══════════════════════════════════════════════════
 *
 * Ahora hay **dos** caminos que registran un interés a partir de una familia de
 * curso: el clic de la vendedora en «Confirmar» (`cursos/confirmar.ts`, #102) y
 * el bot conversacional cuando el lead dice qué le interesa (`bot/ejecutar.ts`,
 * F3). Lo que se escribe tiene que ser **idéntico** — el nombre CRUDO de la
 * última edición activa de Cerberus, recortado igual, con `producto_id` y `sku`
 * y con la misma política de conflicto—, porque `intereses.curso` es lo que
 * después se cotiza y lo que la compuerta de «Cotizado» exige.
 *
 * Con una copia en cada lado, la divergencia no rompe nada visible: el bot
 * guardaría, por ejemplo, el nombre corto del alias, y esa conversación quedaría
 * con un curso que no existe en el catálogo. Recién se nota al intentar
 * facturarla. Es la lección de #37, aplicada a un insert de ocho líneas.
 *
 * ══ QUÉ **NO** DECIDE ════════════════════════════════════════════════════════
 *
 * De dónde salió la familia. La vendedora confirma una propuesta DERIVADA del
 * anuncio/formulario (y esa derivación se recalcula en el server, nunca viaja
 * desde el cliente); el bot afirma la que el lead le dijo, validada contra
 * `alias_curso`. Son dos preguntas distintas y cada una vive donde tiene que
 * vivir. Acá empieza cuando la familia ya está decidida.
 *
 * ══ FALLA RUIDOSO, NUNCA INVENTA ═════════════════════════════════════════════
 *
 * Si Cerberus no contesta o la familia no tiene ninguna edición activa, devuelve
 * un código explicado. **Jamás registra un nombre parecido**: un curso que no
 * está en el catálogo no se puede cotizar, y una fila equivocada es más cara que
 * una fila que falta.
 */

export type CodigoRegistroInteres =
  /** La familia no tiene ninguna edición activa en el catálogo de Cerberus. */
  | "sin_producto"
  /** Cerberus no respondió. Es distinto de «no hay producto» y se dice distinto. */
  | "catalogo_caido";

export type ResultadoRegistroInteres =
  | { ok: true; curso: string; sku: string; productoId: string; familia: string }
  | { ok: false; codigo: CodigoRegistroInteres; message: string };

export interface OpcionesRegistrarFamilia {
  clave: string;
  /** El SKU-familia (`DIPICOT`), ya decidido por quien llama. */
  familia: string;
  /** Quién se hace cargo: el username de Cerberus, o `bot`. */
  vendedoraId: string;
  /** El catálogo, INYECTADO: el test le pasa una lista, la ruta `buscarProductos`. */
  catalogo: () => Promise<ProductoCatalogo[]>;
  /** Cómo nombrar la familia en el mensaje de error. Por defecto, la familia. */
  etiqueta?: string;
}

/** Lo que la ficha puede mostrar; el mismo recorte que el POST manual. */
const LARGO_CURSO = 120;

export async function registrarInteresDeFamilia(
  base: typeof Base,
  o: OpcionesRegistrarFamilia,
): Promise<ResultadoRegistroInteres> {
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

  const producto = elegirUltimaEdicion(catalogo, o.familia);
  if (!producto) {
    return {
      ok: false,
      codigo: "sin_producto",
      message: `Cerberus no tiene ninguna edición activa de ${o.etiqueta ?? o.familia}: registrá el interés a mano.`,
    };
  }

  // `intereses.curso` guarda el nombre de Cerberus, y el producto queda ATADO
  // (`producto_id`): con un nombre no se arma una cotización, la orden lo pide.
  const curso = producto.nombre.trim().slice(0, LARGO_CURSO);
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

  return { ok: true, curso, sku: producto.sku, productoId: producto.id, familia: o.familia };
}

/** ¿Esta conversación ya tiene algún interés asentado? Lo asentado manda. */
export async function tieneInteresRegistrado(base: typeof Base, clave: string): Promise<boolean> {
  const filas = await base
    .select({ curso: intereses.curso })
    .from(intereses)
    .where(eq(intereses.clave, clave));
  return filas.length > 0;
}
