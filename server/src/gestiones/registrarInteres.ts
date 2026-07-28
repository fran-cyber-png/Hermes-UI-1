import type { db } from "../db/client.js";
import { intereses } from "../db/schema.js";
import type { ProductoCatalogo } from "../cerberus/productos.js";

/**
 * REGISTRAR UN INTERÉS A MANO, PERO ATADO AL CATÁLOGO.
 *
 * ══ EL DEFECTO QUE ARREGLA ═══════════════════════════════════════════════════
 *
 * El buscador del panel pregunta `/api/venta/productos`, recibe productos del
 * catálogo de Cerberus **con su `id` y su `sku`**, la vendedora elige uno… y el
 * POST mandaba únicamente `{clave, curso}`. O sea: el front tenía el producto en
 * la mano y guardaba sólo su nombre.
 *
 * Y con un nombre no se arma una cotización — la orden que va a Cerberus pide
 * `producto_id`. Ese era el eslabón que separaba «sabemos qué quiere» de «el
 * carrito viene precargado».
 *
 * ══ LAS TRES REGLAS ══════════════════════════════════════════════════════════
 *
 * 1. **El NOMBRE lo pone el catálogo, no el cliente.** Si viene `productoId`, se
 *    resuelve contra el catálogo vivo y se guarda el nombre de ESE producto,
 *    ignorando el `curso` que mandó el navegador. Es la misma regla que
 *    `confirmarInteresDerivado`, y por el mismo motivo: el caché persistido
 *    sobrevive al cierre de la app (ADR 0007), así que un nombre viejo cacheado
 *    registraría un producto que ya no se llama así — y `intereses.curso` es lo
 *    que después se cotiza.
 *
 * 2. **Si no se puede verificar, se registra IGUAL pero sin atar.** Cerberus se
 *    cae seguido (de ahí el techo de 12 s del panel). Hoy la vendedora puede
 *    anotar un interés con Cerberus caído, y perder eso sería una regresión:
 *    anotar lo que escuchó es lo único que queda del chat. Así que se degrada al
 *    camino de texto —`producto_id: null`— y **se avisa** con `vinculado: false`.
 *    Lo que NO se hace es inventar el vínculo: un `producto_id` sin verificar es
 *    peor que ninguno, porque se ve verdadero y termina cotizando otra cosa.
 *
 * 3. **Sin `productoId` no se adivina por nombre.** Buscar el producto cuyo
 *    nombre coincida con el texto sería una TERCERA derivación (ya hay dos, y
 *    divergen en 6 SKUs). El texto libre se guarda como texto libre.
 */

export interface OpcionesRegistrarInteres {
  clave: string;
  /** Lo que mandó el navegador. Se usa tal cual sólo si NO hay producto que resolver. */
  curso: string;
  /** `codigo_producto` de Cerberus. Ausente = interés de texto libre. */
  productoId?: string | null;
  vendedoraId: string;
  /**
   * De dónde sale el catálogo. INYECTADO para poder testear la regla sin red
   * (el test le pasa una lista literal; la ruta, `buscarProductos`).
   */
  catalogo: () => Promise<ProductoCatalogo[]>;
}

export interface ResultadoRegistro {
  /** El nombre que quedó asentado — el del catálogo si se pudo resolver. */
  curso: string;
  /** `true` sólo si la fila quedó atada a un producto real del catálogo. */
  vinculado: boolean;
  sku: string | null;
  /**
   * Por qué no se ató, cuando `vinculado` es `false` y se había pedido atar.
   * `null` cuando no se pidió (texto libre) o cuando salió bien.
   */
  motivo: "catalogo_caido" | "producto_inexistente" | null;
}

export async function registrarInteres(
  base: typeof db,
  o: OpcionesRegistrarInteres,
): Promise<ResultadoRegistro> {
  const pedido = (o.productoId ?? "").trim();

  let producto: ProductoCatalogo | null = null;
  let motivo: ResultadoRegistro["motivo"] = null;

  if (pedido !== "") {
    try {
      const lista = await o.catalogo();
      producto = lista.find((p) => p.id === pedido) ?? null;
      // Se pidió atar a un producto y el catálogo contestó sin tenerlo: o lo
      // dieron de baja entre la búsqueda y el clic, o el id no es de este
      // catálogo. En los dos casos atarlo sería afirmar algo falso.
      if (!producto) motivo = "producto_inexistente";
    } catch {
      // Cerberus no contestó. NO es lo mismo que «ese producto no existe», y por
      // eso el motivo es distinto: acá se puede reintentar y ahí no.
      motivo = "catalogo_caido";
    }
  }

  // 120 caracteres es lo que la ficha puede mostrar — el mismo recorte que hace
  // `confirmarInteresDerivado`, para que las dos puertas no guarden distinto.
  const curso = (producto?.nombre ?? o.curso).trim().slice(0, 120);

  await base
    .insert(intereses)
    .values({
      clave: o.clave,
      curso,
      productoId: producto?.id ?? null,
      sku: producto?.sku ?? null,
      vendedoraId: o.vendedoraId,
    })
    .onConflictDoNothing();

  return { curso, vinculado: producto !== null, sku: producto?.sku ?? null, motivo };
}
