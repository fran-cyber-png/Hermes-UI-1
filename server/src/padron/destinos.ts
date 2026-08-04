import type { db } from "../db/client.js";
import { numeroVendedora, repartoRueda } from "../db/schema.js";
import { destinosPosibles } from "../reparto/destino.js";

/**
 * A QUIÉN SE LE PUEDE HABILITAR UN CONTACTO.
 *
 * Mismo problema que el reparto de conversaciones, misma respuesta: Hermes **no
 * tiene padrón de usuarios** —el login es un handshake contra Django y solo
 * devuelve «entró» o «no entró»—, así que un dedazo (`ventas1` por `ventas11`)
 * escribe una fila perfectamente válida, los contactos desaparecen del pozo
 * común, no le aparecen a nadie, y **no hay ningún síntoma**. El supervisor
 * cree que repartió 300 contactos y no los tiene nadie.
 *
 * ── Por qué acá no se pregunta por línea ──
 * `routes/reparto.ts` arma los destinos de UNA línea, porque una conversación
 * llega por una línea. Un contacto del padrón no llegó por ninguna: nunca
 * escribió. Así que la lista válida es **todas las ruedas más todo el mapa** —
 * cualquiera que Hermes conozca de algún lado. Sigue siendo la misma pregunta
 * que responde `destino.ts` («¿este nombre existe?») y por eso se reusa su
 * función en vez de escribir una segunda: dos listas de personas válidas
 * divergen, y la que divergiera acá lo haría en silencio.
 *
 * Las INACTIVAS de la rueda entran a propósito, igual que en el reparto: sacar a
 * alguien de la rueda es dejar de darle leads nuevos, no prohibirle recibir un
 * lote a mano.
 */
export async function destinosDelPadron(base: typeof db): Promise<string[]> {
  const [rueda, mapa] = await Promise.all([
    base.select({ vendedoraId: repartoRueda.vendedoraId }).from(repartoRueda),
    base.select({ vendedoraId: numeroVendedora.vendedoraId }).from(numeroVendedora),
  ]);
  return destinosPosibles({
    rueda: rueda.map((f) => f.vendedoraId),
    mapa: mapa.map((f) => f.vendedoraId),
  });
}
