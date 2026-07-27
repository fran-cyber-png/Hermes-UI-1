import type { db } from "../db/client.js";
import { estadoDeLaVenta } from "../sugerencias/consultarSugerencias.js";
import { momentoDeVenta, type MomentoDeVenta } from "../sugerencias/estado.js";

/**
 * EN QUÉ PUNTO DE LA VENTA SALIÓ ESTE MENSAJE — y el vocabulario es el de
 * siempre, no uno nuevo.
 *
 * La épica #169 lo dice explícito: «la clasificación del contexto de un envío
 * tiene que salir de ahí». «Ahí» es `momentoDeVenta()` + `ContextoPlantilla` de
 * `sugerencias/estado.ts`, la MISMA cabeza que ya elige las dos respuestas del
 * panel, los datos recomendados y el acuse nocturno. Un quinto vocabulario
 * volvería incomparables las cuatro cosas justo cuando por fin se pueden medir
 * juntas.
 *
 * ══ POR QUÉ SE GUARDA, SI TODO LO DEMÁS SE DERIVA ════════════════════════════
 *
 * El resultado se deriva (ADR 0013/0014/0015): se puede recalcular porque los
 * hechos que lo producen no se borran. El momento **no**: es una foto del
 * estado de la conversación en el instante de decidir, y esa conversación
 * siguió. Recalcularlo tres semanas después daría «cotizada» para un mensaje
 * que salió cuando era «primer-contacto», y ese error no se nota — se lee como
 * un dato.
 *
 * Es el mismo criterio de `campana_fuente` (ADR 0018): lo que se guarda es el
 * **porqué de una decisión ya tomada**, no un veredicto reconstruible.
 *
 * ══ BEST-EFFORT, SIEMPRE ═════════════════════════════════════════════════════
 *
 * Esto corre en el camino caliente de un envío. **Nunca puede impedir que un
 * mensaje salga**: si la consulta falla o la referencia no es una conversación,
 * devuelve `null` y el envío sigue. Un envío sin momento es un envío que
 * después se cuenta con menos detalle; un envío que no salió por culpa de una
 * métrica sería un bug de los que cuestan una venta.
 */
export async function momentoDelEnvio(
  base: typeof db,
  referencia: string,
): Promise<MomentoDeVenta | null> {
  // Un comentario suelto (`int:<id>`) o una referencia rara no tienen hilo del
  // que sacar un momento. No es un error: es que no aplica.
  if (!referencia?.startsWith("conv:")) return null;

  try {
    return momentoDeVenta(await estadoDeLaVenta(base, { clave: referencia }));
  } catch (e) {
    console.warn(
      `[procedencia] no se pudo clasificar el momento de ${referencia}: ${(e as Error).message} — ` +
        `el envío sigue, la fila queda sin momento`,
    );
    return null;
  }
}
