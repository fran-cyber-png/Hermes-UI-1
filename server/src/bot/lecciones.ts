import { and, eq, isNull, or } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { lecciones } from "../db/lecciones.js";

/**
 * LO QUE EL BOT LLEVA PUESTO — las Lecciones publicadas (#259).
 *
 * ⚠️ **El filtro por `publicada` es la garantía entera de este frente.** Si acá
 * entrara un borrador, escribir una Lección para probarla sería aplicarla a
 * personas reales, y la pantalla de entrenamiento pasaría de ser un lugar donde
 * se experimenta a ser un lugar donde se publica sin querer.
 *
 * Degrada como el resto de los catálogos del bot: sin la tabla migrada devuelve
 * vacío y el bot conversa sin lecciones, que es exactamente lo que hace hoy.
 */
export async function leccionesVigentes(
  base: typeof Base,
  numeroPropio: string,
): Promise<string[]> {
  try {
    const filas = await base
      .select({ texto: lecciones.texto })
      .from(lecciones)
      .where(
        and(
          eq(lecciones.estado, "publicada"),
          // Las de esta línea y las que valen para todas.
          or(isNull(lecciones.numeroPropio), eq(lecciones.numeroPropio, numeroPropio)),
        ),
      )
      .orderBy(lecciones.id);
    return filas.map((f) => f.texto);
  } catch {
    // Tabla sin migrar: el bot sigue sin lecciones, como antes.
    return [];
  }
}

/**
 * Las que se están probando, para que una Corrida pueda correr CONTRA el
 * borrador sin que el bot vivo se entere.
 *
 * Se piden aparte y no con un flag en `leccionesVigentes` a propósito: un
 * booleano `incluirBorradores` es exactamente la clase de parámetro que alguien
 * pasa en `true` desde el lugar equivocado. Dos funciones con nombres distintos
 * no se confunden.
 */
export async function leccionesEnPrueba(
  base: typeof Base,
  numeroPropio: string,
): Promise<string[]> {
  try {
    const filas = await base
      .select({ texto: lecciones.texto })
      .from(lecciones)
      .where(
        and(
          or(eq(lecciones.estado, "publicada"), eq(lecciones.estado, "borrador")),
          or(isNull(lecciones.numeroPropio), eq(lecciones.numeroPropio, numeroPropio)),
        ),
      )
      .orderBy(lecciones.id);
    return filas.map((f) => f.texto);
  } catch {
    return [];
  }
}
