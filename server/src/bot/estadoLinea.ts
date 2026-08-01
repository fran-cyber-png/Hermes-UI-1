/**
 * EL INTERRUPTOR DE LA BASE — apagar el bot sin deploy.
 *
 * ── El problema que resuelve ─────────────────────────────────────────────
 *
 * La tabla `bot_estado` (modo y freno POR LÍNEA) existe desde el primer día y
 * **nadie la leía**: el modo salía de `BOT_MODO` en el `.env`. O sea que apagar
 * una máquina que le está escribiendo a leads reales costaba un `ssh`, editar un
 * archivo y reiniciar el server — el mismo agujero que la auto-respuesta ya
 * había cerrado con `PUT /api/autorespuesta/modo` (ADR 0015).
 *
 * ── La precedencia, y por qué es esta ────────────────────────────────────
 *
 *   **la fila de la base gana al entorno.**
 *
 * El entorno es lo que el operador decidió al desplegar; la fila es lo que
 * alguien decidió recién, mirando la conversación. Si el entorno ganara, apagar
 * desde la app sería una sugerencia — y un kill-switch que se puede ignorar no
 * es un kill-switch.
 *
 * **Sin fila, manda el entorno**: una línea que nunca se tocó desde la app se
 * comporta exactamente como antes de este cambio.
 *
 * ── Degrada, nunca tumba ─────────────────────────────────────────────────
 *
 * Sin la tabla migrada, `leerEstadoLinea` devuelve `null` en los dos campos y el
 * bot se comporta como el de ayer. **Pero lo dice una vez por proceso**: una
 * degradación silenciosa acá significa «creí que lo había apagado y seguía
 * mandando», que es el peor de los dos errores posibles.
 */

import { eq } from "drizzle-orm";
import type { db as Base } from "../db/client.js";
import { botEstado } from "../db/bot.js";
import { modoValido, type ModoBot } from "./modo.js";

export interface EstadoLinea {
  /** `null` = la base no opina; manda el entorno. */
  modo: ModoBot | null;
  /** `null` = no está frenada. Cualquier texto = frenada, y el texto es el porqué. */
  frenadoMotivo: string | null;
}

export const ESTADO_LINEA_SIN_OPINION: EstadoLinea = { modo: null, frenadoMotivo: null };

let yaAvisoFaltaTabla = false;

export async function leerEstadoLinea(
  base: typeof Base,
  numeroPropio: string,
): Promise<EstadoLinea> {
  try {
    const fila = await base.query.botEstado.findFirst({
      where: eq(botEstado.numeroPropio, numeroPropio),
    });
    if (!fila) return ESTADO_LINEA_SIN_OPINION;
    return {
      // `modoValido` con `porDefecto: null` no existe (el tipo pide un ModoBot),
      // así que se pregunta antes: una fila con un modo basura NO puede
      // silenciosamente convertirse en «sombra» y hacer creer que alguien lo eligió.
      modo: fila.modo ? modoValido(fila.modo, "sombra", avisarModoRaro) : null,
      frenadoMotivo: fila.frenadoMotivo?.trim() || null,
    };
  } catch {
    if (!yaAvisoFaltaTabla) {
      yaAvisoFaltaTabla = true;
      console.warn(
        "[bot] `bot_estado` no está disponible: el modo sale del entorno y el " +
          "kill-switch de la app NO tiene efecto. Aplicá la migración.",
      );
    }
    return ESTADO_LINEA_SIN_OPINION;
  }
}

function avisarModoRaro(mensaje: string): void {
  console.warn(`${mensaje} (venía de la fila de bot_estado)`);
}

/**
 * Escribe el modo de una línea. Devuelve `false` si la tabla no está —el que
 * llama tiene que poder contestarle a la vendedora «no se pudo», nunca un OK
 * falso sobre un interruptor.
 */
export async function fijarModoLinea(
  base: typeof Base,
  numeroPropio: string,
  modo: ModoBot,
  quien: string,
): Promise<boolean> {
  try {
    await base
      .insert(botEstado)
      .values({
        numeroPropio,
        modo,
        actualizadoEn: new Date(),
        actualizadoPor: quien,
      })
      .onConflictDoUpdate({
        target: botEstado.numeroPropio,
        set: { modo, actualizadoEn: new Date(), actualizadoPor: quien },
      });
    return true;
  } catch {
    return false;
  }
}

/**
 * Frena o desfrena una línea. El freno es la parada de emergencia: no cambia el
 * modo (para que al soltarlo se vuelva a donde estaba), solo bloquea.
 */
export async function fijarFrenoLinea(
  base: typeof Base,
  numeroPropio: string,
  motivo: string | null,
  quien: string,
): Promise<boolean> {
  try {
    await base
      .insert(botEstado)
      .values({
        numeroPropio,
        frenadoMotivo: motivo,
        actualizadoEn: new Date(),
        actualizadoPor: quien,
      })
      .onConflictDoUpdate({
        target: botEstado.numeroPropio,
        set: { frenadoMotivo: motivo, actualizadoEn: new Date(), actualizadoPor: quien },
      });
    return true;
  } catch {
    return false;
  }
}
