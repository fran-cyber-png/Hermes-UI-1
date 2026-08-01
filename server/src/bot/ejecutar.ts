/**
 * Ejecución de acciones del bot — el puente entre "lo que el agente decidió"
 * y "lo que se escribe en la base".
 *
 * Separa los efectos del pipeline: el orquestador solo llama a `ejecutarAcciones`
 * y este módulo se ocupa de las tablas. Si una tabla no existe, degrada sin tumbar.
 *
 * ── ESCALAR NO ES PAUSAR, Y ANTES ERAN LO MISMO ──────────────────────────
 *
 * Las dos acciones escribían `bot_pausas` con `hasta: null`, y `decision.ts`
 * trata una pausa sin vencimiento como **definitiva**. O sea que preguntar algo
 * que no estaba en el catálogo —«¿cuál es el temario?»— dejaba al bot mudo para
 * siempre en esa conversación, aunque el lead volviera a escribir diez veces.
 * Pasó en producción con un lead real y se destrabó borrando la fila a mano.
 *
 * Ahora son dos cosas distintas, porque son dos cosas distintas:
 *
 *   · **pausar** (rechazo · despedida) → `hasta: null`. La persona dijo que no.
 *     Esa es la única pausa que debe ser para siempre.
 *   · **escalar** (los seis motivos) → `hasta: ahora + GRACIA_ESCALADA`. Es un
 *     pedido de ayuda, no un cierre: le da a la vendedora una ventana para
 *     tomar la conversación, y si no la toma el bot vuelve en vez de dejar el
 *     lead colgado.
 *
 * La ventana es segura **porque `vendedora_activa` volvió a andar** (`frenos.ts`):
 * si la vendedora respondió, el bot no vuelve aunque la pausa haya vencido. Sin
 * ese freno vivo, esto sería el bot pisando a una persona. Los dos cambios van
 * juntos a propósito.
 */

import { db } from "../db/client.js";
import { botPausas, botCalificaciones } from "../db/bot.js";
import type { Accion } from "./acciones.js";

/**
 * Cuánto se le da a una persona para tomar una conversación escalada.
 *
 * Dos horas: menos que un turno de trabajo (para que el lead no espere el día
 * entero) y más que el tiempo de ir a almorzar. No es un número medido —no hay
 * con qué medirlo todavía—, es un default deliberadamente conservador que se
 * ajusta cuando `bot_calificaciones` tenga lectores y se pueda ver cuánto tarda
 * de verdad una vendedora en tomar una escalada.
 */
export const GRACIA_ESCALADA_MS = 2 * 60 * 60 * 1000;

export async function ejecutarAcciones(
  acciones: Accion[],
  clave: string,
  ahora: Date = new Date(),
): Promise<void> {
  for (const accion of acciones) {
    await ejecutarUna(accion, clave, ahora);
  }
}

async function ejecutarUna(accion: Accion, clave: string, ahora: Date): Promise<void> {
  try {
    switch (accion.tipo) {
      case "calificar":
        await db
          .insert(botCalificaciones)
          .values({
            clave,
            temperatura: accion.temperatura,
            motivo: accion.motivo,
            escalada: false,
          })
          .onConflictDoUpdate({
            target: botCalificaciones.clave,
            set: {
              temperatura: accion.temperatura,
              motivo: accion.motivo,
              actualizadoEn: ahora,
            },
          });
        break;

      case "escalar": {
        // La temperatura de una escalada NO es siempre `caliente`: escalar
        // porque preguntó si es un bot, o porque el catálogo no tenía la
        // respuesta, no dice nada de las ganas de comprar. Marcar todo eso como
        // caliente ensucia justo la lista por la que una vendedora prioriza.
        const temperatura = accion.motivo === "por_cerrar" ? "caliente" : "tibio";
        await db
          .insert(botCalificaciones)
          .values({
            clave,
            temperatura,
            motivo: accion.motivo,
            escalada: true,
          })
          .onConflictDoUpdate({
            target: botCalificaciones.clave,
            set: {
              escalada: true,
              motivo: accion.motivo,
              actualizadoEn: ahora,
              // Solo `por_cerrar` PISA la temperatura previa. Los otros cinco
              // motivos no saben nada de intención de compra: si el bot ya la
              // había calificado caliente, escalarla por «preguntó si es un
              // bot» no puede enfriarla.
              ...(accion.motivo === "por_cerrar" ? { temperatura: "caliente" as const } : {}),
            },
          });
        await db
          .insert(botPausas)
          .values({
            clave,
            motivo: `escalado_${accion.motivo}`,
            hasta: new Date(ahora.getTime() + GRACIA_ESCALADA_MS),
          })
          .onConflictDoUpdate({
            target: botPausas.clave,
            set: {
              motivo: `escalado_${accion.motivo}`,
              hasta: new Date(ahora.getTime() + GRACIA_ESCALADA_MS),
            },
          });
        break;
      }

      case "pausar":
        await db
          .insert(botPausas)
          .values({
            clave,
            motivo: accion.motivo,
            hasta: null,
          })
          .onConflictDoUpdate({
            target: botPausas.clave,
            set: {
              motivo: accion.motivo,
              hasta: null,
            },
          });
        break;

      case "mandar_pieza":
      case "registrar_interes":
        // 🔴 TODAVÍA NO HACEN NADA — y el comentario que había acá decía que
        // «las ejecuta el handler en tools.ts», que es FALSO: el handler solo
        // acumula la acción en el recolector. O sea que el bot puede agendar el
        // flyer y registrar un interés, y ninguna de las dos cosas ocurre.
        //
        // Es el bloqueador principal del producto (`docs/plan-bot-dipicot.md`
        // §2, B1 y B2) y se conecta en F3, junto con `enviarMedia` de la Cloud
        // API — hoy `TransporteCloudApi.enviarMedia()` lanza, así que aunque se
        // conectara acá el flyer con imagen tampoco saldría por la línea del bot.
        //
        // Queda como no-op EXPLÍCITO en vez de arreglarse a medias: mandar la
        // pieza sin resolver `{precio}` contra Cerberus y sin estampar la
        // procedencia sería mandar un texto con huecos y perder la medición.
        console.warn(
          `[bot ejecutar] acción «${accion.tipo}» pendiente de implementar (F3): se descarta para ${clave}`,
        );
        break;
    }
  } catch {
    // Degradación: si la tabla no existe, la acción se pierde sin tumbar el loop
  }
}
