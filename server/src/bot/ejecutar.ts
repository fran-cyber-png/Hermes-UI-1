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
import { buscarProductos } from "../cerberus/productos.js";
import { registrarInteresDeFamilia } from "../cursos/registrarFamilia.js";
import type { Accion } from "./acciones.js";
import { VENDEDORA_ID_DEL_BOT } from "./frenos.js";

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
  /**
   * La base. Por defecto el singleton; una corrida de prueba pasa la suya, o
   * mirar trabajar al bot dejaría intereses, calificaciones y pausas escritos
   * en producción (#255).
   */
  base: typeof db = db,
): Promise<void> {
  for (const accion of acciones) {
    await ejecutarUna(accion, clave, ahora, base);
  }
}

async function ejecutarUna(accion: Accion, clave: string, ahora: Date, base: typeof db = db): Promise<void> {
  /**
   * ⚠️ `registrar_interes` NO ENTRA EN EL `catch` MUDO DE ABAJO.
   *
   * Ese catch existe para una razón chica y concreta: que una tabla del bot sin
   * migrar no tumbe el loop. Registrar un interés es otra cosa — sale a Cerberus
   * por HTTP, y sus dos modos de falla («el catálogo no tiene esa familia»,
   * «Cerberus no contestó») son información que alguien tiene que poder leer.
   * Tragados en silencio, el síntoma sería una conversación donde el bot dice
   * que anotó el interés y la ficha está vacía, sin una línea en los logs.
   */
  if (accion.tipo === "registrar_interes") {
    await registrarInteresDelBot(accion.familia, clave, base);
    return;
  }

  try {
    switch (accion.tipo) {
      case "calificar":
        await base
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
        await base
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
        await base
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
        await base
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
        // NO se manda desde acá, y no es un olvido. Este módulo escribe tablas:
        // no tiene el número propio, ni el teléfono, ni la puerta de envío — y
        // encima corre bajo el `catch` mudo de abajo, donde un envío a medias
        // desaparecería sin una línea de log. La pieza sale en el paso 14b del
        // orquestador, que sí tiene las tres cosas y vuelve a mirar el freno de
        // la línea justo antes de mandar.
        break;

      // `registrar_interes` no aparece: se atendió arriba, fuera de este `try`,
      // y el `if` de arriba ya lo sacó del tipo — un `case` acá no compilaría.
    }
  } catch {
    // Degradación: si la tabla no existe, la acción se pierde sin tumbar el loop
  }
}

/**
 * El interés que el lead dijo, asentado en `intereses` con el MISMO formato que
 * el clic de una vendedora (`cursos/registrarFamilia.ts`): el nombre crudo de la
 * última edición activa de Cerberus, con su `producto_id` y su `sku`.
 *
 * Firmado como `bot` (`intereses.vendedora_id` es `text` sin FK, así que entra
 * sin migración): quién lo afirmó es parte del dato, y una ficha que dice «lo
 * registró Luz» cuando lo registró la máquina es una atribución falsa.
 *
 * ⚠️ NO se usa `confirmarInteresDerivado`: esa función **recalcula la familia
 * desde el origen de la conversación** (el anuncio, el formulario) e ignora la
 * que se le pase, que es exactamente lo contrario de lo que hace falta acá — el
 * bot registra lo que la persona ACABA de decir, que puede no tener nada que ver
 * con el anuncio por el que entró. Además responde `ya_registrado` ante
 * cualquier interés previo, y eso es correcto para un botón «Confirmar» y no
 * para el bot: si el lead ya tiene un interés y ahora nombra otro, el segundo es
 * un dato nuevo. `intereses` tiene su `unique (clave, curso)` para que nombrar
 * dos veces el mismo no duplique nada.
 */
async function registrarInteresDelBot(familia: string, clave: string, base: typeof db = db): Promise<void> {
  try {
    const r = await registrarInteresDeFamilia(base, {
      clave,
      familia,
      vendedoraId: VENDEDORA_ID_DEL_BOT,
      catalogo: () => buscarProductos(),
    });
    if (!r.ok) {
      console.warn(`[bot ejecutar] no se registró el interés ${familia} de ${clave}: ${r.message}`);
      return;
    }
    console.info(`[bot ejecutar] interés registrado para ${clave}: ${r.sku} · ${r.curso}`);
  } catch (err) {
    console.error(
      `[bot ejecutar] falló registrar el interés ${familia} de ${clave}: ${(err as Error).message}`,
    );
  }
}
